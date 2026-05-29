# AI Transcription — Settings Runbook

Operational guide for the per-psychologist **settings** surface of the AI
transcription module: the page at `/configuracoes/transcricao-ia`, the three
Server Actions that back it (`getTranscriptionSettings`,
`updateTranscriptionSettings`, `getTranscriptionStats`), and how the persisted
preferences flow into the generation pipeline.

This is the counterpart to the other AI-transcription runbooks:

- `ai-transcription-upload.md` — ingestion, audio purge cron.
- `ai-transcription-review.md` — review/retry/export semantics.
- `ai-transcription-cost.md` — Gemini spend.

Read this one for what each control does, which changes are audited, and how the
usage statistics are computed.

---

## 1. Where the data lives

Settings are one row per psychologist in `ai_transcription_settings`, keyed by
`user_id` (unique). The row is created lazily: the first time a psychologist
opens the page, `getTranscriptionSettingsImpl` does an
`INSERT ... ON CONFLICT (user_id) DO NOTHING` with the table defaults, then reads
the effective row. A returning visitor's existing values are never overwritten by
that read.

Defaults (must match the DB column defaults and the synthesized fallback in
`get-transcription-settings.ts`):

| Field                        | Default  |
| ---------------------------- | -------- |
| `enabled`                    | `false`  |
| `default_template`           | `livre`  |
| `risk_detection_sensitivity` | `medium` |
| `keep_audio_hours`           | `24`     |
| `keep_transcription`         | `false`  |

The statistics shown on the same page are **not** stored — they are computed on
each read from the psychologist's `ai_transcriptions` rows (see §4).

---

## 2. The controls

All controls are owner-scoped: a psychologist only ever reads/writes their own
row. The page route lives under `/configuracoes/*`, which `middleware.ts`
classifies as gated (`'app'`); each Server Action additionally re-authenticates
via `supabase.auth.getUser()` and scopes every query to `user_id = session.uid`
(defense-in-depth on top of RLS).

### 2.1 Ativar Transcrição IA — `enabled` (boolean, default `false`)

Master on/off switch for the feature. When `false`, **new** sessions are not
processed by the pipeline. In-flight transcriptions already queued complete
normally — disabling is not a kill switch for running jobs. Turning it off shows
an `AlertDialog` explaining exactly that before the change is committed.

- **LGPD:** disabling stops new audio from being sent to Gemini. It does not
  retroactively delete anything already processed.

### 2.2 Template padrão — `default_template` (enum, default `livre`)

The note template applied by default to new transcriptions:
`tcc | psicanalise | sistemica | aba | livre`. This is the template the
generation pipeline uses to structure the AI-generated clinical note when the
psychologist has not picked a per-session override. Changing it affects only
**future** transcriptions; existing notes are untouched.

- **LGPD:** no retention or data-flow impact. Purely a formatting/structuring
  preference.

### 2.3 Sensibilidade de detecção de risco — `risk_detection_sensitivity` (enum, default `medium`)

`low | medium | high`. Controls how aggressively the pipeline surfaces
risk/safety signals (e.g. self-harm cues) detected in the session. Higher
sensitivity flags more, at the cost of more false positives. Like the template,
this is read by the pipeline at generation time and affects only **future**
transcriptions.

- **LGPD:** no change to what data is processed or retained — only to how the
  model is prompted to flag risk. Clinical judgment always remains with the
  psychologist.

### 2.4 Manter áudio por — `keep_audio_hours` (default `24`, **MVP-locked to 24**)

How long the raw session audio is retained before the purge cron removes the
audio object. **In the MVP this is locked to 24 hours.** See §5 for the full lock
rationale and what must change to unlock longer retention.

- **LGPD:** audio is the most sensitive artifact (a clinical conversation).
  Shorter retention = smaller exposure window. 24h is the minimum needed for
  retry-after-failure (see `ai-transcription-review.md`).

### 2.5 Manter transcrição textual — `keep_transcription` (boolean, default `false`)

Whether the verbatim text transcript is kept after the structured note is
generated. Default is `false`: normally the note is sufficient and the raw
transcript is discarded. Keep it `true` only when there is a documented
clinical/audit reason — the UI says so explicitly.

- **LGPD:** the verbatim transcript contains the full conversation. Retaining it
  expands the data footprint, so the privacy-safe default is off.

---

## 3. Audit log mapping

`updateTranscriptionSettingsImpl` writes to the central `audit_log` table inside
the **same transaction** as the UPSERT. It first reads the current (old) values
owner-scoped, performs the UPSERT, then diffs old↔new and appends one row per
changed, security-relevant dimension. An idempotent re-save (no value changed)
emits **no** audit rows.

Every audit row has:

- `user_id` = session user (never client-supplied)
- `resource_type` = `ai_transcription_settings`
- `resource_id` = the settings row id
- `metadata` = `{ userId, oldValue, newValue }` — **PII-free** (only booleans /
  small integers; never patient data, clinical content, or tokens)

| Change                                | `action`                                      | Audited?                          |
| ------------------------------------- | --------------------------------------------- | --------------------------------- |
| `enabled` `false → true`              | `ai_transcription_enabled`                    | yes                               |
| `enabled` `true → false`              | `ai_transcription_disabled`                   | yes                               |
| `keep_audio_hours` **increased**      | `ai_transcription_retention_changed`          | yes — increase only               |
| `keep_audio_hours` decreased / equal  | —                                             | no (longer retention is the risk) |
| `keep_transcription` toggled (either) | `ai_transcription_keep_transcription_toggled` | yes — both directions             |
| `default_template` changed            | —                                             | no (no retention/privacy impact)  |
| `risk_detection_sensitivity` changed  | —                                             | no (no retention/privacy impact)  |

