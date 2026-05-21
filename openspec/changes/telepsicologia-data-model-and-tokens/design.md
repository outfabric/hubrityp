## Context

PRD 09 requires integrated video calling for online psychotherapy sessions. The existing `sessions` table already has `modality` (`in_person`/`online`) and a full status lifecycle (`scheduled`, `confirmed`, `done`, `cancelled`, `no_show`). The `patients` table has consent tracking infrastructure (`consent_signed_at`). The WhatsApp module (`src/modules/whatsapp/`) already established the pattern for external-service integration: env vars in `serverEnvSchema`, adapter in `server/adapters/`, Inngest for async work, and domain tables under `src/shared/db/schema/<domain>/`.

Stream.io Video is the chosen provider (PRD 00 section 4). The Node.js SDK (`@stream-io/node-sdk`) handles server-side call creation and JWT minting. The React SDK (`@stream-io/video-react-sdk`) provides the client-side call UI (used by subsequent changes).

This change is strictly backend + data model. No routes, no pages, no UI components — those are in changes 2-5.

## Goals / Non-Goals

**Goals:**

- Drizzle schema for `video_rooms`, `video_session_logs`, `video_recordings` with full RLS, CHECK constraints, indexes, and FK constraints
- Recording consent columns on `patients` (Res. CFP 13/2022)
- Server-side Stream client singleton with env var validation
- Server Actions for creating a video room (Stream call + DB row) and minting call-scoped tokens
- Pure helpers for patient video URL generation and idempotency
- Zod schemas for all inputs and table shapes
- Integration tests covering schema correctness, RLS enforcement, Server Action happy/negative paths
- Unit tests for pure helpers (URL generation, token scope validation)

**Non-Goals:**

- Any UI or frontend route (changes 2-4)
- Lobby/waiting room logic (change 2-3)
- In-call controls, screen sharing, chat (change 4)
- Call lifecycle auto-expiry, recording flow, webhook handling (change 5)
- Inngest functions for room creation automation — this change provides manual `createVideoRoom`; change 5 adds auto-creation when a session with `modality='online'` is created/updated
- WhatsApp reminder integration with video link — already handled by existing `select-template-variables.ts` which reads `link_video` from session data; the plumbing to populate that field comes in change 5

## Decisions

**1. Table location: `src/shared/db/schema/telepsicologia/`**

New domain folder following the established pattern (`agenda/`, `patients/`, `whatsapp/`). Three files: `tables.ts`, `policies.ts`, `index.ts`. The barrel re-exports from `src/shared/db/schema/index.ts`.

Why not extend `agenda/tables.ts`: video rooms are a distinct domain with their own lifecycle and access patterns. Keeping them separate makes the schema navigable and avoids a 400+ line `tables.ts`.

**2. `video_rooms` schema: 1:1 with `sessions`, keyed by `session_id` UNIQUE**

Each online session gets at most one video room. The `session_id` column is UNIQUE (not just FK) to enforce the 1:1 relationship. The Stream call ID is stored as `stream_call_id` (VARCHAR 255) — this is the `type:id` format Stream uses internally (e.g., `default:ses_a8f7b2c1`).

Columns:
- `id` (UUID PK)
- `user_id` (UUID NOT NULL, FK auth.users — for RLS)
- `session_id` (UUID NOT NULL, UNIQUE, FK sessions)
- `stream_call_id` (VARCHAR 255 NOT NULL) — the `type:id` composite
- `patient_token` (VARCHAR 512 NOT NULL) — call-scoped JWT for the patient
- `partner_token` (VARCHAR 512) — for couple sessions (RN-09.04)
- `available_from` (TIMESTAMPTZ NOT NULL) — 10 min before session start (RF-09.07)
- `expires_at` (TIMESTAMPTZ NOT NULL) — 1h after session end (RF-09.23)
- `recording_enabled` (BOOLEAN DEFAULT FALSE)
- `recording_consent_signed` (BOOLEAN DEFAULT FALSE)
- `status` (TEXT NOT NULL DEFAULT 'pending') — CHECK: `pending`, `active`, `ended`, `expired`
- `created_at` (TIMESTAMPTZ DEFAULT now())

