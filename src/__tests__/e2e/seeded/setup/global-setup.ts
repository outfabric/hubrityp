import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';

import {
  readSeedState,
  SEED_AI_CONSENT_TERMS,
  SEED_AI_STATS_USER,
  SEED_AI_TRANSCRIPTIONS,
  SEED_ATTACHMENTS_PATIENT,
  SEED_CONSENT_FILTER_USER,
  SEED_CONSENT_TERMS,
  SEED_DASHBOARD_EMPTY_USER,
  SEED_IDOR,
  SEED_NPS_USER,
  SEED_ONBOARDING_CHECKLIST_USER,
  SEED_ONBOARDING_REACTIVATED_USER,
  SEED_ONBOARDING_WIZARD_USER,
  SEED_OVERDUE_EVOLUTIONS_USER,
  SEED_PATIENTS,
  SEED_SESSION_HISTORY_USER,
  SEED_SESSIONS,
  SEED_WHATSAPP_CONSENT_USER,
} from './seed-state';

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
    // The GLOBAL seed user is permanently onboarding-COMPLETE: under the
    // reworked middleware gating an `active` user with INCOMPLETE onboarding is
    // funneled into `/onboarding/welcome`, which would break every `/dashboard`
    // spec sharing this row's storageState. First-run-wizard behaviour is
    // exercised by dedicated incomplete-onboarding users instead. We stamp the
    // real DB (not just the Edge shim) so the layout's UnfinishedSetupBanner and
    // every RSC onboarding read also see "complete".
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          failed_login_count = 0,
          last_failed_login_at = NULL,
          lockout_until = NULL,
          consecutive_lockouts = 0,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
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

    // AI transcription rows — stale rows from previous upload-flow tests
    // would cause assertion mismatches (extra rows, wrong status).
    await sql`DELETE FROM public.ai_transcriptions WHERE user_id = ${seed.userId}`;

    // WhatsApp tables — delete in FK order (conversations → messages →
    // templates → settings → accounts). Stale whatsapp_accounts rows
    // (especially with status='error') from previous runs cause the
    // whatsapp-connect E2E to see "Erro de conexão" instead of
    // "Não conectado" when running in parallel with tests that seed
    // the same user's account.
    await sql`DELETE FROM public.whatsapp_conversations WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.whatsapp_messages WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.message_templates WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.reminder_settings WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${seed.userId}`;

    // Telepsicologia tables — delete in FK order (video_session_logs →
    // video_recordings → video_rooms → sessions). video_rooms has a FK to
    // sessions, so it must be deleted first.
    await sql`DELETE FROM public.video_session_logs WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.video_recordings WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.video_rooms WHERE user_id = ${seed.userId}`;

    await sql`DELETE FROM public.session_history WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${seed.userId}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${seed.userId}`;

    // Delete non-seeded patients (e.g. those created by the CSV import test)
    // while keeping the three deterministic seed patients intact.
    const seededPatientIds = [
      SEED_PATIENTS.activeWithPhone.id,
      SEED_PATIENTS.activeMinimal.id,
      SEED_PATIENTS.archived.id,
      SEED_ATTACHMENTS_PATIENT.id,
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

    // Dedicated patient for prontuario/attachments-and-notes.spec.ts. That spec
    // blank-slates its patient's consent state (nulls consent + deletes every
    // consent_terms row), which would otherwise wipe the AI-consent fixtures the
    // termo-ai-flow spec depends on if they shared `activeMinimal`. Owned by the
    // seed user (so the spec keeps the shared storageState); starts with no
    // consent terms. See SEED_ATTACHMENTS_PATIENT for the full rationale.
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at, consent_signed_at, consent_revoked_at)
      VALUES (
        ${SEED_ATTACHMENTS_PATIENT.id}, ${seed.userId}, ${SEED_ATTACHMENTS_PATIENT.fullName},
        'individual', 'active', NULL, NULL, NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id            = EXCLUDED.user_id,
        full_name          = EXCLUDED.full_name,
        status             = 'active',
        archived_at        = NULL,
        consent_signed_at  = NULL,
        consent_revoked_at = NULL;
    `;

    // Seed sessions for the public confirmation E2E tests.
    // Each session needs a future start_at (so the token is not expired),
    // a confirmation_token, and status='scheduled'.
    //
    // We anchor on the BRT date (same pattern as the status-change sessions)
    // rather than `now() + interval '2 days'` because `now()` preserves the
    // current time of day. If the test runs late in the evening BRT, the
    // session's start_at can fall outside the calendar's visible slot range
    // (slotMaxTime = 21:00), making the session chip invisible in day view
    // and causing flaky E2E failures.
    //
    // Time assignments (BRT): confirmable=10:00, declinable=11:00
    // These are 2 days from now in BRT, well within business hours.
    const s = SEED_SESSIONS;

    // confirmable: 10:00 BRT (13:00 UTC) in 2 days
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking, confirmation_token
      )
      VALUES (
        ${s.confirmable.id},
        ${seed.userId},
        ${s.confirmable.patientId},
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '13 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '13 hours 50 minutes'),
        50,
        'scheduled',
        false,
        ${s.confirmable.confirmationToken}
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

    // declinable: 11:00 BRT (14:00 UTC) in 2 days
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking, confirmation_token
      )
      VALUES (
        ${s.declinable.id},
        ${seed.userId},
        ${s.declinable.patientId},
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '14 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '14 hours 50 minutes'),
        50,
        'scheduled',
        false,
        ${s.declinable.confirmationToken}
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

    // Seed sessions for status change E2E tests (sections 17–18).
    // Each session is seeded at a distinct BRT hour tomorrow to avoid time
    // collisions with other e2e tests (session-create: 14:00, drag-drop:
    // 08:00–10:00, block-create: 12:00). We anchor on the BRT date
    // `(current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date` rather
    // than `current_date` (UTC) because the Playwright browser uses
    // `timezoneId: 'America/Sao_Paulo'`. Between 00:00–03:00 UTC the BRT
    // calendar day is one day behind UTC, and `current_date` would place
    // sessions on a day the browser's "tomorrow" navigation doesn't reach.
    // The hour offsets after the date are in UTC
    // (BRT = UTC-3, so 10:00 BRT = 13:00 UTC).
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
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '22 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '22 hours 50 minutes'),
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
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '14 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '14 hours 50 minutes'),
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
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '12 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '12 hours 50 minutes'),
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
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '23 hours'),
        ((current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 day' + interval '23 hours 50 minutes'),
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
      INSERT INTO public.consent_terms (id, patient_id, user_id, kind, term_text, signature_token, revocation_takes_effect_immediately)
      VALUES (
        ${ct.unsigned.id},
        ${ct.unsigned.patientId},
        ${seed.userId},
        'general',
        ${ct.unsigned.termText},
        ${ct.unsigned.signatureToken},
        false
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        kind            = EXCLUDED.kind,
        revocation_takes_effect_immediately = EXCLUDED.revocation_takes_effect_immediately,
        signed_at       = NULL,
        signed_ip       = NULL,
        signed_user_agent = NULL,
        revoked_at      = NULL;
    `;

    // Already-signed consent term — used to test "already signed" state
    await sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, kind, term_text, signature_token, revocation_takes_effect_immediately, signed_at, signed_ip, signed_user_agent)
      VALUES (
        ${ct.alreadySigned.id},
        ${ct.alreadySigned.patientId},
        ${seed.userId},
        'general',
        ${ct.alreadySigned.termText},
        ${ct.alreadySigned.signatureToken},
        false,
        now(),
        '127.0.0.1',
        'e2e-seed-agent'
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        kind            = EXCLUDED.kind,
        revocation_takes_effect_immediately = EXCLUDED.revocation_takes_effect_immediately,
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
      INSERT INTO public.consent_terms (id, patient_id, user_id, kind, term_text, signature_token, revocation_takes_effect_immediately, signed_at, signed_ip, signed_user_agent, revoked_at)
      VALUES (
        ${ct.revoked.id},
        ${ct.revoked.patientId},
        ${seed.userId},
        'general',
        ${ct.revoked.termText},
        ${ct.revoked.signatureToken},
        false,
        now() - interval '7 days',
        '127.0.0.1',
        'e2e-seed-agent',
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text         = EXCLUDED.term_text,
        signature_token   = EXCLUDED.signature_token,
        kind              = EXCLUDED.kind,
        revocation_takes_effect_immediately = EXCLUDED.revocation_takes_effect_immediately,
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

    // Seed AI consent terms for the AI transcription consent E2E tests.
    // These use base64url tokens (43 chars) and `kind = 'ai_recording'`.
    const act = SEED_AI_CONSENT_TERMS;

    // The template snapshot is stored as JSONB and must match the
    // AiConsentTemplateSchema shape validated on read.
    const aiTemplateSnapshot = JSON.stringify({
      version: 1,
      title: 'Termo de Consentimento para Gravacao e Transcricao por Inteligencia Artificial',
      sections: [
        {
          heading: 'Identificacao',
          body: `Profissional responsavel: Seed User, inscrito(a) no Conselho Regional de Psicologia sob o numero 00000-S/SP.\n\nPaciente: ${SEED_PATIENTS.activeWithPhone.fullName}.`,
        },
        {
          heading: 'Finalidade',
          body: 'A gravacao da sessao de atendimento psicologico sera realizada exclusivamente para processamento por inteligencia artificial (IA).',
        },
        {
          heading: 'Bases legais',
          body: 'O tratamento dos dados pessoais e sensiveis decorrentes da gravacao e transcricao fundamenta-se nas seguintes bases legais da LGPD.',
        },
        {
          heading: 'Operacao de tratamento',
          body: 'Controlador: o psicologo identificado neste termo.',
        },
        {
          heading: 'Retencao',
          body: 'O audio da sessao sera descartado no prazo maximo de 24 horas apos o processamento.',
        },
        {
          heading: 'Direitos do titular',
          body: 'Em conformidade com o art. 18 da LGPD, o paciente tem direito a confirmacao.',
        },
        {
          heading: 'Revogacao',
          body: 'O paciente pode revogar este consentimento a qualquer momento.',
        },
        {
          heading: 'Riscos',
          body: 'O paciente deve estar ciente dos seguintes riscos associados ao uso de inteligencia artificial.',
        },
      ],
    });

    // Unsigned AI consent term — patient can sign this one
    await sql`
      INSERT INTO public.consent_terms (
        id, patient_id, user_id, kind, term_text,
        signature_token, revocation_takes_effect_immediately,
        template_version, template_snapshot
      )
      VALUES (
        ${act.unsigned.id},
        ${act.unsigned.patientId},
        ${seed.userId},
        'ai_recording',
        'Termo de Consentimento para Gravacao e Transcricao por Inteligencia Artificial',
        ${act.unsigned.signatureToken},
        true,
        1,
        ${aiTemplateSnapshot}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        kind            = EXCLUDED.kind,
        revocation_takes_effect_immediately = EXCLUDED.revocation_takes_effect_immediately,
        template_version = EXCLUDED.template_version,
        template_snapshot = EXCLUDED.template_snapshot,
        signed_at       = NULL,
        signed_ip       = NULL,
        signed_user_agent = NULL,
        revoked_at      = NULL;
    `;

    // Already-signed AI consent term — used to test "already signed" state
    await sql`
      INSERT INTO public.consent_terms (
        id, patient_id, user_id, kind, term_text,
        signature_token, revocation_takes_effect_immediately,
        template_version, template_snapshot,
        signed_at, signed_ip, signed_user_agent
      )
      VALUES (
        ${act.alreadySigned.id},
        ${act.alreadySigned.patientId},
        ${seed.userId},
        'ai_recording',
        'Termo de Consentimento para Gravacao e Transcricao por Inteligencia Artificial',
        ${act.alreadySigned.signatureToken},
        true,
        1,
        ${aiTemplateSnapshot}::jsonb,
        now(),
        'e2e-hashed-ip',
        'e2e-hashed-ua'
      )
      ON CONFLICT (id) DO UPDATE SET
        term_text       = EXCLUDED.term_text,
        signature_token = EXCLUDED.signature_token,
        kind            = EXCLUDED.kind,
        revocation_takes_effect_immediately = EXCLUDED.revocation_takes_effect_immediately,
        template_version = EXCLUDED.template_version,
        template_snapshot = EXCLUDED.template_snapshot,
        signed_at       = EXCLUDED.signed_at,
        signed_ip       = EXCLUDED.signed_ip,
        signed_user_agent = EXCLUDED.signed_user_agent,
        revoked_at      = NULL;
    `;
    // Seed AI transcription row for the full-pipeline E2E test.
    // This row simulates a manual upload that has been accepted but not yet
    // processed by Inngest. The test will simulate pipeline completion by
    // UPDATEing the row to 'ready' with test-generated note data.
    const at = SEED_AI_TRANSCRIPTIONS;
    await sql`
      INSERT INTO public.ai_transcriptions (
        id, user_id, patient_id, source,
        audio_object_key, status
      )
      VALUES (
        ${at.pendingPipeline.id},
        ${seed.userId},
        ${at.pendingPipeline.patientId},
        'manual_upload',
        ${at.pendingPipeline.audioObjectKey},
        'pending'
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id          = EXCLUDED.user_id,
        patient_id       = EXCLUDED.patient_id,
        source           = EXCLUDED.source,
        audio_object_key = EXCLUDED.audio_object_key,
        status           = EXCLUDED.status,
        generated_note   = NULL,
        risk_alerts      = NULL,
        error_code       = NULL,
        completed_at     = NULL,
        reviewed_at      = NULL,
        template_used    = NULL;
    `;

    // -----------------------------------------------------------------------
    // Review UI fixtures (section 11): `ready` transcriptions for the
    // happy-path save and the discard flow, plus the cross-tenant IDOR row.
    // -----------------------------------------------------------------------

    // A canonical `ready` generated note matching GeneratedNoteSchema v1. The
    // save flow re-validates the stored JSONB, so the shape must be valid.
    const reviewReadyNote = JSON.stringify({
      schemaVersion: 1,
      humorInicial: 'Apresentou-se ansioso no inicio da sessao',
      humorFinal: 'Encerrou mais tranquilo apos as tecnicas',
      pauta: ['Ansiedade no trabalho', 'Qualidade do sono'],
      conteudoTrabalhado: ['Respiracao diafragmatica', 'Registro de pensamentos'],
      tarefaCasa: ['Praticar respiracao antes de dormir'],
      palavrasRisco: [],
      observacoesExtras: 'Boa adesao as tecnicas propostas.',
    });

    // readyForSave — owned by the seed user; patient activeMinimal already has
    // a signed ai_recording consent term, which the save action re-verifies.
    const rfs = SEED_AI_TRANSCRIPTIONS.readyForSave;
    // Drop any evolution a previous save-test run created for this row so the
    // happy-path assertion ("an evolution exists for this transcription") is
    // deterministic across reused Testcontainers.
    await sql`
      DELETE FROM public.evolutions
      WHERE user_id = ${seed.userId}
        AND ai_transcription_id = ${rfs.id};
    `;
    await sql`
      INSERT INTO public.ai_transcriptions (
        id, user_id, patient_id, source,
        audio_object_key, status, generated_note, saved_to_prontuario
      )
      VALUES (
        ${rfs.id}, ${seed.userId}, ${rfs.patientId}, 'manual_upload',
        ${rfs.audioObjectKey}, 'ready', ${reviewReadyNote}::jsonb, false
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id             = EXCLUDED.user_id,
        patient_id          = EXCLUDED.patient_id,
        source              = EXCLUDED.source,
        audio_object_key    = EXCLUDED.audio_object_key,
        status              = 'ready',
        generated_note      = EXCLUDED.generated_note,
        saved_to_prontuario = false,
        evolution_id        = NULL,
        risk_alerts         = NULL,
        error_code          = NULL,
        completed_at        = NULL,
        reviewed_at         = NULL,
        template_used       = NULL;
    `;

    // readyForDiscard — owned by the seed user. Discard transitions the row to
    // status='reviewed' without saving to the prontuario.
    const rfd = SEED_AI_TRANSCRIPTIONS.readyForDiscard;
    await sql`
      INSERT INTO public.ai_transcriptions (
        id, user_id, patient_id, source,
        audio_object_key, status, generated_note, saved_to_prontuario
      )
      VALUES (
        ${rfd.id}, ${seed.userId}, ${rfd.patientId}, 'manual_upload',
        ${rfd.audioObjectKey}, 'ready', ${reviewReadyNote}::jsonb, false
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id             = EXCLUDED.user_id,
        patient_id          = EXCLUDED.patient_id,
        source              = EXCLUDED.source,
        audio_object_key    = EXCLUDED.audio_object_key,
        status              = 'ready',
        generated_note      = EXCLUDED.generated_note,
        saved_to_prontuario = false,
        evolution_id        = NULL,
        risk_alerts         = NULL,
        error_code          = NULL,
        completed_at        = NULL,
        reviewed_at         = NULL,
        template_used       = NULL;
    `;

    // ----- Cross-tenant IDOR fixture (psychologist A) ----------------------
    // A second auth.users row the mock GoTrue never authenticates. Inserting it
    // fires the handle_new_user() trigger which materializes A's profile.
    const idor = SEED_IDOR;
    const idorMetadata = JSON.stringify({
      fullName: 'Psicologa A',
      crpNumber: '11111-A',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${idor.psychologistA.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${idor.psychologistA.email},
        ${idorMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now())
      WHERE user_id = ${idor.psychologistA.id};
    `;
    // A's own patient — the full_name must NEVER surface on B's not-found page.
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status)
      VALUES (
        ${idor.patientA.id}, ${idor.psychologistA.id}, ${idor.patientA.fullName},
        'individual', 'active'
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id   = EXCLUDED.user_id,
        full_name = EXCLUDED.full_name,
        status    = EXCLUDED.status;
    `;
    // A's `ready` transcription. B will request this id and must get NOT_FOUND.
    await sql`
      INSERT INTO public.ai_transcriptions (
        id, user_id, patient_id, source,
        audio_object_key, status, generated_note, saved_to_prontuario
      )
      VALUES (
        ${idor.transcriptionA.id}, ${idor.psychologistA.id}, ${idor.patientA.id},
        'manual_upload', ${idor.transcriptionA.audioObjectKey}, 'ready',
        ${reviewReadyNote}::jsonb, false
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id             = EXCLUDED.user_id,
        patient_id          = EXCLUDED.patient_id,
        source              = EXCLUDED.source,
        audio_object_key    = EXCLUDED.audio_object_key,
        status              = 'ready',
        generated_note      = EXCLUDED.generated_note,
        saved_to_prontuario = false,
        evolution_id        = NULL,
        reviewed_at         = NULL;
    `;

    // -----------------------------------------------------------------------
    // Zero-data dashboard user (dashboard/dashboard-home.spec.ts).
    //
    // A second active psychologist that owns NO patients and NO sessions, so
    // its dashboard renders the first-steps empty state. Inserting the
    // auth.users row fires handle_new_user() which materializes the profile;
    // we then force it `active` exactly like the seed user. We also DELETE any
    // patients/sessions left over from a previous reused-container run so the
    // account is guaranteed empty.
    const emptyUser = SEED_DASHBOARD_EMPTY_USER;
    const emptyMetadata = JSON.stringify({
      fullName: emptyUser.fullName,
      crpNumber: '22222-V',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${emptyUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${emptyUser.email},
        ${emptyMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${emptyUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${emptyUser.id};
    `;
    // Guarantee the account is empty even on a reused container.
    await sql`DELETE FROM public.sessions WHERE user_id = ${emptyUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${emptyUser.id}`;

    // -----------------------------------------------------------------------
    // Dedicated onboarding-checklist user (onboarding/checklist.spec.ts).
    //
    // A third active psychologist owning NO data, so its mandatory checklist
    // starts at exactly one item done (`cadastro_completo`: email verified +
    // CRP validated, both forced below). The spec writes its own owner-scoped
    // rows to flip the remaining items and drive the card 0% → 100%. We reset
    // every owned table + the persisted checklist cache
    // on each run so the reused container never carries a prior state.
    // -----------------------------------------------------------------------
    const checklistUser = SEED_ONBOARDING_CHECKLIST_USER;
    const checklistMetadata = JSON.stringify({
      fullName: checklistUser.fullName,
      crpNumber: '33333-C',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${checklistUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${checklistUser.email},
        ${checklistMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${checklistUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${checklistUser.id};
    `;
    // Wipe every owned source row + the denormalized checklist cache so the
    // account is a clean "only cadastro_completo" slate on a reused container.
    // FK order: dependents before patients/sessions.
    await sql`DELETE FROM public.evolutions WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.ai_transcriptions WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.ai_transcription_settings WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.consent_terms WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.session_history WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${checklistUser.id}`;
    await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${checklistUser.id}`;

    // -----------------------------------------------------------------------
    // Dedicated NPS day-7 user (nps/day7-modal.spec.ts).
    //
    // A fifth active psychologist touched by nothing else, so the NPS spec can
    // deterministically set `first_access_at` (7+ days ago) and reset
    // `nps_responded_at`/`nps_score`/`nps_feedback` to drive the day-7 modal
    // through submit / dismiss / later-answer paths without leaking onto
    // siblings under `fullyParallel`. The
    // global-setup baseline leaves the survey UNANSWERED with `first_access_at`
    // NULL (never eligible until the spec sets it), so a stray render before the
    // spec's own setup never pops the modal.
    // -----------------------------------------------------------------------
    const npsUser = SEED_NPS_USER;
    const npsMetadata = JSON.stringify({
      fullName: npsUser.fullName,
      crpNumber: '55555-N',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${npsUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${npsUser.email},
        ${npsMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${npsUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          nps_score = NULL,
          nps_feedback = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${npsUser.id};
    `;

    // -----------------------------------------------------------------------
    // Dedicated consent-filter user (patients/consent-filter.spec.ts).
    //
    // A sixth active psychologist touched by NOTHING else, owning a
    // deterministic patient set so the "sem-consentimento" listing's header
    // count equals the dashboard pendência count for this same user (4 active
    // unconsented rows), with one signed + one archived as negative cases. See
    // SEED_CONSENT_FILTER_USER for the full rationale. `first_access_at` is
    // left NULL so the day-7 NPS modal does not auto-run and steal the
    // row-action clicks.
    // -----------------------------------------------------------------------
    const cfUser = SEED_CONSENT_FILTER_USER;
    const cfMetadata = JSON.stringify({
      fullName: cfUser.fullName,
      crpNumber: '66666-F',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${cfUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${cfUser.email},
        ${cfMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${cfUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${cfUser.id};
    `;
    // Wipe stale rows (FK-ordered) so the spec starts from a known set on the
    // reused container.
    await sql`DELETE FROM public.consent_terms WHERE user_id = ${cfUser.id}`;
    await sql`
      DELETE FROM public.patient_guardians
      WHERE patient_id IN (SELECT id FROM public.patients WHERE user_id = ${cfUser.id});
    `;
    await sql`DELETE FROM public.patients WHERE user_id = ${cfUser.id}`;

    const cfp = cfUser.patients;
    // Active, unconsented patients (appear in the filter). The minor uses
    // `patient_type = 'child'` so the row's share phone resolves to its primary
    // guardian (resolveConsentShare in list-patients.ts).
    for (const [patient, patientType, phone] of [
      [cfp.adultWithPhone, 'individual', cfp.adultWithPhone.phone] as const,
      [cfp.minorWithGuardian, 'child', null] as const,
      [cfp.adultNoPhone, 'individual', null] as const,
      [cfp.copyTarget, 'individual', cfp.copyTarget.phone] as const,
    ]) {
      await sql`
        INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, status, archived_at, consent_signed_at, consent_revoked_at)
        VALUES (
          ${patient.id}, ${cfUser.id}, ${patient.fullName}, ${patientType},
          ${phone}, 'active', NULL, NULL, NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id            = EXCLUDED.user_id,
          full_name          = EXCLUDED.full_name,
          patient_type       = EXCLUDED.patient_type,
          phone              = EXCLUDED.phone,
          status             = 'active',
          archived_at        = NULL,
          consent_signed_at  = NULL,
          consent_revoked_at = NULL;
      `;
    }

    // Primary guardian (with phone) for the minor — the row's WhatsApp share
    // uses THIS phone, not the patient's.
    await sql`
      INSERT INTO public.patient_guardians (id, patient_id, full_name, relationship, phone, is_primary)
      VALUES (
        ${cfp.minorWithGuardian.guardianId},
        ${cfp.minorWithGuardian.id},
        'Responsavel Filtro',
        'mother',
        ${cfp.minorWithGuardian.guardianPhone},
        true
      )
      ON CONFLICT (id) DO UPDATE SET
        patient_id = EXCLUDED.patient_id,
        phone      = EXCLUDED.phone,
        is_primary = true;
    `;

    // Active patient WITH a signed consent — EXCLUDED from the filter.
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at, consent_signed_at, consent_revoked_at)
      VALUES (
        ${cfp.signedAdult.id}, ${cfUser.id}, ${cfp.signedAdult.fullName}, 'individual',
        'active', NULL, now(), NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id            = EXCLUDED.user_id,
        full_name          = EXCLUDED.full_name,
        status             = 'active',
        archived_at        = NULL,
        consent_signed_at  = now(),
        consent_revoked_at = NULL;
    `;
    await sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, kind, term_text, signature_token, revocation_takes_effect_immediately, signed_at, signed_ip, signed_user_agent)
      VALUES (
        ${cfp.signedAdult.consentTermId},
        ${cfp.signedAdult.id},
        ${cfUser.id},
        'general',
        'Termo assinado (filtro).',
        ${cfp.signedAdult.signatureToken},
        false,
        now(),
        '127.0.0.1',
        'e2e-seed-agent'
      )
      ON CONFLICT (id) DO UPDATE SET
        signed_at         = EXCLUDED.signed_at,
        signature_token   = EXCLUDED.signature_token,
        revoked_at        = NULL;
    `;

    // Archived patient WITHOUT consent — EXCLUDED from the filter (archived).
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at, consent_signed_at, consent_revoked_at)
      VALUES (
        ${cfp.archivedNoConsent.id}, ${cfUser.id}, ${cfp.archivedNoConsent.fullName}, 'individual',
        'archived', now(), NULL, NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id            = EXCLUDED.user_id,
        full_name          = EXCLUDED.full_name,
        status             = 'archived',
        archived_at        = now(),
        consent_signed_at  = NULL,
        consent_revoked_at = NULL;
    `;

    // -----------------------------------------------------------------------
    // Dedicated overdue-evolutions user (agenda/overdue-evolutions-list.spec.ts).
    //
    // A seventh active psychologist touched by NOTHING else, owning a
    // deterministic set of `done` sessions so the `/agenda?filtro=sem-evolucao`
    // list has exactly 3 overdue rows (oldest-first) and the header count
    // equals the dashboard pendência count for this same user (RF-12.18). Two
    // control sessions are EXCLUDED: one inside the 7-day window, one older but
    // already evolved (anti-join). See SEED_OVERDUE_EVOLUTIONS_USER for the full
    // rationale. `first_access_at` is left NULL
    // so the day-7 NPS modal does not auto-run and steal the row CTA / chip clicks.
    // -----------------------------------------------------------------------
    const oeUser = SEED_OVERDUE_EVOLUTIONS_USER;
    const oeMetadata = JSON.stringify({
      fullName: oeUser.fullName,
      crpNumber: '77777-G',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${oeUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${oeUser.email},
        ${oeMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${oeUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${oeUser.id};
    `;
    // Wipe stale rows (FK-ordered: evolutions reference sessions) so the spec
    // starts from a known set on the reused container.
    await sql`DELETE FROM public.evolutions WHERE user_id = ${oeUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${oeUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${oeUser.id}`;

    const oep = oeUser.patient;
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at)
      VALUES (
        ${oep.id}, ${oeUser.id}, ${oep.fullName}, 'individual', 'active', NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id     = EXCLUDED.user_id,
        full_name   = EXCLUDED.full_name,
        status      = 'active',
        archived_at = NULL;
    `;

    const oes = oeUser.sessions;
    // Five `done` sessions: three overdue-without-evolution (oldest-first by age),
    // one recent (inside the window), one old-but-evolved. `start_at` is anchored
    // to `now()` minus N days so the relationship to the 7-day window holds on
    // every run regardless of wall-clock date.
    for (const session of [
      oes.overdueOldest,
      oes.overdueMiddle,
      oes.overdueNewest,
      oes.recentDone,
      oes.oldDoneEvolved,
    ]) {
      await sql`
        INSERT INTO public.sessions (
          id, user_id, patient_id,
          start_at, end_at, duration_minutes,
          status, modality, is_blocking
        )
        VALUES (
          ${session.id},
          ${oeUser.id},
          ${oep.id},
          (now() - (${session.ageDays} || ' days')::interval),
          (now() - (${session.ageDays} || ' days')::interval + interval '50 minutes'),
          50, 'done', 'in_person', false
        )
        ON CONFLICT (id) DO UPDATE SET
          start_at   = EXCLUDED.start_at,
          end_at     = EXCLUDED.end_at,
          status     = 'done',
          modality   = 'in_person',
          deleted_at = NULL;
      `;
    }

    // The old-but-evolved control session gets a seeded evolution so the
    // anti-join excludes it from the overdue list.
    await sql`
      INSERT INTO public.evolutions (id, user_id, patient_id, session_id, template_type, content)
      VALUES (
        ${oes.oldDoneEvolved.evolutionId},
        ${oeUser.id},
        ${oep.id},
        ${oes.oldDoneEvolved.id},
        'livre',
        ${'{"text":"Evolucao de controle"}'}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    // -----------------------------------------------------------------------
    // Dedicated patient session-history user
    // (patient-session-history/session-history.spec.ts — PRD §13, section 10).
    //
    // An eighth active psychologist touched by NOTHING else, owning a fully
    // deterministic terminal-session set so the history tab's summary counts,
    // attendance rate, pagination boundary (page size 12), status filter,
    // per-card evolution CTAs, couple tag, future session, and empty state are
    // all stable under `fullyParallel`. See SEED_SESSION_HISTORY_USER for the
    // full rationale and the exact expected counts. `first_access_at` is
    // left NULL so the day-7 NPS modal does not auto-run and steal the
    // tab/chip/CTA clicks.
    // -----------------------------------------------------------------------
    const shUser = SEED_SESSION_HISTORY_USER;
    const shMetadata = JSON.stringify({
      fullName: shUser.fullName,
      crpNumber: '88888-H',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${shUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${shUser.email},
        ${shMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${shUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${shUser.id};
    `;
    // Wipe stale rows (FK-ordered: evolutions reference sessions) so the spec
    // starts from a known set on the reused container.
    await sql`DELETE FROM public.evolutions WHERE user_id = ${shUser.id}`;
    await sql`DELETE FROM public.session_history WHERE user_id = ${shUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${shUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${shUser.id}`;

    const shp = shUser.patients;
    for (const patient of [shp.withHistory, shp.noHistory, shp.partnerHidden]) {
      await sql`
        INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at)
        VALUES (
          ${patient.id}, ${shUser.id}, ${patient.fullName}, 'individual', 'active', NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id     = EXCLUDED.user_id,
          full_name   = EXCLUDED.full_name,
          status      = 'active',
          archived_at = NULL;
      `;
    }

    // The 12 individual `done` sessions WITHOUT an evolution → each shows the
    // "Registrar" CTA. Spread across distinct past months (every ~35 days back,
    // anchored to `now()`) so the month dividers and DESC ordering are exercised
    // and the relationship to "past" holds on every run regardless of the date.
    // Deterministic UUIDs in the `...b1xx` range keep them out of the way of the
    // named fixtures above.
    for (let i = 0; i < shUser.counts.doneWithoutEvolution; i++) {
      const seq = String(i + 10).padStart(3, '0');
      const sessionId = `00000000-0000-4000-8000-0000000b1${seq}`;
      const ageDays = 5 + i * 35;
      await sql`
        INSERT INTO public.sessions (
          id, user_id, patient_id,
          start_at, end_at, duration_minutes,
          status, modality, is_blocking
        )
        VALUES (
          ${sessionId},
          ${shUser.id},
          ${shp.withHistory.id},
          (now() - (${ageDays} || ' days')::interval),
          (now() - (${ageDays} || ' days')::interval + interval '50 minutes'),
          50, 'done', 'in_person', false
        )
        ON CONFLICT (id) DO UPDATE SET
          start_at   = EXCLUDED.start_at,
          end_at     = EXCLUDED.end_at,
          status     = 'done',
          modality   = 'in_person',
          patient_id = EXCLUDED.patient_id,
          deleted_at = NULL;
      `;
    }

    // One individual `done` session WITH an evolution → "Ver". Newest so it lands
    // on the first page regardless of pagination.
    const shs = shUser.sessions;
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${shs.doneEvolved.id},
        ${shUser.id},
        ${shp.withHistory.id},
        (now() - interval '3 days'),
        (now() - interval '3 days' + interval '50 minutes'),
        50, 'done', 'online', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at   = EXCLUDED.start_at,
        end_at     = EXCLUDED.end_at,
        status     = 'done',
        modality   = 'online',
        patient_id = EXCLUDED.patient_id,
        deleted_at = NULL;
    `;
    await sql`
      INSERT INTO public.evolutions (id, user_id, patient_id, session_id, template_type, content)
      VALUES (
        ${shs.doneEvolved.evolutionId},
        ${shUser.id},
        ${shp.withHistory.id},
        ${shs.doneEvolved.id},
        'livre',
        ${'{"text":"Evolucao registrada do historico"}'}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    // The couple `done` session — carries `patient_ids = [withHistory, partner]`
    // so the card renders the "Sessão de casal" tag, while the projection only
    // ever exposes the boolean presence (never the partner id/name).
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id, patient_ids,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${shs.doneCouple.id},
        ${shUser.id},
        ${shp.withHistory.id},
        ARRAY[${shp.withHistory.id}, ${shp.partnerHidden.id}]::uuid[],
        (now() - interval '4 days'),
        (now() - interval '4 days' + interval '50 minutes'),
        50, 'done', 'in_person', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at    = EXCLUDED.start_at,
        end_at      = EXCLUDED.end_at,
        status      = 'done',
        patient_ids = EXCLUDED.patient_ids,
        patient_id  = EXCLUDED.patient_id,
        deleted_at  = NULL;
    `;

    // One patient-initiated `cancelled` and one `no_show` — the attendance-rate
    // denominator buckets, plus the negative cases for the status filter.
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking,
        cancelled_at, cancelled_by, cancellation_reason, cancellation_notice, charge_cancellation
      )
      VALUES (
        '00000000-0000-4000-8000-0000000b1200',
        ${shUser.id},
        ${shp.withHistory.id},
        (now() - interval '6 days'),
        (now() - interval '6 days' + interval '50 minutes'),
        50, 'cancelled', 'in_person', false,
        (now() - interval '7 days'), 'patient', 'Imprevisto pessoal', 'less_than_24h', true
      )
      ON CONFLICT (id) DO UPDATE SET
        status              = 'cancelled',
        cancelled_by        = 'patient',
        cancellation_reason = EXCLUDED.cancellation_reason,
        cancellation_notice = EXCLUDED.cancellation_notice,
        charge_cancellation = EXCLUDED.charge_cancellation,
        deleted_at          = NULL;
    `;
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        '00000000-0000-4000-8000-0000000b1201',
        ${shUser.id},
        ${shp.withHistory.id},
        (now() - interval '8 days'),
        (now() - interval '8 days' + interval '50 minutes'),
        50, 'no_show', 'in_person', false
      )
      ON CONFLICT (id) DO UPDATE SET
        status     = 'no_show',
        patient_id = EXCLUDED.patient_id,
        deleted_at = NULL;
    `;

    // The single future `scheduled` session → rendered as "Próxima sessão" and
    // the "Abrir na agenda" deep-link target. Anchored a few days ahead so it
    // stays in the future across the whole run.
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${shs.future.id},
        ${shUser.id},
        ${shp.withHistory.id},
        (now() + interval '7 days'),
        (now() + interval '7 days' + interval '50 minutes'),
        50, 'scheduled', 'online', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at   = EXCLUDED.start_at,
        end_at     = EXCLUDED.end_at,
        status     = 'scheduled',
        patient_id = EXCLUDED.patient_id,
        deleted_at = NULL;
    `;

    // -----------------------------------------------------------------------
    // Dedicated first-run onboarding-wizard user
    // (onboarding/welcome.spec.ts, onboarding/wizard-flow.spec.ts,
    //  onboarding/first-run-happy-path.spec.ts, onboarding/first-run-skip.spec.ts).
    //
    // A dedicated active psychologist whose onboarding starts INCOMPLETE so the
    // reworked middleware funnels it into `/onboarding/welcome`. It owns NO
    // domain data, so the wizard collects everything from scratch. The
    // onboarding specs OWN its onboarding state and reset it to this pristine
    // incomplete baseline before each test (under a cross-worker advisory lock),
    // so resume / skip / completion / first-access stamping are deterministic on
    // the reused container. The GLOBAL seed user can no longer drive the wizard
    // (it is permanently onboarding-complete), which is why this exists.
    // -----------------------------------------------------------------------
    const owUser = SEED_ONBOARDING_WIZARD_USER;
    const owMetadata = JSON.stringify({
      fullName: owUser.fullName,
      crpNumber: '99999-W',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${owUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${owUser.email},
        ${owMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    // Wipe any domain data left from a previous reused-container run so the
    // wizard always starts from a genuinely empty account.
    await sql`DELETE FROM public.consent_terms WHERE user_id = ${owUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${owUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${owUser.id}`;
    await sql`DELETE FROM public.reminder_settings WHERE user_id = ${owUser.id}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${owUser.id}`;
    await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${owUser.id}`;
    // Active + onboarding INCOMPLETE baseline. `full_name` is the pristine
    // "Onboarding Wizard E2E" so the step-1 persistence assertion can prove the
    // display name actually changed; `first_access_at` NULL so the wizard render
    // can stamp it.
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${owUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          requires_password_reset = false,
          onboarding_step = 'welcome',
          onboarding_completed_at = NULL,
          first_access_at = NULL,
          reactivated_at = NULL
      WHERE user_id = ${owUser.id};
    `;

    // -----------------------------------------------------------------------
    // Dedicated reactivated-account onboarding user
    // (onboarding/first-run-reactivated.spec.ts — section 6.3).
    //
    // A previously-cancelled psychologist brought back online: onboarding
    // INCOMPLETE (`onboarding_step = 'location'`) but ALREADY owning a
    // configured location and an active patient. The data-aware resume resolver
    // must fast-forward past the location AND patients steps (their real data
    // exists), and the idempotent `configureLocationImpl` must never produce a
    // second location. The spec proves the user is never asked to RE-CREATE a
    // location and that the location count stays exactly 1.
    // -----------------------------------------------------------------------
    const orUser = SEED_ONBOARDING_REACTIVATED_USER;
    const orMetadata = JSON.stringify({
      fullName: orUser.fullName,
      crpNumber: '90909-R',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${orUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${orUser.email},
        ${orMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    // Wipe stale rows (FK order) so the pre-existing set is exactly one location
    // + one patient on every run.
    await sql`DELETE FROM public.consent_terms WHERE user_id = ${orUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${orUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${orUser.id}`;
    await sql`DELETE FROM public.reminder_settings WHERE user_id = ${orUser.id}`;
    await sql`DELETE FROM public.locations WHERE user_id = ${orUser.id}`;
    await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${orUser.id}`;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${orUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          requires_password_reset = false,
          onboarding_step = 'location',
          onboarding_completed_at = NULL,
          first_access_at = NULL,
          reactivated_at = now()
      WHERE user_id = ${orUser.id};
    `;
    // One pre-existing location — the wizard must NOT ask to re-create it.
    await sql`
      INSERT INTO public.locations (id, user_id, name, type, is_default)
      VALUES (
        ${orUser.location.id}, ${orUser.id}, ${orUser.location.name}, 'in_person', true
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id    = EXCLUDED.user_id,
        name       = EXCLUDED.name,
        type       = EXCLUDED.type,
        is_default = true;
    `;
    // One pre-existing active patient — satisfies the patients step.
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at)
      VALUES (
        ${orUser.patient.id}, ${orUser.id}, ${orUser.patient.fullName}, 'individual', 'active', NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id     = EXCLUDED.user_id,
        full_name   = EXCLUDED.full_name,
        status      = 'active',
        archived_at = NULL;
    `;

    // -----------------------------------------------------------------------
    // Dedicated AI-stats user (ai-transcription/settings-stats.spec.ts).
    //
    // A separate active psychologist touched by NOTHING else, so the stats spec
    // can blank-slate its `ai_transcriptions` set (the acceptance-rate stat
    // aggregates every owned row) and seed an exact `reviewed` count WITHOUT
    // racing the sibling review specs that own `ready` fixtures on the GLOBAL
    // seed user. See SEED_AI_STATS_USER for the full rationale. `first_access_at`
    // is left NULL so the day-7 NPS modal never auto-runs over the page render.
    // -----------------------------------------------------------------------
    const aiStatsUser = SEED_AI_STATS_USER;
    const aiStatsMetadata = JSON.stringify({
      fullName: aiStatsUser.fullName,
      crpNumber: '77777-S',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${aiStatsUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${aiStatsUser.email},
        ${aiStatsMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${aiStatsUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${aiStatsUser.id};
    `;
    // Reset to a transcription-free baseline (FK-ordered: evolutions ->
    // transcriptions) so the spec fully owns the counts on a reused container.
    await sql`DELETE FROM public.evolutions WHERE user_id = ${aiStatsUser.id}`;
    await sql`DELETE FROM public.ai_transcriptions WHERE user_id = ${aiStatsUser.id}`;
    // The single FK-target patient for every seeded transcription row.
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at)
      VALUES (
        ${aiStatsUser.patient.id}, ${aiStatsUser.id}, ${aiStatsUser.patient.fullName},
        'individual', 'active', NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id     = EXCLUDED.user_id,
        full_name   = EXCLUDED.full_name,
        status      = 'active',
        archived_at = NULL;
    `;

    // -----------------------------------------------------------------------
    // Dedicated WhatsApp reminders LGPD-consent user
    // (whatsapp/reminder-consent-provisioning.spec.ts).
    //
    // A separate active psychologist touched by NOTHING else, so the consent
    // flow can start from an account-free baseline and provision on its first
    // save WITHOUT racing the sibling whatsapp specs that DELETE/INSERT
    // `whatsapp_accounts` on the GLOBAL seed user under `fullyParallel`. See
    // SEED_WHATSAPP_CONSENT_USER for the full rationale. `first_access_at` is
    // left NULL so the day-7 NPS modal never auto-runs over the save/toast.
    // -----------------------------------------------------------------------
    const waConsentUser = SEED_WHATSAPP_CONSENT_USER;
    const waConsentMetadata = JSON.stringify({
      fullName: waConsentUser.fullName,
      crpNumber: '88888-W',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${waConsentUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${waConsentUser.email},
        ${waConsentMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${waConsentUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false,
          onboarding_step = 'done',
          onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE user_id = ${waConsentUser.id};
    `;
    // Reset to an account-free, settings-free baseline (FK order: templates ->
    // settings -> accounts) so the spec deterministically starts BEFORE
    // provisioning on a reused container.
    await sql`DELETE FROM public.message_templates WHERE user_id = ${waConsentUser.id}`;
    await sql`DELETE FROM public.reminder_settings WHERE user_id = ${waConsentUser.id}`;
    await sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${waConsentUser.id}`;
  } finally {
    await sql.end();
  }
}
