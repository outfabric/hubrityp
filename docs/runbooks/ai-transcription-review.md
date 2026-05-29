# AI Transcription — Review UI Runbook

Operational guide for the transcription **review** surface of the AI transcription
module: the list at `/dashboard/transcricoes`, the per-item review page at
`/dashboard/transcricoes/[id]/revisar`, and what happens after a reviewed note is
committed to the patient's prontuário.

This is the counterpart to `ai-transcription-upload.md` (ingestion) and
`ai-transcription-cost.md` (Gemini spend). Read those for upload failures and
quota questions; read this one for review, retry, and export semantics.

---

## 1. Retrying a failed transcription from the review UI

### What "failed" means

A transcription row reaches `status = 'failed'` only after the Inngest
`process-audio-transcription` function has **exhausted all of its automatic
retries** (`retries: 3`). Its `onFailure` handler is what flips the row to
`failed` and records the error code. So a `failed` row has already been retried
three times by the platform — a fourth automatic retry will not happen on its
own.

In the review UI a failed transcription shows up under the **Falhas** tab at
`/dashboard/transcricoes`. Opening it lands on the review page's failed branch,
which renders a danger alert ("A geração da nota falhou") with a pt-BR reason
derived from the stored error code (e.g. "Não foi possível transcrever o áudio.",
"Houve uma falha ao gerar a nota com a IA.") and a **Tentar de novo** button.

### How retry works today

There is **no dedicated retry Server Action** that re-dispatches the existing
Inngest job. The "Tentar de novo" button is a link back to the patient's
prontuário (`/pacientes/<patientId>/prontuario`), which is the canonical entry
point for a fresh `ai-transcription/audio.uploaded` flow. The psychologist
re-runs the normal upload (or re-uses a Stream recording) from there, which
creates a **new** transcription row and a **new** Inngest run. The original
failed row stays as-is for the audit trail until the discard/purge cron cleans
up its audio object (see `ai-transcription-upload.md`, cron section).

So, end-to-end, "retry from the review UI" is:

1. Psychologist opens **Falhas** → the failed item → clicks **Tentar de novo**.
2. They land on the patient's prontuário and re-upload the audio.
3. A new transcription is queued; the failed row is left for the cron to clean up.

### When the audio is gone

If the failed row's audio object has already been removed by the
`discard-old-audios` / `purge-failed-audios` cron (audio is purged ~1h after the
row enters `failed`/`cancelled`), there is nothing to re-dispatch and no audio to
re-process. The psychologist must obtain the audio again (re-record / re-upload)
before retrying. There is no way to recover a purged audio object.

### Operator-side diagnosis

Use these read-only queries to understand _why_ a specific transcription failed
before advising a retry. Run as an operator with appropriate access — do **not**
log clinical content.

```sql
-- Status + failure code + whether audio is still available to re-process.
SELECT id,
       status,
       error_code,
       (audio_object_key IS NOT NULL) AS audio_available,
       completed_at,
       updated_at
FROM ai_transcriptions
WHERE id = '<transcription-uuid>';
```

| `error_code`           | Meaning                               | Operator guidance                                                                 |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `transcription_failed` | Gemini could not transcribe the audio | Usually audio quality / format. Advise re-recording with clearer audio.           |
| `gemini_error`         | Note generation call to Gemini failed | Often transient (model/API). A fresh upload frequently succeeds.                  |
| (other / null)         | Unexpected failure                    | Check the Inngest run logs for `processAudioTranscription exhausted all retries`. |

For the full Inngest run history (per-step success/failure, retry timeline), open
the Inngest dashboard → **Functions** → `process-audio-transcription` → the run
for this transcription.

> Note: the failed row is intentionally **not** auto-deleted on retry. The new
> upload is a separate row; both can coexist briefly. Do not manually delete the
> old row to "clean up" — the purge cron handles it and manual deletion loses the
> audit trail.

---

## 2. What `ai_assisted` means in exports and queries

### Definition

`ai_assisted` is a `boolean NOT NULL DEFAULT false` column on the `evolutions`
table (`src/shared/db/schema/medical-records/tables.ts`). It is `true` **iff the
initial content of that evolution originated from an AI transcription that the
psychologist reviewed and explicitly saved** to the prontuário.

It is set to `true` in exactly one place: `saveTranscriptionToProntuarioImpl`
calls `createEvolutionImpl({ ..., aiAssisted: true, aiTranscriptionId })` when a
reviewed transcription is committed. Every other path that creates an evolution
(manual evolution editor, etc.) leaves it at its `false` default.

The companion column `ai_transcription_id` is a back-link to the source
`ai_transcriptions` row (FK `ON DELETE SET NULL`). It lets you trace an AI-assisted
evolution back to the transcription it came from; if that transcription is later
deleted, the column nulls out but `ai_assisted` stays `true` and the evolution
content is preserved.

### What it does NOT mean

- It is **not** a per-edit flag. `ai_assisted` reflects the _origin of the
  initial content_. If the psychologist later heavily edits or fully rewrites the
  evolution in subsequent versions, the flag stays `true` — the record still
  _originated_ from AI assistance. Treat it as provenance, not as "the current
  text is AI-generated".
- It does **not** imply the patient's clinical conclusions were made by AI. The
  psychologist reviewed and accepted the note (the save flow requires an explicit
  "reviewed" confirmation — `reviewedChecked` must be literally `true`, or the
  save is rejected with `MUST_REVIEW`). The flag is a transparency/audit marker,
  consistent with LGPD and CFP transparency expectations for AI-assisted clinical
  documentation.

### In exports

When an evolution is included in any export of the prontuário (PDF, data export,
or downstream report), `ai_assisted = true` is the authoritative signal that the
evolution should be presented/annotated as AI-assisted. Exports must surface this
provenance rather than presenting an AI-originated note as if it were authored
from scratch.

### Useful queries

The table has a dedicated index `idx_evolutions_user_ai_assisted` on
`(user_id, ai_assisted)`, so the following audit/statistics queries are cheap:

```sql
-- How many of a psychologist's evolutions originated from AI assistance.
SELECT ai_assisted, count(*)
FROM evolutions
WHERE user_id = '<psychologist-uuid>'
GROUP BY ai_assisted;
```

```sql
-- Trace an AI-assisted evolution back to its source transcription.
SELECT e.id AS evolution_id,
       e.ai_assisted,
       e.ai_transcription_id,
       t.status AS transcription_status
FROM evolutions e
LEFT JOIN ai_transcriptions t ON t.id = e.ai_transcription_id
WHERE e.id = '<evolution-uuid>';
```

> These queries are operator/audit tooling. In application code, evolution reads
> are RLS-scoped to the owning psychologist via `user_id = auth.uid()`; never run
> cross-tenant evolution reads through a user-reachable code path.
