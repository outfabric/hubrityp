import { sql as dsql } from 'drizzle-orm';

import { sessionHistory, sessions } from '@/shared/db/schema/agenda/tables';
import {
  auditLog,
  clinicalDocuments,
  diagnosticHypotheses,
  evolutionAttachments,
  evolutionVersions,
  evolutions,
  personalNotes,
  prontuarioExports,
  scaleApplications,
  treatmentPlanVersions,
  treatmentPlans,
} from '@/shared/db/schema/medical-records/tables';
import { notifications } from '@/shared/db/schema/notifications/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';

import { runAsService } from './run-as-service';

/**
 * Deletes test data from the shared Testcontainers database in correct FK
 * dependency order. Handles the full chain:
 *
 *   clinical_documents → evolution_attachments → personal_notes → scale_applications → treatment_plan_versions → treatment_plans → diagnostic_hypotheses → evolution_versions → evolutions → audit_log → video_recordings → video_session_logs → video_rooms → session_history → sessions → patients → auth.users
 *
 * The `evolutions` table references both `patients(id)` and `sessions(id)`,
 * so it must be cleared before either parent. `evolution_versions` references
 * `evolutions(id)` with ON DELETE CASCADE, but we delete explicitly for
 * clarity and robustness against future constraint changes.
 * `diagnostic_hypotheses` references `patients(id)` so must be cleared before patients.
 * `treatment_plans` references `patients(id)` so must be cleared before patients.
 * `treatment_plan_versions` references `treatment_plans(id)` with ON DELETE CASCADE.
 * `scale_applications` references `patients(id)` so must be cleared before patients.
 * `evolution_attachments` references `patients(id)` + `evolutions(id)` so must be
 * cleared before both parents.
 * `personal_notes` references `patients(id)` so must be cleared before patients.
 * `clinical_documents` references `patients(id)` so must be cleared before patients.
 *
 * Use this in `afterEach` / `afterAll` hooks of any integration test that
 * seeds patients or sessions and performs unfiltered cleanup (DELETE without
 * WHERE). This prevents FK violations when the reused Testcontainers DB
 * retains rows from other test suites (E2E, medical-records, etc.).
 */
export async function cleanTestData(): Promise<void> {
  await runAsService(async (db) => {
    // 1. Medical-records tables (children of patients + sessions + evolutions)
    await db.delete(prontuarioExports);
    await db.delete(clinicalDocuments);
    await db.delete(evolutionAttachments);
    await db.delete(personalNotes);
    await db.delete(scaleApplications);
    await db.delete(treatmentPlanVersions);
    await db.delete(treatmentPlans);
    await db.delete(diagnosticHypotheses);
    await db.delete(evolutionVersions);
    await db.delete(evolutions);
    await db.delete(auditLog);

    // 1b. Notifications (children of auth.users, no FK to patients)
    await db.delete(notifications);

    // 1c. Telepsicologia tables (children of sessions via FK)
    await db.delete(videoRecordings);
    await db.delete(videoSessionLogs);
    await db.delete(videoRooms);

    // 1d. Consent terms (children of patients via FK)
    await db.delete(consentTerms);

    // 2. Agenda tables (children of patients)
    await db.delete(sessionHistory);
    await db.delete(sessions);

    // 3. Patients (parent referenced by evolutions + sessions + diagnostic_hypotheses + treatment_plans + consent_terms)
    await db.delete(patients);

    // 4. Auth users created by tests (scoped to test-* emails)
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
}
