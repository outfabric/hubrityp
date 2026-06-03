// Shared seed metadata between Playwright phases.
//
// `global-setup.ts` writes this file; `auth.setup.ts` reads it; tests load
// the storageState produced by `auth.setup.ts`. We intentionally use a JSON
// file (rather than `globalThis` / module-level state) because Playwright
// runs `globalSetup`, the `setup` project, and individual test files in
// separate processes — module state does not survive the boundaries.
//
// The file lives under `src/__tests__/e2e/seeded/setup/.auth/` (gitignored
// alongside `state.json`) so a stale value can never leak into a commit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SEED_STATE_PATH = path.resolve(HERE, '.auth/seed-state.json');
export const STORAGE_STATE_PATH = path.resolve(HERE, '.auth/state.json');

export const SEED_PATIENTS = {
  activeWithPhone: {
    id: '00000000-0000-4000-8000-000000000010',
    fullName: 'Maria Silva',
    phone: '+55 11 99999-0001',
    tags: ['adulto', 'presencial'],
  },
  activeMinimal: {
    id: '00000000-0000-4000-8000-000000000011',
    fullName: 'João Santos',
  },
  archived: {
    id: '00000000-0000-4000-8000-000000000012',
    fullName: 'Ana Oliveira',
  },
} as const;

/**
 * Deterministic seed sessions for public confirmation E2E tests.
 *
 * Each session has a unique confirmation_token so the public confirmation
 * page can be tested without authentication. Tokens are simple repeated
 * hex chars for test readability.
 */
export const SEED_SESSIONS = {
  /** Confirmable session — future start_at, status='scheduled', has confirmation_token. */
  confirmable: {
    id: '00000000-0000-4000-8000-000000000030',
    patientId: SEED_PATIENTS.activeWithPhone.id,
    confirmationToken: 'd'.repeat(64),
  },
  /** Declinable session — future start_at, status='scheduled', has confirmation_token. */
  declinable: {
    id: '00000000-0000-4000-8000-000000000031',
    patientId: SEED_PATIENTS.activeMinimal.id,
    confirmationToken: 'e'.repeat(64),
  },
  /** Scheduled session for the cancel-session E2E test (section 17.1). */
  cancellable: {
    id: '00000000-0000-4000-8000-000000000032',
    patientId: SEED_PATIENTS.activeWithPhone.id,
  },
  /** Confirmed session for the mark-done E2E test (section 17.2). */
  confirmedForDone: {
    id: '00000000-0000-4000-8000-000000000033',
    patientId: SEED_PATIENTS.activeMinimal.id,
  },
  /** Scheduled session for the no-show E2E test (section 18.1). */
  forNoShow: {
    id: '00000000-0000-4000-8000-000000000034',
    patientId: SEED_PATIENTS.activeWithPhone.id,
  },
  /** Done session with old updated_at for the edit-lock E2E test (section 18.2). */
  lockedDone: {
    id: '00000000-0000-4000-8000-000000000035',
    patientId: SEED_PATIENTS.activeMinimal.id,
  },
} as const;

export const SEED_CONSENT_TERMS = {
  /** Unsigned consent term — the happy-path test will sign this one. */
  unsigned: {
    id: '00000000-0000-4000-8000-000000000020',
    patientId: SEED_PATIENTS.activeWithPhone.id,
    // 64-char hex token (deterministic for test assertions)
    signatureToken: 'a'.repeat(64),
    termText:
      'Eu, paciente, autorizo o tratamento psicologico conforme descrito neste documento. Este termo visa garantir o consentimento informado.',
  },
  /** Already-signed consent term — used to test the "already signed" state. */
  alreadySigned: {
    id: '00000000-0000-4000-8000-000000000021',
    patientId: SEED_PATIENTS.activeMinimal.id,
    signatureToken: 'b'.repeat(64),
    termText: 'Termo de consentimento ja assinado.',
  },
  /** Revoked consent term — used to test the "revoked" badge state. */
  revoked: {
    id: '00000000-0000-4000-8000-000000000022',
    patientId: SEED_PATIENTS.archived.id,
    signatureToken: 'c'.repeat(64),
    termText: 'Termo de consentimento revogado.',
  },
} as const;

/**
 * Seed AI consent terms for the AI transcription consent E2E tests.
 *
 * The token uses base64url encoding (43 chars for 32 bytes) — NOT hex.
 * We use a deterministic, manually-crafted base64url string for test
 * repeatability. It must be exactly 43 chars of [A-Za-z0-9_-].
 */
/**
 * Deterministic seed transcription for the full-pipeline E2E test.
 *
 * Seeded in global-setup.ts with status='pending' and a fake audio_object_key.
 * The test simulates pipeline completion by UPDATEing the row to 'ready'.
 */
export const SEED_AI_TRANSCRIPTIONS = {
  /** Pending transcription for activeMinimal — used by full-pipeline-mock-gemini.spec.ts */
  pendingPipeline: {
    id: '00000000-0000-4000-8000-000000000050',
    patientId: SEED_PATIENTS.activeMinimal.id,
    audioObjectKey: 'ai-audio/seed-user/test-pipeline-audio.mp3',
  },
  /**
   * Dedicated `ready` transcription for the review-and-save happy path
   * (review-and-save.spec.ts). Kept separate from `pendingPipeline` so the
   * full-pipeline spec's serial reset cannot race the save flow. Owned by the
   * seed user; patient is `activeMinimal`, which has a signed `ai_recording`
   * consent term (required by `saveTranscriptionToProntuario`).
   */
  readyForSave: {
    id: '00000000-0000-4000-8000-000000000051',
    patientId: SEED_PATIENTS.activeMinimal.id,
    audioObjectKey: 'ai-audio/seed-user/review-save-audio.mp3',
  },
  /**
   * Dedicated `ready` transcription for the discard flow
   * (review-discard.spec.ts). Discard does not require active consent, so any
   * owned patient works; we reuse `activeMinimal` for symmetry.
   */
  readyForDiscard: {
    id: '00000000-0000-4000-8000-000000000052',
    patientId: SEED_PATIENTS.activeMinimal.id,
    audioObjectKey: 'ai-audio/seed-user/review-discard-audio.mp3',
  },
} as const;

