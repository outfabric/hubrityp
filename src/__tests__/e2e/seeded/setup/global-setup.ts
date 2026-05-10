import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';

import { readSeedState, SEED_CONSENT_TERMS, SEED_PATIENTS, SEED_SESSIONS } from './seed-state';

// Playwright runs `globalSetup` AFTER the `webServer` plugin starts (see
// Playwright's `runner/tasks.ts::createGlobalSetupTasks`), so by the time
// we get here the wrapper at `src/__tests__/e2e/seeded/setup/start-server.ts`
// has already:
//
//   • booted the Testcontainers Postgres,
//   • applied Drizzle migrations,
//   • started the mock GoTrue,
//   • written `src/__tests__/e2e/seeded/setup/.auth/seed-state.json`,
//   • spawned `next start` with the resolved env vars.
//
// All this hook does is seed the user + ping rows that the auth and health
// flows rely on. We keep this seeding here (rather than in start-server) so
// failures during seeding surface in Playwright's globalSetup logs and the
// run aborts cleanly instead of leaving the webServer dangling on a
// half-seeded DB.
export default async function globalSetup() {
  const seed = await readSeedState();

  const sql = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    // `auth.users` is bootstrapped by the postgres-container helper — the
    // schema already exists. We seed the deterministic UUID + email the
    // mock GoTrue echoes back from `GET /auth/v1/user`. `ON CONFLICT`
    // keeps the seed idempotent across reused containers.
    //
    // `raw_user_meta_data` carries the fields the `handle_new_user()`
    // SECURITY DEFINER trigger requires to materialize the corresponding
    // `profiles` row (introduced by the auth-account-creation change).
    // Without these fields the AFTER INSERT trigger raises an exception
    // and the auth.users INSERT rolls back. We pass the JSON as a string
    // and cast on the SQL side because postgres.js binds objects via
    // `sql.json(...)` only inside the tagged template's specific helper
    // overloads, which is more brittle here than a literal cast.
    const nowIso = new Date().toISOString();
    const metadata = JSON.stringify({
      fullName: 'Seed User',
      crpNumber: '00000-S',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${seed.userId},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${seed.email},
        ${metadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    // Force the seeded user's profile to `active` so the e2e suite can
    // exercise the dashboard surface end-to-end (the trigger initialises
    // `status = 'pending_verification'`, which middleware would redirect
    // to `/onboarding/pending` instead). The UPDATE is idempotent and
    // safe to run on already-active rows.
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          failed_login_count = 0,
          last_failed_login_at = NULL,
          lockout_until = NULL,
          consecutive_lockouts = 0,
          requires_password_reset = false
      WHERE user_id = ${seed.userId};
    `;

    await db
      .insert(healthPings)
      .values({ ownerId: seed.userId, note: 'e2e-seed ping' })
      .onConflictDoNothing();

    // Clean up stale data from previous test runs so all e2e tests start
    // with a deterministic blank slate. With Testcontainers `.withReuse()`
    // the DB persists across runs, and leftovers cause spurious failures
    // (duplicate detection, non-empty states, wrong consent badges, etc.).
    await sql`DELETE FROM public.session_history WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${seed.userId}`;

    // Delete non-seeded patients (e.g. those created by the CSV import test)
    // while keeping the three deterministic seed patients intact.
    const seededPatientIds = [
      SEED_PATIENTS.activeWithPhone.id,
      SEED_PATIENTS.activeMinimal.id,
      SEED_PATIENTS.archived.id,
    ];
    await sql`
      DELETE FROM public.consent_terms
      WHERE user_id = ${seed.userId}
        AND patient_id NOT IN ${sql(seededPatientIds)};
    `;
    await sql`
      DELETE FROM public.patients
      WHERE user_id = ${seed.userId}
        AND id NOT IN ${sql(seededPatientIds)};
    `;

    const p = SEED_PATIENTS;
    for (const [patient, status, phone] of [
      [p.activeWithPhone, 'active', p.activeWithPhone.phone] as const,
      [p.activeMinimal, 'active', null] as const,
      [p.archived, 'archived', null] as const,
    ]) {
      await sql`
        INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status, archived_at, consent_signed_at, consent_revoked_at)
        VALUES (
          ${patient.id}, ${seed.userId}, ${patient.fullName}, 'individual',
          ${phone}, ${'tags' in patient ? [...patient.tags] : sql`'{}'::text[]`},
          ${status}, ${status === 'archived' ? sql`now()` : null},
          NULL, NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          full_name          = EXCLUDED.full_name,
          phone              = EXCLUDED.phone,
          tags               = EXCLUDED.tags,
          status             = EXCLUDED.status,
          archived_at        = EXCLUDED.archived_at,
          consent_signed_at  = NULL,
          consent_revoked_at = NULL;
      `;
    }

    // Seed sessions for the public confirmation E2E tests.
    // Each session needs a future start_at (so the token is not expired),
    // a confirmation_token, and status='scheduled'.
    const s = SEED_SESSIONS;
    for (const session of [s.confirmable, s.declinable]) {
      await sql`
        INSERT INTO public.sessions (
          id, user_id, patient_id,
          start_at, end_at, duration_minutes,
          status, is_blocking, confirmation_token
        )
        VALUES (
          ${session.id},
          ${seed.userId},
          ${session.patientId},
          now() + interval '2 days',
          now() + interval '2 days' + interval '50 minutes',
          50,
          'scheduled',
          false,
          ${session.confirmationToken}
        )
        ON CONFLICT (id) DO UPDATE SET
          start_at           = EXCLUDED.start_at,
          end_at             = EXCLUDED.end_at,
          duration_minutes   = EXCLUDED.duration_minutes,
          status             = EXCLUDED.status,
          confirmation_token = EXCLUDED.confirmation_token,
          confirmed_at       = NULL,
          cancelled_at       = NULL,
          cancellation_reason = NULL,
          cancelled_by       = NULL,
          cancellation_notice = NULL,
          charge_cancellation = false,
          deleted_at         = NULL;
      `;
    }

    // Seed sessions for status change E2E tests (sections 17–18).
    // Each session is seeded at a distinct BRT hour tomorrow to avoid time
    // collisions with other e2e tests (session-create: 14:00, drag-drop:
    // 08:00–10:00, block-create: 12:00). We use `(current_date + 1 day)`
    // anchored at midnight UTC, then add enough hours to land within BRT
    // business hours (BRT = UTC-3, so 10:00 BRT = 13:00 UTC).
    //
    // Time assignments (BRT): cancel=19:00, markDone=11:00, noShow=09:00, lock=20:00
    // These times are chosen to avoid conflicts with pre-existing parallel
    // tests that create sessions at: 08:00-10:00 (drag-drop), 12:00-13:00
    // (block-create), 14:00 (session-create), 15:00 (recurring-session-create),
    // 16:00 (recurring-session-edit-scope), 17:00 (couple-session).

    // 17.1 — cancellable: scheduled session tomorrow at 19:00 BRT (22:00 UTC)
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking
      )
      VALUES (
        ${SEED_SESSIONS.cancellable.id},
        ${seed.userId},
        ${SEED_SESSIONS.cancellable.patientId},
        (current_date + interval '1 day' + interval '22 hours'),
        (current_date + interval '1 day' + interval '22 hours 50 minutes'),
        50, 'scheduled', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at           = EXCLUDED.start_at,
        end_at             = EXCLUDED.end_at,
        duration_minutes   = EXCLUDED.duration_minutes,
        status             = EXCLUDED.status,
        confirmed_at       = NULL,
        cancelled_at       = NULL,
        cancellation_reason = NULL,
        cancelled_by       = NULL,
        cancellation_notice = NULL,
        charge_cancellation = false,
        updated_at         = now(),
        deleted_at         = NULL;
    `;

    // 17.2 — confirmedForDone: confirmed session tomorrow at 11:00 BRT (14:00 UTC)
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking, confirmed_at
      )
      VALUES (
        ${SEED_SESSIONS.confirmedForDone.id},
        ${seed.userId},
        ${SEED_SESSIONS.confirmedForDone.patientId},
        (current_date + interval '1 day' + interval '14 hours'),
        (current_date + interval '1 day' + interval '14 hours 50 minutes'),
        50, 'confirmed', false, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at           = EXCLUDED.start_at,
        end_at             = EXCLUDED.end_at,
        duration_minutes   = EXCLUDED.duration_minutes,
        status             = EXCLUDED.status,
        confirmed_at       = EXCLUDED.confirmed_at,
        cancelled_at       = NULL,
        cancellation_reason = NULL,
        cancelled_by       = NULL,
        cancellation_notice = NULL,
        charge_cancellation = false,
        updated_at         = now(),
        deleted_at         = NULL;
    `;

    // 18.1 — forNoShow: scheduled session tomorrow at 09:00 BRT (12:00 UTC)
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking
      )
      VALUES (
        ${SEED_SESSIONS.forNoShow.id},
        ${seed.userId},
        ${SEED_SESSIONS.forNoShow.patientId},
        (current_date + interval '1 day' + interval '12 hours'),
        (current_date + interval '1 day' + interval '12 hours 50 minutes'),
        50, 'scheduled', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at           = EXCLUDED.start_at,
        end_at             = EXCLUDED.end_at,
        duration_minutes   = EXCLUDED.duration_minutes,
        status             = EXCLUDED.status,
        confirmed_at       = NULL,
        cancelled_at       = NULL,
        cancellation_reason = NULL,
        cancelled_by       = NULL,
        cancellation_notice = NULL,
        charge_cancellation = false,
        updated_at         = now(),
        deleted_at         = NULL;
    `;

    // 18.2 — lockedDone: done session tomorrow at 20:00 BRT (23:00 UTC), updated 8 days ago
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking, updated_at
      )
      VALUES (
        ${SEED_SESSIONS.lockedDone.id},
        ${seed.userId},
        ${SEED_SESSIONS.lockedDone.patientId},
        (current_date + interval '1 day' + interval '23 hours'),
        (current_date + interval '1 day' + interval '23 hours 50 minutes'),
        50, 'done', false, now() - interval '8 days'
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at           = EXCLUDED.start_at,
        end_at             = EXCLUDED.end_at,
        duration_minutes   = EXCLUDED.duration_minutes,
        status             = EXCLUDED.status,
        confirmed_at       = NULL,
        cancelled_at       = NULL,
        cancellation_reason = NULL,
        cancelled_by       = NULL,
        cancellation_notice = NULL,
        charge_cancellation = false,
        updated_at         = now() - interval '8 days',
        deleted_at         = NULL;
    `;

    // Seed history entries for each status-test session so the drawer
    // timeline is non-empty (mirrors what create-session writes).
    for (const sessId of [
      SEED_SESSIONS.cancellable.id,
      SEED_SESSIONS.confirmedForDone.id,
      SEED_SESSIONS.forNoShow.id,
      SEED_SESSIONS.lockedDone.id,
    ]) {
      await sql`
        INSERT INTO public.session_history (id, session_id, user_id, action, changes)
        VALUES (
          gen_random_uuid(), ${sessId}, ${seed.userId},
          'created', '{"status":{"new":"scheduled"}}'::jsonb
        )
        ON CONFLICT DO NOTHING;
      `;
    }

    // Seed consent terms for the consent signing e2e tests.
    const ct = SEED_CONSENT_TERMS;

    // Unsigned consent term — patient can sign this one
    await sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, term_text, signature_token)
      VALUES (
        ${ct.unsigned.id},
        ${ct.unsigned.patientId},
        ${seed.userId},
        ${ct.unsigned.termText},
        ${ct.unsigned.signatureToken}
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        signed_at       = NULL,
        signed_ip       = NULL,
        signed_user_agent = NULL,
        revoked_at      = NULL;
    `;

    // Already-signed consent term — used to test "already signed" state
    await sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, term_text, signature_token, signed_at, signed_ip, signed_user_agent)
      VALUES (
        ${ct.alreadySigned.id},
        ${ct.alreadySigned.patientId},
        ${seed.userId},
        ${ct.alreadySigned.termText},
        ${ct.alreadySigned.signatureToken},
        now(),
        '127.0.0.1',
        'e2e-seed-agent'
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        signed_at       = EXCLUDED.signed_at,
        signed_ip       = EXCLUDED.signed_ip,
        signed_user_agent = EXCLUDED.signed_user_agent,
        revoked_at      = NULL;
    `;

    // Mark the patient with the signed consent as having consent_signed_at set
    await sql`
      UPDATE public.patients
      SET consent_signed_at = now()
      WHERE id = ${ct.alreadySigned.patientId};
    `;

    // Revoked consent term — used to test the "revoked" badge state
    await sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, term_text, signature_token, signed_at, signed_ip, signed_user_agent, revoked_at)
      VALUES (
        ${ct.revoked.id},
        ${ct.revoked.patientId},
        ${seed.userId},
        ${ct.revoked.termText},
        ${ct.revoked.signatureToken},
        now() - interval '7 days',
        '127.0.0.1',
        'e2e-seed-agent',
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text         = EXCLUDED.term_text,
        signature_token   = EXCLUDED.signature_token,
        signed_at         = EXCLUDED.signed_at,
        signed_ip         = EXCLUDED.signed_ip,
        signed_user_agent = EXCLUDED.signed_user_agent,
        revoked_at        = EXCLUDED.revoked_at;
    `;

    // Mark the patient with the revoked consent (cleared consent_signed_at, set consent_revoked_at)
    await sql`
      UPDATE public.patients
      SET consent_signed_at = NULL,
          consent_revoked_at = now()
      WHERE id = ${ct.revoked.patientId};
    `;
  } finally {
    await sql.end();
  }
}
