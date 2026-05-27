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

### `toggleRecording` (telepsicologia Server Action)

| Code              | Description                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONSENT_INVALID` | The dual-gate check failed: either the legacy `recording_consent_signed_at` flag is not set, or the `ai_recording` consent term is not active (or both). Both must be satisfied to start a video recording. |
