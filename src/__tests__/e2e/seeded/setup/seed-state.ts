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

/**
 * Dedicated user for the onboarding-checklist E2E test
 * (onboarding/checklist.spec.ts).
 *
 * The GLOBAL seed user already owns the three `SEED_PATIENTS`, a session, and a
 * signed consent term, so its mandatory checklist is permanently part-done and
 * mutating it (or its `onboarding_checklist` cache) would pollute the many
 * sibling specs that share it under `fullyParallel`. This is therefore a
 * SECOND active `auth.users` + `profiles` row that owns NO patients and NO
 * sessions, so the checklist spec OWNS its state end-to-end: it starts from a
 * known-partial state (only `cadastro_completo` true — email verified + CRP
 * validated), then writes the owner's own data rows to flip items and assert
 * the recompute reflects them, up to mandatory 100%.
 *
 * `crp_validated_at`/`email_verified_at` are forced in `global-setup.ts` so the
 * `cadastro_completo` item is always done; everything else (location, patient,
 * session, evolution, consent, AI) is absent at the start of every run (reset on
 * the reused container) and the spec adds exactly what it needs.
 *
 * The mock GoTrue never authenticates this user by default; the spec registers
 * it at runtime via `POST /_test/register-oauth-user` and signs the browser in
 * with a cookie it builds itself (same approach as the dashboard zero-data
 * user).
 */
export const SEED_ONBOARDING_CHECKLIST_USER = {
  id: '00000000-0000-4000-8000-0000000000c1',
  email: 'checklist-e2e@example.com',
  fullName: 'Checklist E2E',
} as const;

/**
 * Dedicated user for the end-to-end NPS day-7 flow E2E test
 * (nps/day7-modal.spec.ts).
 *
 * The day-7 NPS modal auto-opens on the FIRST eligible `(app)` render (gate:
 * `first_access_at` ≥ 7 days ago AND `nps_responded_at IS NULL`) and a Radix
 * Dialog renders a full-screen overlay that intercepts pointer events across the
 * whole shell. Driving this on the
 * GLOBAL seed user would make the modal pop on every parallel `/dashboard` spec
 * and block their clicks; mutating the shared user's `first_access_at` /
 * `nps_responded_at` would also leak across siblings under `fullyParallel`.
 *
 * This is therefore a SEPARATE active `auth.users` + `profiles` row touched by
 * NOTHING else, so the spec OWNS its NPS state end-to-end: it sets
 * `first_access_at` to 7+ days ago and `nps_responded_at` to NULL to make the
 * modal eligible, then drives submit / dismiss / reload assertions and the
 * later-answer path via Configurações > Feedback.
 *
 * The mock GoTrue never authenticates this user by default; the spec signs in at
 * runtime via the shared `signInAsDedicatedUser` helper.
 */
export const SEED_NPS_USER = {
  id: '00000000-0000-4000-8000-0000000000c5',
  email: 'nps-e2e@example.com',
  fullName: 'NPS E2E',
} as const;