/**
 * Cross-tenant fixture for the IDOR negative-auth test
 * (review-idor-blocked.spec.ts).
 *
 * Psychologist A is a SECOND `auth.users`/`profiles` row that the mock GoTrue
 * never authenticates — the e2e session always belongs to the seed user
 * (psychologist B). A owns a `ready` transcription tied to A's own patient.
 * When B opens A's `transcriptionId`, `getTranscriptionForReview` must scope
 * the query to B and resolve NOT_FOUND (no data, no patient name leak).
 *
 * The patient name is deliberately unique so the test can assert it is ABSENT
 * from the rendered not-found page.
 */
export const SEED_IDOR = {
  psychologistA: {
    id: '00000000-0000-4000-8000-0000000000a0',
    email: 'psicologa-a@example.com',
  },
  patientA: {
    id: '00000000-0000-4000-8000-0000000000a1',
    fullName: 'Beatriz Confidencial Tenant A',
  },
  transcriptionA: {
    id: '00000000-0000-4000-8000-0000000000a2',
    audioObjectKey: 'ai-audio/psicologa-a/idor-audio.mp3',
  },
} as const;

/**
 * Dedicated zero-data user for the dashboard first-steps E2E test
 * (dashboard/dashboard-home.spec.ts).
 *
 * The GLOBAL seed user always owns the three `SEED_PATIENTS` rows, so its
 * dashboard can never reach the empty state (`hasAnyData` is permanently true).
 * Deleting those patients to force the empty state is unsafe — patient/agenda
 * spec files run in parallel against the same reused database and depend on
 * them existing.
 *
 * This is therefore a SECOND `auth.users` + `profiles` row (status='active')
 * that owns NO patients and NO sessions. The mock GoTrue never authenticates it
 * by default; the dashboard spec registers it at runtime via
 * `POST /_test/register-oauth-user` and signs the browser in with a cookie it
 * builds itself, so it can load `/dashboard` as a genuinely empty account
 * without touching the shared seed user's data.
 */
export const SEED_DASHBOARD_EMPTY_USER = {
  id: '00000000-0000-4000-8000-0000000000d0',
  email: 'painel-vazio@example.com',
  fullName: 'Painel Vazio',
} as const;

export const SEED_AI_CONSENT_TERMS = {
  /** Unsigned AI consent term — the happy-path test will sign this one. */
  unsigned: {
    id: '00000000-0000-4000-8000-000000000040',
    patientId: SEED_PATIENTS.activeWithPhone.id,
    // 43-char base64url token (deterministic for test assertions)
    // 43 chars = 32 bytes in base64url (ceil(32*4/3) = 43)
    signatureToken: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtU01',
  },
  /** Already-signed AI consent term — used to test the "already signed" state. */
  alreadySigned: {
    id: '00000000-0000-4000-8000-000000000041',
    patientId: SEED_PATIENTS.activeMinimal.id,
    signatureToken: 'XxYyZz00112233445566778899AaBbCcDdEeFfGgH01',
  },
} as const;

export type SeedState = {
  // Stable UUID seeded into `auth.users` by `global-setup.ts`. Tests can
  // assert that the dashboard greeting matches `email`, so changes here
  // need to ripple to `auth.spec.ts`.
  userId: string;
  email: string;
  // The bearer token the mock GoTrue accepts. Everything above the cookie
  // must encode this value or the mock returns 401 and the dashboard render
  // collapses to `null`.
  accessToken: string;
  refreshToken: string;
  // Mock GoTrue origin (e.g. `http://127.0.0.1:43219`). Captured here so the
  // setup project can pass it to `createServerClient` without re-reading
  // `process.env` (which is set in the parent process — workers inherit a
  // snapshot, but writing it into the seed state keeps the contract local).
  supabaseUrl: string;
  // Connection string for the Testcontainers Postgres started by the
  // webServer wrapper. `globalSetup` uses this to seed the auth.users row;
  // tests that need direct DB access can also pick it up from here.
  databaseUrl: string;
};

export async function writeSeedState(state: SeedState): Promise<void> {
  await mkdir(path.dirname(SEED_STATE_PATH), { recursive: true });
  await writeFile(SEED_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export async function readSeedState(): Promise<SeedState> {
  const raw = await readFile(SEED_STATE_PATH, 'utf8');
  return JSON.parse(raw) as SeedState;
}

/**
 * Stable key for the cross-worker Postgres advisory lock that guards the shared
 * seeded `profiles.onboarding_step` row.
 *
 * The seeded `active` user is GLOBAL: both `onboarding/welcome.spec.ts` and
 * `onboarding/wizard-flow.spec.ts` mutate that single row's `onboarding_step`,
 * and the seeded e2e suite runs `fullyParallel` across multiple workers. With
 * the wizard's strict forward-only guard, a concurrent skip from one spec that
 * advances the row to `done` can redirect the other spec away from the step it
 * expects. Each spec acquires this advisory lock for the duration of its
 * DB-mutating + navigation section (via `pg_advisory_lock` / `pg_advisory_unlock`
 * on its own connection), making the two specs mutually exclusive WITHOUT
 * serializing the whole suite — honest synchronization of a shared fixture, not
 * a behavioural workaround.
 */
export const ONBOARDING_PROFILE_LOCK_KEY = 770_011;
