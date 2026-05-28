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