/**
 * Dedicated user for the patients consent-filter E2E spec
 * (patients/consent-filter.spec.ts — PRD §12, section 6).
 *
 * The "sem-consentimento" pendência listing's header count MUST equal the
 * dashboard pendência count for the SAME user (RF-12.18 / RN-12.03), and the
 * filtered set must contain ONLY active patients with no signed consent. Driving
 * this on the GLOBAL seed user is unsafe: its three `SEED_PATIENTS` rows are read
 * (and their consent state asserted) by many sibling specs under
 * `fullyParallel`, so adding/removing unconsented patients there would shift
 * their counts and break them. Mutating the shared user is exactly the hazard the
 * checklist/nps dedicated users were created to avoid.
 *
 * This is therefore a SEPARATE active `auth.users` + `profiles` row touched by
 * NOTHING else, owning a deterministic patient set seeded in `global-setup.ts`:
 *
 *   - `adultWithPhone`    — active, unconsented, individual, has phone
 *   - `minorWithGuardian` — active, unconsented, `child`, primary guardian w/ phone
 *   - `adultNoPhone`      — active, unconsented, individual, NO phone (WhatsApp
 *                            disabled, copy-link still works)
 *   - `signedAdult`       — active, consent SIGNED (consent_signed_at set) → MUST
 *                            NOT appear in the filtered list
 *   - `archivedNoConsent` — archived, unconsented → MUST NOT appear
 *   - `copyTarget`        — active, unconsented, has phone, NO pre-seeded consent
 *                            term — used by the copy-link/no-duplicate test so it
 *                            can assert the term count goes 0 → 1 → 1.
 *
 * So the missing-consent count is deterministically 4 (adultWithPhone,
 * minorWithGuardian, adultNoPhone, copyTarget — the four ACTIVE unconsented
 * rows). `signedAdult` and `archivedNoConsent` are the negative cases.
 *
 * `first_access_at` is left NULL in
 * `global-setup.ts` so the day-7 NPS modal does not
 * auto-run and intercept the row-action clicks this spec needs. The mock
 * GoTrue never authenticates this user by default; the spec signs in at runtime
 * via the shared `signInAsDedicatedUser` helper.
 */
export const SEED_CONSENT_FILTER_USER = {
  id: '00000000-0000-4000-8000-0000000000f0',
  email: 'consent-filter-e2e@example.com',
  fullName: 'Consent Filter E2E',
  patients: {
    /** Active, unconsented, adult with a phone — WhatsApp uses the patient's own number. */
    adultWithPhone: {
      id: '00000000-0000-4000-8000-0000000000f1',
      fullName: 'Filtro Adulto Com Telefone',
      phone: '+55 11 98888-0001',
    },
    /** Active, unconsented minor — WhatsApp uses the PRIMARY GUARDIAN's phone. */
    minorWithGuardian: {
      id: '00000000-0000-4000-8000-0000000000f2',
      fullName: 'Filtro Menor Com Responsavel',
      guardianId: '00000000-0000-4000-8000-0000000000fa',
      guardianPhone: '+55 11 97777-0002',
    },
    /** Active, unconsented adult WITHOUT a phone — WhatsApp disabled, copy-link works. */
    adultNoPhone: {
      id: '00000000-0000-4000-8000-0000000000f3',
      fullName: 'Filtro Adulto Sem Telefone',
    },
    /** Active patient WITH a signed consent — must be EXCLUDED from the filter. */
    signedAdult: {
      id: '00000000-0000-4000-8000-0000000000f4',
      fullName: 'Filtro Adulto Com Consentimento',
      // Pre-signed consent term (deterministic 64-char hex token).
      consentTermId: '00000000-0000-4000-8000-0000000000fb',
      signatureToken: 'f1'.repeat(32),
    },
    /** Archived patient WITHOUT consent — must be EXCLUDED from the filter. */
    archivedNoConsent: {
      id: '00000000-0000-4000-8000-0000000000f5',
      fullName: 'Filtro Adulto Arquivado',
    },
    /**
     * Active, unconsented adult with phone and NO pre-seeded consent term — used
     * by the copy-link/no-duplicate test (term count goes 0 → 1 → 1). Kept
     * separate from `adultWithPhone` so the count assertions can't race other
     * row actions on the same page.
     */
    copyTarget: {
      id: '00000000-0000-4000-8000-0000000000f6',
      fullName: 'Filtro Adulto Copia Link',
      phone: '+55 11 96666-0003',
    },
  },
} as const;

