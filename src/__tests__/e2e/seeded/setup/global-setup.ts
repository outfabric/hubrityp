import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';

import {
  readSeedState,
  SEED_AI_CONSENT_TERMS,
  SEED_AI_TRANSCRIPTIONS,
  SEED_CONSENT_FILTER_USER,
  SEED_CONSENT_TERMS,
  SEED_DASHBOARD_EMPTY_USER,
  SEED_IDOR,
  SEED_NPS_USER,
  SEED_ONBOARDING_CHECKLIST_USER,
  SEED_ONBOARDING_TOUR_USER,
  SEED_OVERDUE_EVOLUTIONS_USER,
  SEED_PATIENTS,
  SEED_SESSIONS,
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
    //
    // `tour_completed_at` is stamped here so the guided dashboard tour does
    // NOT auto-run for the GLOBAL seed user. Many parallel specs land this
    // user on `/dashboard`; with `tour_completed_at IS NULL` the driver.js
    // overlay auto-opens and intercepts pointer events, blocking unrelated
    // clicks (logout, upload, tab switches, "Reconectar"). Only the dedicated
    // tour user keeps `tour_completed_at` NULL so the auto-run is still tested.
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          tour_completed_at = COALESCE(tour_completed_at, now()),
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
          tour_completed_at = COALESCE(tour_completed_at, now()),
          requires_password_reset = false
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
    // every owned table + the persisted checklist cache + `tour_completed_at`
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
          tour_completed_at = now(),
          requires_password_reset = false
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
    // Dedicated onboarding-tour user (onboarding/tour.spec.ts).
    //
    // A fourth active psychologist that DOES own one active patient + one
    // session, so `hasAnyData` is true and the dashboard renders the four
    // operational sections — making all five `data-tour-anchor` surfaces
    // present so the tour highlights real elements in order. We reset
    // `tour_completed_at` to NULL here so the global-setup baseline is "tour
    // never completed"; the spec controls it per-test thereafter.
    // -----------------------------------------------------------------------
    const tourUser = SEED_ONBOARDING_TOUR_USER;
    const tourMetadata = JSON.stringify({
      fullName: tourUser.fullName,
      crpNumber: '44444-T',
      crpUf: 'SP',
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
      sensitiveDataConsentAt: nowIso,
    });
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
      VALUES (
        ${tourUser.id},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${tourUser.email},
        ${tourMetadata}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`
      UPDATE public.profiles
      SET status = 'active',
          full_name = ${tourUser.fullName},
          email_verified_at = COALESCE(email_verified_at, now()),
          crp_validated_at = COALESCE(crp_validated_at, now()),
          tour_completed_at = NULL,
          requires_password_reset = false
      WHERE user_id = ${tourUser.id};
    `;
    // Clean stale data, then reseed exactly one patient + one session so
    // `hasAnyData` is deterministically true.
    await sql`DELETE FROM public.session_history WHERE user_id = ${tourUser.id}`;
    await sql`DELETE FROM public.sessions WHERE user_id = ${tourUser.id}`;
    await sql`DELETE FROM public.patients WHERE user_id = ${tourUser.id}`;
    await sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, status)
      VALUES (
        ${tourUser.patientId}, ${tourUser.id}, 'Paciente Tour', 'individual', 'active'
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id     = EXCLUDED.user_id,
        status      = 'active',
        archived_at = NULL;
    `;
    await sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${tourUser.sessionId},
        ${tourUser.id},
        ${tourUser.patientId},
        (now() + interval '1 day'),
        (now() + interval '1 day' + interval '50 minutes'),
        50, 'scheduled', 'online', false
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id    = EXCLUDED.user_id,
        patient_id = EXCLUDED.patient_id,
        start_at   = EXCLUDED.start_at,
        end_at     = EXCLUDED.end_at,
        status     = 'scheduled',
        deleted_at = NULL;
    `;

    // -----------------------------------------------------------------------
    // Dedicated NPS day-7 user (nps/day7-modal.spec.ts).
    //
    // A fifth active psychologist touched by nothing else, so the NPS spec can
    // deterministically set `first_access_at` (7+ days ago) and reset
    // `nps_responded_at`/`nps_score`/`nps_feedback` to drive the day-7 modal
    // through submit / dismiss / later-answer paths without leaking onto
    // siblings under `fullyParallel`. `tour_completed_at` is stamped here so the
    // guided tour overlay never auto-runs and steals the modal's clicks. The
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
          tour_completed_at = COALESCE(tour_completed_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          nps_score = NULL,
          nps_feedback = NULL,
          requires_password_reset = false
      WHERE user_id = ${npsUser.id};
    `;

    // -----------------------------------------------------------------------
    // Dedicated consent-filter user (patients/consent-filter.spec.ts).
    //
    // A sixth active psychologist touched by NOTHING else, owning a
    // deterministic patient set so the "sem-consentimento" listing's header
    // count equals the dashboard pendência count for this same user (4 active
    // unconsented rows), with one signed + one archived as negative cases. See
    // SEED_CONSENT_FILTER_USER for the full rationale. `tour_completed_at` is
    // stamped and `first_access_at` left NULL so neither overlay (guided tour /
    // day-7 NPS modal) auto-runs and steals the row-action clicks.
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
          tour_completed_at = COALESCE(tour_completed_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false
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
    // rationale. `tour_completed_at` is stamped and `first_access_at` left NULL
    // so neither overlay auto-runs and steals the row CTA / chip clicks.
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
          tour_completed_at = COALESCE(tour_completed_at, now()),
          first_access_at = NULL,
          nps_responded_at = NULL,
          requires_password_reset = false
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
  } finally {
    await sql.end();
  }
}