Indexes: `(session_id)` UNIQUE, `(user_id, status)` for "my active rooms" queries, `(expires_at)` for cleanup/expiry cron.

**3. `video_session_logs` schema: append-only event log**

Metadata-only (RF-09.28, RNF-09.09). No clinical content.

Columns:
- `id` (UUID PK)
- `session_id` (UUID NOT NULL, FK sessions)
- `user_id` (UUID NOT NULL — for RLS)
- `event_type` (VARCHAR 30 NOT NULL) — CHECK: `therapist_joined`, `patient_joined`, `partner_joined`, `therapist_left`, `patient_left`, `partner_left`, `screen_share_started`, `screen_share_ended`, `connection_drop`, `reconnected`, `recording_started`, `recording_ended`, `room_ended`, `room_expired`
- `participant_role` (VARCHAR 20) — `therapist`, `patient`, `partner`
- `metadata` (JSONB) — non-PII metadata only (e.g., connection quality indicator, duration at event time)
- `created_at` (TIMESTAMPTZ DEFAULT now())

Index: `(session_id, created_at)` for session timeline.

**4. `video_recordings` schema: ephemeral recording lifecycle**

Tracks recording state for PRD 10 integration. Audio is ephemeral — discarded within 24h (RNF-09.08).

Columns:
- `id` (UUID PK)
- `session_id` (UUID NOT NULL, FK sessions)
- `user_id` (UUID NOT NULL — for RLS)
- `stream_recording_id` (VARCHAR 255)
- `duration_seconds` (INTEGER)
- `status` (TEXT NOT NULL DEFAULT 'idle') — CHECK: `idle`, `recording`, `processing`, `transcribed`, `discarded`
- `audio_temp_url` (TEXT) — expires in 24h
- `transcription_id` (UUID) — FK for PRD 10 (nullable, not yet implemented)
- `recorded_at` (TIMESTAMPTZ)
- `discarded_at` (TIMESTAMPTZ)
- `created_at` (TIMESTAMPTZ DEFAULT now())

Index: `(session_id)`.

**5. RLS policies: owner-scoped via `user_id = auth.uid()`**

All three tables carry a `user_id` column that references the psychologist. RLS policies follow the existing pattern:

- `video_rooms`: SELECT/INSERT/UPDATE/DELETE WHERE `user_id = auth.uid()`
- `video_session_logs`: SELECT/INSERT WHERE `user_id = auth.uid()` (no UPDATE/DELETE — append-only)
- `video_recordings`: SELECT/INSERT/UPDATE WHERE `user_id = auth.uid()` (no DELETE — lifecycle managed via `status`)

The patient join flow (change 3) will use a service-role insert for `video_session_logs` when the patient joins via token (the patient is not an authenticated Supabase user). A justifying comment will be required at that point.

**6. Stream client singleton**

```typescript
// src/modules/telepsicologia/server/stream-client.ts
import { StreamClient } from '@stream-io/node-sdk';
import { serverEnv } from '@/shared/env';

let _client: StreamClient | null = null;

export function getStreamClient(): StreamClient {
  if (!_client) {
    _client = new StreamClient(serverEnv.STREAM_API_KEY, serverEnv.STREAM_API_SECRET);
  }
  return _client;
}
```

Lazy singleton avoids initialization at import time (test-friendly). Uses `serverEnv` — never exposed to client.

**7. Token minting: call-scoped JWTs with expiry**

Two token types:
- **Psychologist token**: minted on-demand via `getVideoToken` Server Action. Uses `client.generateCallToken({ user_id: authUser.id, call_cids: ['default:<roomId>'], role: 'admin', validity_in_seconds: 7200 })`. The `admin` role allows screen sharing, admitting patients, ending call.
- **Patient token**: minted at room creation time and stored in `video_rooms.patient_token`. Uses `client.generateCallToken({ user_id: 'patient-<patientId>', call_cids: ['default:<roomId>'], validity_in_seconds })` where validity spans from `available_from` to `expires_at`. The patient user ID is a synthetic `patient-<uuid>` — the patient is not a Supabase user but Stream needs a user_id.

