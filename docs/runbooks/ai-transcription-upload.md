# AI Transcription — Audio Upload Runbook

Operational guide for the manual audio upload and Stream recording ingestion features of the AI transcription module.

## 1. Legacy consent without AI term

### Symptom

A patient has `recording_consent_signed_at` set on their record (the legacy video-recording consent) but has **no active `ai_recording` consent term** in the `consent_terms` table. When the psychologist tries to upload audio or start a video recording, the system returns `CONSENT_INACTIVE` or `CONSENT_INVALID`.

### Root cause

The `ai_recording` consent term was introduced as a separate legal instrument from the legacy recording consent. Patients onboarded before this feature have only the legacy flag and lack the AI-specific term required by the dual-gate check.

### Resolution

The psychologist must generate the AI consent term from the patient detail page:

1. Navigate to **Pacientes > [patient name]**.
2. Locate the **Termo de Consentimento para IA** section.
3. Click **Gerar Termo** to create the AI consent term.
4. The patient must sign the term (via the public link or in person).
5. Once the term status is `active`, audio upload and video recording are unblocked.

### Verification query

```sql
-- Check if a patient has an active AI consent term
SELECT ct.id, ct.status, ct.signed_at, ct.revoked_at
FROM consent_terms ct
WHERE ct.patient_id = '<patient-uuid>'
  AND ct.term_type = 'ai_recording'
ORDER BY ct.created_at DESC
LIMIT 1;
```

If the query returns no rows or `status != 'active'`, the term needs to be generated and signed.

---

## 2. Discard policy

### Rule

Transcription rows with `status = 'pending'` that are older than **24 hours** are considered stale. A future cron job will:

1. Delete the audio object from Supabase Storage (if `audio_object_key` is set).
2. Set `audio_discarded_at` to the current timestamp.
3. Transition `status` to `'failed'` with `error_code = 'expired'`.

This prevents orphaned uploads from accumulating storage costs when a user starts an upload but never confirms it (e.g., closes the browser mid-upload, network failure, or abandonment).

### Inspection queries

```sql
-- Pending uploads older than 24h (candidates for discard)
SELECT id, status, error_code, audio_object_key, created_at
FROM ai_transcriptions
WHERE status IN ('pending', 'failed')
ORDER BY created_at DESC;
```

```sql
-- Count pending uploads by age bucket
SELECT
  CASE
    WHEN created_at > now() - interval '1 hour'  THEN '< 1h'
    WHEN created_at > now() - interval '6 hours'  THEN '1-6h'
    WHEN created_at > now() - interval '24 hours' THEN '6-24h'
    ELSE '> 24h'
  END AS age_bucket,
  count(*) AS total
FROM ai_transcriptions
WHERE status = 'pending'
GROUP BY 1
ORDER BY 1;
```

```sql
-- Recently discarded audio files
SELECT id, audio_object_key, audio_discarded_at, error_code
FROM ai_transcriptions
WHERE audio_discarded_at IS NOT NULL
ORDER BY audio_discarded_at DESC
LIMIT 20;
```

---

## 3. Error codes glossary

### `requestAudioUploadUrl` (Server Action)

| Code                       | Description                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`             | No authenticated session or session validation failed (`supabase.auth.getUser()` returned an error).                                                 |
| `NOT_FOUND`                | The patient does not exist, does not belong to the authenticated psychologist, or Zod input validation failed (prevents IDOR).                       |
| `CONSENT_INACTIVE`         | The patient does not have an active `ai_recording` consent term. The psychologist must generate and have the patient sign the AI consent term first. |
| `CONTENT_TYPE_NOT_ALLOWED` | The declared `contentType` is not in the allowlist: `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`, `audio/x-m4a`.                             |
| `SIZE_EXCEEDED`            | The declared `sizeBytes` exceeds the maximum allowed file size (configured server-side).                                                             |
| `RATE_LIMITED`             | The user exceeded 6 upload URL requests within a 60-second window. Wait and retry.                                                                   |

### `confirmAudioUpload` (Server Action)

| Code                | Description                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`      | No authenticated session or session validation failed.                                                                                                                                                                                 |
| `NOT_FOUND`         | The transcription row does not exist, does not belong to the authenticated psychologist, or Zod input validation failed.                                                                                                               |
| `CONSENT_INACTIVE`  | The AI consent term was revoked between the upload URL request and the confirmation. The upload is rejected.                                                                                                                           |
| `INVALID_MIME`      | Magic-number validation of the uploaded file's first 8 KB does not match the declared content type, or the detected MIME is not in the allowlist. This prevents disguised file uploads (e.g., an executable declared as `audio/mpeg`). |
| `SIZE_MISMATCH`     | The actual file size in Storage differs from the declared `sizeBytes` by more than 5%. Prevents partial uploads from being processed.                                                                                                  |
| `ALREADY_CONFIRMED` | The transcription row has already been confirmed (idempotency guard). No action needed — this is not an error condition for the user.                                                                                                  |

### `ingestStreamRecording` (Inngest function)

These error codes are written to the `error_code` column of `ai_transcriptions` when the Inngest function fails:

| Code                   | Description                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream_ingest_failed` | The download from Stream's CDN failed after retries, or the upload to Supabase Storage failed. Check Inngest run logs for the step that failed. |
| `invalid_mime`         | The downloaded recording failed magic-number validation. The file from Stream was not a recognized audio format.                                |

### `processAudioTranscription` (Inngest function)

These error codes are written to the `error_code` column of `ai_transcriptions` when the Gemini processing pipeline fails:

| Code                      | Description                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gemini_429`              | Gemini API rate limit (HTTP 429 / `RESOURCE_EXHAUSTED`). Retriable — Inngest retries up to 3 times automatically.                                                                            |
| `gemini_safety_block`     | Gemini blocked the audio or generated note due to safety filters (finish reason `SAFETY`). Non-retriable — the content triggered `BLOCK_ONLY_HIGH` despite relaxed clinical safety settings. |
| `gemini_5xx`              | Gemini returned a server error (500/502/503). Retriable — typically a transient outage on Google's side.                                                                                     |
| `invalid_response_schema` | Gemini returned JSON that does not match the expected note schema (`GeneratedNoteSchema`). Indicates a model regression or prompt drift. Non-retriable on the current attempt.               |
| `consent_revoked`         | The patient's AI consent was revoked while the transcription was in `pending` status. The `onConsentRevoked` handler cancelled the row. Audio is purged by the `purgeFailedAudios` cron.     |
| `pipeline_exhausted`      | All 3 Inngest retries were exhausted without success. The `onFailure` handler wrote this terminal code. Check Inngest run logs for the step that caused the final failure.                   |

### `toggleRecording` (telepsicologia Server Action)

| Code              | Description                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONSENT_INVALID` | The dual-gate check failed: either the legacy `recording_consent_signed_at` flag is not set, or the `ai_recording` consent term is not active (or both). Both must be satisfied to start a video recording. |

---

## 4. Re-processing a failed row

When a transcription row lands in `status = 'failed'`, you can re-trigger the pipeline by dispatching an `ai-transcription/audio.uploaded` event with the row's ID. The pipeline is idempotent: re-execution transitions the row back through the processing steps and overwrites intermediate state.

### Prerequisites

- The row still has `audio_object_key IS NOT NULL` (the audio has not been discarded yet). If the audio was already purged, re-processing is not possible — the psychologist must upload the file again.
- The patient's AI consent term is still active. If consent was revoked (`error_code = 'consent_revoked'`), re-processing will fail at the `assert-consent` step.

### Via the Inngest dashboard

1. Open the Inngest dashboard and navigate to **Events**.
2. Click **Send Event** and use this payload (replace the placeholders):

```json
{
  "name": "ai-transcription/audio.uploaded",
  "data": {
    "transcriptionId": "<transcription-uuid>",
    "userId": "<psychologist-uuid>",
    "patientId": "<patient-uuid>",
    "source": "manual_upload"
  }
}
```

3. Monitor the function run in the **Runs** tab for `process-audio-transcription`.

### Via SQL (find the IDs)

```sql
-- Find failed transcriptions with audio still available for re-processing
SELECT id, user_id, patient_id, error_code, audio_object_key, created_at
FROM ai_transcriptions
WHERE status = 'failed'
  AND audio_object_key IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

---

## 5. Discard and purge crons

Two Inngest scheduled functions manage audio file lifecycle in Supabase Storage.

### `discardOldAudios` (cron: `0 * * * *` — every hour at minute 0)

Deletes audio files from Storage for transcription rows that have exceeded their retention period. The retention threshold is per-user: it reads `ai_transcription_settings.keep_audio_hours` (default 24 hours) and discards audio older than that.

**What it does per qualifying row:**

1. Deletes the audio object from Supabase Storage (service-role).
2. Sets `audio_object_key = NULL` and `audio_discarded_at = now()` on the row.

**Qualifying rows:** `audio_object_key IS NOT NULL AND audio_discarded_at IS NULL AND created_at < now() - keep_audio_hours`.

### `purgeFailedAudios` (cron: `15 * * * *` — every hour at minute 15)

Shortens retention for terminal failures. Removes audio from rows in `failed` or `cancelled` status where the terminal timestamp is older than 1 hour.

**What it does per qualifying row:**

1. Deletes the audio object from Supabase Storage (service-role).
2. Sets `audio_object_key = NULL` and `audio_discarded_at = now()` on the row.

**Qualifying rows:** `status IN ('failed', 'cancelled') AND audio_object_key IS NOT NULL AND COALESCE(completed_at, updated_at) < now() - INTERVAL '1 hour'`.

### Inspecting cron status in the Inngest dashboard

1. Open the Inngest dashboard and navigate to **Functions**.
2. Find `discard-old-audios` and `purge-failed-audios` in the function list.
3. Click on either function to see:
   - **Cron history**: timestamps of each invocation with pass/fail status.
   - **Recent runs**: individual run details showing which step succeeded or failed.
   - **Metrics**: execution duration, error rate, and throughput over time.
4. To see details of a specific run, click on it in the **Runs** tab. Each row processed appears as a separate step (`discard-<id>` or `purge-<id>`), so you can identify which specific audio file caused a failure.

### Troubleshooting

| Symptom                                | Likely cause                                         | Resolution                                                                                                                          |
| -------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cron shows no recent runs              | Inngest function not registered or Inngest is paused | Check the Inngest dashboard for the function's registration status; verify the API route at `/api/inngest` is deployed and healthy. |
| Runs succeed but no rows discarded     | No rows match the qualifying criteria                | Verify with the inspection queries in section 2 that there are eligible rows.                                                       |
| Storage delete fails for specific rows | Object already deleted or bucket misconfigured       | Check the `audio_object_key` value against actual Storage contents; the cron logs the error and continues to the next row.          |