/**
 * Dedicated user for the overdue-evolutions list E2E spec
 * (agenda/overdue-evolutions-list.spec.ts — PRD §9 / §12, section 6).
 *
 * The list-mode destination `/agenda?filtro=sem-evolucao` shows every `done`
 * session older than 7 days with NO evolution (owner-scoped), and its header
 * count MUST equal the dashboard pendência count for the SAME user (RF-12.18).
 * The resolve flow (RF-12.10) also CREATES and DELETES evolutions against this
 * user's rows on return from the create page. Both behaviours mutate clinical
 * data and depend on a deterministic overdue set, so driving them on the GLOBAL
 * seed user is unsafe: its sessions/evolutions are read by many sibling specs
 * under `fullyParallel`, and several specs add/remove overdue sessions on it
 * (e.g. dashboard-home.spec), which would shift this spec's count and ordering.
 *
 * This is therefore a SEPARATE active `auth.users` + `profiles` row touched by
 * NOTHING else, owning a deterministic data set seeded in `global-setup.ts`:
 *
 *   - `overdueOldest`  — `done` 30 days ago, NO evolution → row 1 (oldest-first)
 *   - `overdueMiddle`  — `done` 20 days ago, NO evolution → row 2
 *   - `overdueNewest`  — `done` 10 days ago, NO evolution → row 3
 *   - `recentDone`     — `done` 2 days ago (inside the 7-day window) → EXCLUDED
 *   - `oldDoneEvolved` — `done` 25 days ago WITH a seeded evolution → EXCLUDED
 *
 * So the overdue count is deterministically 3, ordered oldest-first
 * (overdueOldest, overdueMiddle, overdueNewest). The resolve test creates an
 * evolution for `overdueNewest` (and deletes it in afterEach), proving the row
 * disappears and the count drops to 2 on return.
 *
 * `first_access_at`/`nps_responded_at` are left
 * so the day-7 NPS modal does not auto-run and
 * intercept the clicks this spec needs. The mock GoTrue never authenticates
 * this user by default; the spec signs in at runtime via the shared
 * `signInAsDedicatedUser` helper.
 */
export const SEED_OVERDUE_EVOLUTIONS_USER = {
  id: '00000000-0000-4000-8000-0000000000e0',
  email: 'overdue-evolucoes-e2e@example.com',
  fullName: 'Overdue Evolucoes E2E',
  /** Single patient owning every seeded session for this user. */
  patient: {
    id: '00000000-0000-4000-8000-0000000000e1',
    fullName: 'Paciente Sem Evolucao',
  },
  sessions: {
    /** `done` 30 days ago, no evolution → oldest overdue row (top of list). */
    overdueOldest: {
      id: '00000000-0000-4000-8000-0000000000e2',
      ageDays: 30,
    },
    /** `done` 20 days ago, no evolution → middle overdue row. */
    overdueMiddle: {
      id: '00000000-0000-4000-8000-0000000000e3',
      ageDays: 20,
    },
    /** `done` 10 days ago, no evolution → newest overdue row (resolved by 6.3). */
    overdueNewest: {
      id: '00000000-0000-4000-8000-0000000000e4',
      ageDays: 10,
    },
    /** `done` 2 days ago — inside the 7-day window → EXCLUDED from the list. */
    recentDone: {
      id: '00000000-0000-4000-8000-0000000000e5',
      ageDays: 2,
    },
    /** `done` 25 days ago WITH a seeded evolution → EXCLUDED (anti-join). */
    oldDoneEvolved: {
      id: '00000000-0000-4000-8000-0000000000e6',
      ageDays: 25,
      evolutionId: '00000000-0000-4000-8000-0000000000e7',
    },
  },
} as const;