Why store the patient token: the token must be embedded in the patient's join URL (sent via WhatsApp, RF-09.05). It must survive across multiple join attempts (RF-09.07 — reconnect after drop). Generating a fresh token each time would require the patient to authenticate, which violates the "no login" requirement.

**8. Patient video URL format**

`https://<domain>/v/<token>` where `<token>` is a 64-char hex string stored in `video_rooms.patient_token` — NOT the JWT itself (too long for a URL, >500 chars). The `patient_token` column stores the JWT; the URL uses a lookup token (a separate random hex) that maps to the room. This follows the same pattern as `confirmar-sessao/[token]` and `termo/[token]`.

Revised column plan:
- `patient_token` (VARCHAR 64 NOT NULL) — random hex for URL lookup
- `patient_jwt` (TEXT NOT NULL) — the actual Stream JWT for the patient
- `partner_token` (VARCHAR 64) — random hex for couple partner URL
- `partner_jwt` (TEXT) — the actual Stream JWT for the couple partner

**9. Recording consent on `patients` table**

Two new columns:
- `recording_consent_signed_at` (TIMESTAMPTZ) — when patient signed the Res. CFP 13/2022 consent
- `recording_consent_revoked_at` (TIMESTAMPTZ) — when consent was revoked (null = active)

These columns are on `patients` (not on `video_rooms`) because consent is patient-level, not per-session. A patient signs once and the consent applies to all future sessions until revoked.

**10. Env vars**

Added to `serverEnvSchema`:
- `STREAM_API_KEY` (z.string().min(1)) — required, validated at boot
- `STREAM_API_SECRET` (z.string().min(1)) — required, validated at boot

Added to `clientEnvSchema`:
- `NEXT_PUBLIC_STREAM_API_KEY` (z.string().min(1)) — the React SDK needs this to initialize the client-side `StreamVideoClient`

## Risks / Trade-offs

- [Risk: patient JWT stored in DB could be extracted by psychologist and shared] → Mitigation: the JWT is call-scoped and time-limited. Even if shared, it only grants access to that one call within the validity window. Stream's call settings enforce max participants (2-3).
- [Risk: Stream SDK adds bundle weight] → Mitigation: `@stream-io/node-sdk` is server-only; `@stream-io/video-react-sdk` will be dynamically imported in UI components (subsequent changes). The `'use client'` boundary and `next/dynamic` prevent it from bloating the RSC bundle.
- [Risk: `patient-<uuid>` synthetic user IDs in Stream pollute the user namespace] → Mitigation: Stream supports guest/anonymous users, but call-scoped tokens with explicit user IDs give better control. The `patient-` prefix makes them distinguishable. No cleanup needed — Stream call data is ephemeral.
- [Trade-off: storing both lookup token + JWT for patient] → Accepted for URL ergonomics (64-char hex vs 500+ char JWT) and consistency with existing `confirmar-sessao` pattern.

## Migration Plan

1. Run `npm run db:generate` to produce the migration SQL
2. Edit migration to add: RLS ENABLE + policies, CHECK constraints for `status`/`event_type`, FK constraints to `auth.users` and `sessions`, UNIQUE on `video_rooms.session_id`, indexes
3. Run `npm run db:migrate` locally
4. Deploy — migration is additive (new tables + 2 nullable columns on `patients`), zero risk of data loss
5. Rollback: drop the three tables, remove the two columns. Reversible.

## Open Questions

- Should the patient lookup token in the URL be the same 64-char hex as the `confirmation_token` pattern, or should we use a shorter format (e.g., nanoid 21-char)? The 64-char hex is consistent with existing patterns but makes a longer URL. Decision: use 64-char hex for consistency — the URL is shared via WhatsApp template where length is not a constraint.