Note on `keep_audio_hours`: because the input schema is currently
`z.literal(24)` (§5), an increase can never actually occur today, so this audit
branch is effectively dormant until the retention UI ships. It is written now so
the moment the literal is widened, increases are audited without further work.

### Operator query

```sql
-- All settings-change audit events for one psychologist, newest first.
SELECT created_at, action, metadata
FROM audit_log
WHERE user_id = '<psychologist-uuid>'
  AND resource_type = 'ai_transcription_settings'
ORDER BY created_at DESC;
```

---

## 4. Statistics methodology

`getTranscriptionStatsImpl` computes the panel metrics on each read with four
parallel owner-scoped aggregate queries (`Promise.all`, no waterfall). All
queries filter `user_id = session.uid`; the result carries only aggregate
numbers — never a patient id, a transcription payload, or any clinical content.

The current month boundary is `date_trunc('month')` in **UTC** (start of the
first instant of the calendar month), compared against `created_at` (timestamptz)
inclusively.

| Metric                  | How it is computed                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `totalProcessed`        | `count(*)` of all the psychologist's `ai_transcriptions` rows (lifetime).                                                                                                                                                                         |
| `failedCount`           | `count(*) filter (where status = 'failed')`.                                                                                                                                                                                                      |
| `monthProcessed`        | `count(*)` of rows with `created_at >= start-of-month (UTC)`.                                                                                                                                                                                     |
| `reviewed`              | `count(*) filter (where status = 'reviewed')`.                                                                                                                                                                                                    |
| `savedToProntuario`     | `count(*) filter (where saved_to_prontuario)`.                                                                                                                                                                                                    |
| `estimatedMinutesSaved` | `monthProcessed * 8` (RF-10.23: ~8 min of manual note-writing saved per processed transcription).                                                                                                                                                 |
| `acceptanceRatePercent` | `round(100 * accepted_without_edits / reviewed)`, where `accepted_without_edits` = saved **with zero edits** (`saved_to_prontuario AND user_edits_count = 0`). **Withheld (`null`) until `reviewed >= 5`** — too small a sample to be meaningful. |
| `avgCostUsd`            | `avg(coalesce(transcription_cost_usd,0) + coalesce(llm_cost_usd,0))` over rows that carry any cost metadata. `null` when no row has cost data.                                                                                                    |

### When the acceptance rate is withheld

The acceptance rate is returned as `null` whenever the psychologist has fewer
than **5** reviewed transcriptions. A rate computed off 1–4 samples is noise, so
the UI shows a "not enough data yet" treatment instead of a misleading percentage.
The threshold lives in `get-transcription-stats.ts`
(`MIN_REVIEWED_FOR_ACCEPTANCE = 5`).

### Why `avgCostUsd` can be null

Cost columns (`transcription_cost_usd`, `llm_cost_usd`) are populated by the
pipeline only when cost metadata is available. If none of the psychologist's rows
carry cost data, the average is `null` and the card is hidden / shown as
unavailable rather than displaying `$0.00` (which would wrongly imply free usage).

---

## 5. MVP lock: `keep_audio_hours = 24`

The DB column `keep_audio_hours` permits `24–168` via a CHECK constraint, but the
settings UI and the Server Action boundary are intentionally **locked to 24h** in
the MVP.

How the lock is enforced (two layers):

1. **Input schema** — `UpdateTranscriptionSettingsInputSchema.keepAudioHours` is
   `z.literal(24)`. Any other value (including the DB-valid `48 / 72 / 168`) is
   rejected at the Server Action boundary with `INVALID_INPUT`.
2. **View schema** — `TranscriptionSettingsViewSchema.keepAudioHours` is likewise
   `z.literal(24)`, so the read side and the form's `defaultValues` stay
   symmetric with what can be written.

### Why it is locked

`keep_audio_hours > 24` extends how long raw clinical audio lives, which is a
material LGPD retention decision. The current AI consent term
(`AI_CONSENT_TEMPLATE_V1`) only documents the **24h-by-default** retention to
patients. Allowing longer retention without first updating the consent the
patient agreed to would put us out of step with the legal basis for processing.

### What must change to unlock longer retention

Do **not** simply widen the Zod literal. Unlocking requires, in order:

1. **Legal sign-off** on longer audio retention.
2. **Update `AI_CONSENT_TEMPLATE_V1`** (bump to a new version) so the patient
   consent text reflects the new maximum retention and the conditions for it.
   Existing consents on the old version must be handled (re-consent or constrain
   those patients to 24h).
3. **Widen the Zod schemas** (`UpdateTranscriptionSettingsInputSchema` and
   `TranscriptionSettingsViewSchema`) from `z.literal(24)` to the allowed set
   (e.g. `z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(168)])`),
   matching the DB CHECK.
4. **Ship the retention `Select` control** in the form (currently the field is
   fixed at 24h).
5. The `ai_transcription_retention_changed` audit event (§3) already fires on any
   increase, so no audit work is needed — verify it lands once increases become
   possible.

Until all five are done, 24h is the only valid value end-to-end.

---

## 6. Quick checks

```sql
-- One psychologist's current effective settings.
SELECT enabled,
       default_template,
       risk_detection_sensitivity,
       keep_audio_hours,
       keep_transcription,
       updated_at
FROM ai_transcription_settings
WHERE user_id = '<psychologist-uuid>';
```

```sql
-- Sanity: no row should ever have keep_audio_hours <> 24 while the MVP lock is
-- in force. A non-24 value means the lock was bypassed (DB write outside the
-- Server Action) — investigate.
SELECT user_id, keep_audio_hours
FROM ai_transcription_settings
WHERE keep_audio_hours <> 24;
```

> These are operator/audit queries. In application code, settings and statistics
> reads are owner-scoped to the session user; never run cross-tenant reads
> through a user-reachable code path.
