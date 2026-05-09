import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';

import { readSeedState, SEED_CONSENT_TERMS, SEED_PATIENTS } from './seed-state';

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

    const p = SEED_PATIENTS;
    for (const [patient, status, phone] of [
      [p.activeWithPhone, 'active', p.activeWithPhone.phone] as const,
      [p.activeMinimal, 'active', null] as const,
      [p.archived, 'archived', null] as const,
    ]) {
      await sql`
        INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status, archived_at)
        VALUES (
          ${patient.id}, ${seed.userId}, ${patient.fullName}, 'individual',
          ${phone}, ${'tags' in patient ? [...patient.tags] : sql`'{}'::text[]`},
          ${status}, ${status === 'archived' ? sql`now()` : null}
        )
        ON CONFLICT (id) DO UPDATE SET
          full_name  = EXCLUDED.full_name,
          phone      = EXCLUDED.phone,
          tags       = EXCLUDED.tags,
          status     = EXCLUDED.status,
          archived_at = EXCLUDED.archived_at;
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
  } finally {
    await sql.end();
  }
}