/**
 * Dedicated user for the patient session-history E2E spec
 * (patient-session-history/session-history.spec.ts — PRD §13, section 10).
 *
 * The session-history tab surfaces owner-scoped aggregates (realized total,
 * attendance rate, pending-evolution count), a future "Próxima sessão", a
 * month-grouped historical list with keyset pagination (page size 12), status
 * filter chips, per-card evolution CTAs ("Registrar" / "Ver"), a couple tag with
 * NO partner data, and an "Abrir na agenda" deep-link. Every one of those
 * assertions is count- and ordering-sensitive, so the spec needs a deterministic
 * session set it fully owns.
 *
 * Driving this on the GLOBAL seed user is unsafe: its three `SEED_PATIENTS` rows
 * and their sessions are read (and asserted) by many sibling specs under
 * `fullyParallel`, and several specs add/remove/mutate sessions on it — which
 * would shift this spec's summary counts, pagination boundary, and list ordering.
 *
 * This is therefore a SEPARATE active `auth.users` + `profiles` row touched by
 * NOTHING else, owning two patients seeded deterministically in
 * `global-setup.ts`:
 *
 *   - `withHistory` — owns a fixed terminal-session set so:
 *       • doneTotal            = 14 (13 individual `done` + 1 couple `done`)
 *       • cancelled (patient)  =  1
 *       • no_show              =  1
 *       • attendanceRate       = round(14 / (14+1+1) * 100) = 88%
 *       • doneWithoutEvolution = 13 (1 of the 13 individual dones is evolved)
 *       • a single future `scheduled` session (the "Próxima sessão")
 *     So the unfiltered history list has 16 rows (the future session is rendered
 *     separately and excluded), exceeding the page size of 12 → exactly one
 *     "Carregar mais" reveals the remaining 4. The "Realizadas" filter yields 14
 *     done rows → first page 12 + one load-more reveals 2. One individual `done`
 *     carries an evolution ("Ver"); the rest show "Registrar". The couple `done`
 *     carries `patient_ids = [withHistory, partnerHidden]` so the card shows the
 *     "Sessão de casal" tag while the projection never exposes the partner.
 *
 *   - `noHistory` — owns NO sessions, so its tab renders the empty state with the
 *     "Agendar primeira sessão" CTA pointing at `/agenda`.
 *
 * `first_access_at` is left NULL in
 * `global-setup.ts` so the day-7 NPS modal does not
 * auto-run and intercept the tab/chip/CTA clicks this spec needs. The mock
 * GoTrue never authenticates this user by default; the spec signs in at runtime
 * via the shared `signInAsDedicatedUser` helper.
 */
export const SEED_SESSION_HISTORY_USER = {
  id: '00000000-0000-4000-8000-0000000000b0',
  email: 'session-history-e2e@example.com',
  fullName: 'Session History E2E',
  patients: {
    /** Owns the full deterministic terminal-session set + the future session. */
    withHistory: {
      id: '00000000-0000-4000-8000-0000000000b1',
      fullName: 'Paciente Com Historico',
    },
    /** Owns NO sessions — drives the empty state. */
    noHistory: {
      id: '00000000-0000-4000-8000-0000000000b2',
      fullName: 'Paciente Sem Historico',
    },
    /**
     * Partner of the couple `done` session. Its id appears only inside the couple
     * session's `patient_ids` array — the spec asserts this patient's NAME never
     * surfaces on the history card (couple-safe projection, LGPD-13.03).
     */
    partnerHidden: {
      id: '00000000-0000-4000-8000-0000000000b3',
      fullName: 'Parceiro Confidencial Casal',
    },
  },
  sessions: {
    /** The future `scheduled` session → "Próxima sessão" + "Abrir na agenda". */
    future: {
      id: '00000000-0000-4000-8000-0000000000b4',
    },
    /** The one individual `done` session WITH an evolution → "Ver". */
    doneEvolved: {
      id: '00000000-0000-4000-8000-0000000000b5',
      evolutionId: '00000000-0000-4000-8000-0000000000b6',
    },
    /** The couple `done` session (carries `patient_ids`) → "Sessão de casal". */
    doneCouple: {
      id: '00000000-0000-4000-8000-0000000000b7',
    },
  },
  /** Page size used by the history list — keep in sync with `HISTORY_LIMIT_DEFAULT`. */
  pageSize: 12,
  counts: {
    /** Individual `done` sessions WITHOUT an evolution (each shows "Registrar"). */
    doneWithoutEvolution: 12,
    /** Patient-initiated cancellations. */
    cancelledByPatient: 1,
    /** No-show sessions. */
    noShow: 1,
    /** Total `done` (13 individual + 1 couple). */
    doneTotal: 14,
    /** Total historical rows in the unfiltered list (excludes the future session). */
    historyTotal: 16,
    /** Attendance rate: round(14 / (14 + 1 + 1) * 100). */
    attendanceRate: 88,
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
