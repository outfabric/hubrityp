/**
 * Inngest function: generate a prontuario export PDF.
 *
 * Triggered by the `prontuario/export-pdf` event emitted when a psychologist
 * requests an export (see `requestProntuarioExportImpl`). The function
 * progresses through 15 discrete steps — each wrapped in `step.run()` for
 * granular retry and observability.
 *
 * **Service-role justification:** This runs as a background job with no user
 * session. The Drizzle `db` client connects as the DB owner (bypasses RLS)
 * and the Supabase admin client uses the service-role key to upload files.
 * Every query is scoped by the `user_id` read from the export row (set by
 * the Server Action at request time) — never from user input. The job's
 * only input is `exportId`; all ownership data is derived from the DB row.
 *
 * **Idempotency:** Function-level idempotency via `idempotency: 'event.data.exportId'`
 * ensures re-delivered events for the same export only run once.
 *
 * **Failure handling:** `onFailure` updates the export row to `status='failed'`
 * with a sanitized error message (no PII, no SQL, no stack trace).
 *
 * **Inngest step serialization:** `step.run()` serializes return values via
 * JSON (Jsonify), converting `Date` to `string`. Outer variables therefore use
 * inferred types; Date reconstruction happens in the `build-pdf` step where
 * the section-builder interfaces require `Date` objects.
 */

import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import {
  computeExpiresAt,
  exportFiltersSchema,
  LARGE_EXPORT_THRESHOLD_BYTES,
  type ExportFilters,
} from '@/modules/medical-records/lib/exports';
import {
  buildProntuarioPdf,
  type BuildProntuarioPdfInput,
} from '@/modules/medical-records/lib/exports/pdf-builder';
import { notify } from '@/modules/notifications';
import {
  auditLog,
  clinicalDocuments,
  diagnosticHypotheses,
  evolutionAttachments,
  evolutions,
  evolutionVersions,
  personalNotes,
  prontuarioExports,
  scaleApplications,
  treatmentPlans,
  treatmentPlanVersions,
} from '@/shared/db/schema/medical-records/tables';
import { anamnesis } from '@/shared/db/schema/patients/tables';

import { inngest, MEDICAL_RECORDS_EVENTS, type ProntuarioExportPdfEventData } from './client';

// ---------------------------------------------------------------------------
// Scale metadata (for PDF rendering)
// ---------------------------------------------------------------------------

const SCALE_META: Record<string, { name: string; min: number; max: number }> = {
  phq9: { name: 'PHQ-9', min: 0, max: 27 },
  gad7: { name: 'GAD-7', min: 0, max: 21 },
  sdq: { name: 'SDQ', min: 0, max: 40 },
  audit: { name: 'AUDIT', min: 0, max: 40 },
  'whoqol-bref': { name: 'WHOQOL-BREF', min: 0, max: 100 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reconstruct a Date from a value that may have been JSON-serialized to string. */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Escape special HTML characters to prevent injection in email templates. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanitize error for storage — no PII, no SQL, no stack trace. */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const firstLine = error.message.split('\n')[0] ?? 'Unknown error';
    return firstLine.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]');
  }
  return 'Unknown error';
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const prontuarioExportPdfFunction = inngest.createFunction(
  {
    id: 'prontuario-export-pdf',
    triggers: [{ event: MEDICAL_RECORDS_EVENTS.PRONTUARIO_EXPORT_PDF }],
    idempotency: 'event.data.exportId',
    retries: 3,
    concurrency: { limit: 5 },
    timeouts: { finish: '5m' },
    onFailure: async ({ error, event, logger }) => {
      // After all retries exhausted — update export row to failed status
      const { db } = await import('@/shared/db/client');

      const originalEvent = event.data.event;
      const data = originalEvent.data as ProntuarioExportPdfEventData;

      const sanitizedMessage = sanitizeErrorMessage(error);

      // service-role — no user session in background jobs; export row is
      // identified by its ID, not by user input
      await db
        .update(prontuarioExports)
        .set({
          status: 'failed',
          errorMessage: sanitizedMessage,
        })
        .where(eq(prontuarioExports.id, data.exportId));

      logger.error(
        {
          event: 'prontuario_export_failed',
          exportId: data.exportId,
          errorMessage: sanitizedMessage,
        },
        `Prontuario export failed after all retries for export ${data.exportId}`,
      );
    },
  },
  async ({ event, step, logger }) => {
    const data = event.data as ProntuarioExportPdfEventData;
    const { exportId } = data;

    // -----------------------------------------------------------------------
    // Step 1: update-status — SET status='processing'
    // -----------------------------------------------------------------------
    const exportRow = await step.run('update-status', async () => {
      const { db } = await import('@/shared/db/client');

      const [row] = await db
        .select({
          id: prontuarioExports.id,
          userId: prontuarioExports.userId,
          patientId: prontuarioExports.patientId,
          status: prontuarioExports.status,
          filters: prontuarioExports.filters,
          createdAt: prontuarioExports.createdAt,
        })
        .from(prontuarioExports)
        .where(eq(prontuarioExports.id, exportId))
        .limit(1);

      if (!row) return null;

      // Idempotency: skip if already past pending
      if (row.status !== 'pending') return null;

      // service-role — status transitions are managed by the Inngest job
      await db
        .update(prontuarioExports)
        .set({ status: 'processing' })
        .where(eq(prontuarioExports.id, exportId));

      return row;
    });

    if (!exportRow) {
      logger.info(
        { event: 'prontuario_export_skipped', exportId },
        'Skipped — export not found or not in pending status',
      );
      return { skipped: true, reason: 'not_found_or_not_pending' };
    }

    const { userId, patientId } = exportRow;
    // createdAt is serialized to string by Inngest step; reconstruct
    const exportRequestedAt = toDate(exportRow.createdAt);

    // Parse filters with defaults
    const filters: ExportFilters = exportFiltersSchema.parse(exportRow.filters);

    // -----------------------------------------------------------------------
    // Step 2: fetch-patient + psychologist profile
    // -----------------------------------------------------------------------
    const patientData = await step.run('fetch-patient', async () => {
      const { db } = await import('@/shared/db/client');
      const { patients } = await import('@/shared/db/schema/patients/tables');
      const { profiles } = await import('@/shared/db/schema/auth/tables');

      // Fetch patient scoped by userId (defense-in-depth — the Server Action
      // verified ownership at request time, but we re-verify here)
      const [patient] = await db
        .select({
          fullName: patients.fullName,
          birthDate: patients.birthDate,
          patientType: patients.patientType,
        })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
        .limit(1);

      if (!patient) {
        throw new Error('Patient not found or not owned by user');
      }

      // Fetch psychologist profile
      const [profile] = await db
        .select({
          name: profiles.fullName,
          crpNumber: profiles.crpNumber,
          crpUf: profiles.crpUf,
          email: profiles.email,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

      if (!profile) {
        throw new Error('Psychologist profile not found');
      }

      return {
        patient: {
          fullName: patient.fullName,
          birthDate: patient.birthDate ? patient.birthDate.toISOString().slice(0, 10) : null,
          patientType: patient.patientType,
        },
        psychologist: {
          name: profile.name,
          crp: `${profile.crpNumber}/${profile.crpUf}`,
          email: profile.email,
        },
      };
    });

    // -----------------------------------------------------------------------
    // Step 3: fetch-anamnesis
    // -----------------------------------------------------------------------
    const anamnesisData = await step.run('fetch-anamnesis', async () => {
      if (!filters.sections.anamnese) return null;

      const { db } = await import('@/shared/db/client');
      const { patients } = await import('@/shared/db/schema/patients/tables');

      // SECURITY: anamnesis has no user_id column; ownership is via the
      // patient's user_id. patientId was verified to belong to userId in
      // 'fetch-patient' (step 2). The defensive subquery below ensures this
      // step remains independently safe if ever extracted or reordered.
      const [row] = await db
        .select({
          chiefComplaint: anamnesis.chiefComplaint,
          historyPresentIllness: anamnesis.historyPresentIllness,
          familyHistory: anamnesis.familyHistory,
          educationalProfessional: anamnesis.educationalProfessional,
          physicalHealth: anamnesis.physicalHealth,
          priorTherapy: anamnesis.priorTherapy,
          initialHypothesis: anamnesis.initialHypothesis,
          treatmentPlan: anamnesis.treatmentPlan,
          customSections: anamnesis.customSections,
        })
        .from(anamnesis)
        .where(
          and(
            eq(anamnesis.patientId, patientId),
            sql`${patientId} IN (SELECT ${patients.id} FROM ${patients} WHERE ${patients.userId} = ${userId})`,
          ),
        )
        .limit(1);

      if (!row) return null;

      return {
        chiefComplaint: row.chiefComplaint,
        historyPresentIllness: row.historyPresentIllness,
        familyHistory: row.familyHistory,
        educationalProfessional: row.educationalProfessional,
        physicalHealth: row.physicalHealth,
        priorTherapy: row.priorTherapy,
        initialHypothesis: row.initialHypothesis,
        treatmentPlan: row.treatmentPlan,
        customSections: row.customSections as Record<string, string>[] | null,
      };
    });

    // -----------------------------------------------------------------------
    // Step 4: fetch-evolutions (with dateRange filter)
    // -----------------------------------------------------------------------
    const evolutionsRaw = await step.run('fetch-evolutions', async () => {
      if (!filters.sections.evolucoes) return [];

      const { db } = await import('@/shared/db/client');

      const conditions = [eq(evolutions.patientId, patientId), eq(evolutions.userId, userId)];

      if (filters.dateRange.from) {
        conditions.push(gte(evolutions.createdAt, new Date(filters.dateRange.from)));
      }
      if (filters.dateRange.to) {
        conditions.push(lte(evolutions.createdAt, new Date(filters.dateRange.to)));
      }

      const rows = await db
        .select({
          id: evolutions.id,
          templateType: evolutions.templateType,
          content: evolutions.content,
          createdAt: evolutions.createdAt,
          finalizedAt: evolutions.finalizedAt,
        })
        .from(evolutions)
        .where(and(...conditions))
        .orderBy(evolutions.createdAt);

      // Fetch addenda for each evolution
      const result = [];
      for (const evo of rows) {
        const versions = await db
          .select({
            versionNumber: evolutionVersions.versionNumber,
            content: evolutionVersions.content,
            reason: evolutionVersions.reason,
            createdAt: evolutionVersions.createdAt,
            isAddendum: evolutionVersions.isAddendum,
          })
          .from(evolutionVersions)
          .where(
            and(eq(evolutionVersions.evolutionId, evo.id), eq(evolutionVersions.isAddendum, true)),
          )
          .orderBy(evolutionVersions.versionNumber);

        result.push({
          id: evo.id,
          templateType: evo.templateType,
          content: evo.content as Record<string, unknown>,
          createdAt: evo.createdAt.toISOString(),
          finalizedAt: evo.finalizedAt?.toISOString() ?? null,
          addenda: versions.map((v) => ({
            versionNumber: v.versionNumber,
            content: v.content as Record<string, unknown>,
            reason: v.reason,
            createdAt: v.createdAt.toISOString(),
          })),
        });
      }

      return result;
    });

    // -----------------------------------------------------------------------
    // Step 5: fetch-hypotheses
    // -----------------------------------------------------------------------
    const hypothesesRaw = await step.run('fetch-hypotheses', async () => {
      if (!filters.sections.hipoteses) return [];

      const { db } = await import('@/shared/db/client');

      const rows = await db
        .select({
          cid10Code: diagnosticHypotheses.cid10Code,
          description: diagnosticHypotheses.description,
          cid10Description: diagnosticHypotheses.cid10Description,
          status: diagnosticHypotheses.status,
          createdAt: diagnosticHypotheses.createdAt,
        })
        .from(diagnosticHypotheses)
        .where(
          and(
            eq(diagnosticHypotheses.patientId, patientId),
            eq(diagnosticHypotheses.userId, userId),
          ),
        )
        .orderBy(diagnosticHypotheses.createdAt);

      // Serialize dates for cross-step transport
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    });

    // -----------------------------------------------------------------------
    // Step 6: fetch-treatment-plan
    // -----------------------------------------------------------------------
    const treatmentPlanData = await step.run('fetch-treatment-plan', async () => {
      if (!filters.sections.planoTerapeutico) {
        return { current: null, versionCount: 0 };
      }

      const { db } = await import('@/shared/db/client');

      const [plan] = await db
        .select({
          id: treatmentPlans.id,
          goals: treatmentPlans.goals,
          phases: treatmentPlans.phases,
          resources: treatmentPlans.resources,
          successCriteria: treatmentPlans.successCriteria,
          currentVersion: treatmentPlans.currentVersion,
        })
        .from(treatmentPlans)
        .where(and(eq(treatmentPlans.patientId, patientId), eq(treatmentPlans.userId, userId)))
        .limit(1);

      if (!plan) {
        return { current: null, versionCount: 0 };
      }

      const [versionCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(treatmentPlanVersions)
        .where(eq(treatmentPlanVersions.planId, plan.id));

      return {
        current: {
          goals: plan.goals as unknown[],
          phases: plan.phases as unknown[],
          resources: plan.resources,
          successCriteria: plan.successCriteria,
          currentVersion: plan.currentVersion,
        },
        versionCount: versionCountRow?.count ?? 0,
      };
    });

    // -----------------------------------------------------------------------
    // Step 7: fetch-scales (with dateRange filter)
    // -----------------------------------------------------------------------
    const scalesRaw = await step.run('fetch-scales', async () => {
      if (!filters.sections.escalas) return [];

      const { db } = await import('@/shared/db/client');

      const conditions = [
        eq(scaleApplications.patientId, patientId),
        eq(scaleApplications.userId, userId),
      ];

      if (filters.dateRange.from) {
        conditions.push(gte(scaleApplications.appliedAt, new Date(filters.dateRange.from)));
      }
      if (filters.dateRange.to) {
        conditions.push(lte(scaleApplications.appliedAt, new Date(filters.dateRange.to)));
      }

      const rows = await db
        .select({
          scaleKey: scaleApplications.scaleKey,
          appliedAt: scaleApplications.appliedAt,
          totalScore: scaleApplications.totalScore,
          classification: scaleApplications.classification,
        })
        .from(scaleApplications)
        .where(and(...conditions))
        .orderBy(scaleApplications.scaleKey, scaleApplications.appliedAt);

      // Group by scaleKey; serialize dates for cross-step transport
      const groups = new Map<
        string,
        {
          scaleKey: string;
          scaleName: string;
          scoreRange: { min: number; max: number };
          applications: {
            scaleKey: string;
            appliedAt: string;
            totalScore: number | null;
            classification: string | null;
          }[];
        }
      >();

      for (const row of rows) {
        const meta = SCALE_META[row.scaleKey];
        if (!groups.has(row.scaleKey)) {
          groups.set(row.scaleKey, {
            scaleKey: row.scaleKey,
            scaleName: meta?.name ?? row.scaleKey,
            scoreRange: meta ? { min: meta.min, max: meta.max } : { min: 0, max: 100 },
            applications: [],
          });
        }
        groups.get(row.scaleKey)!.applications.push({
          scaleKey: row.scaleKey,
          appliedAt: row.appliedAt.toISOString(),
          totalScore: row.totalScore,
          classification: row.classification,
        });
      }

      return Array.from(groups.values());
    });

    // -----------------------------------------------------------------------
    // Step 8: fetch-documents
    // -----------------------------------------------------------------------
    const documentsRaw = await step.run('fetch-documents', async () => {
      if (!filters.sections.documentos) return [];

      const { db } = await import('@/shared/db/client');

      const rows = await db
        .select({
          documentType: clinicalDocuments.documentType,
          title: clinicalDocuments.title,
          status: clinicalDocuments.status,
          referencesCid10: clinicalDocuments.referencesCid10,
          createdAt: clinicalDocuments.createdAt,
        })
        .from(clinicalDocuments)
        .where(
          and(eq(clinicalDocuments.patientId, patientId), eq(clinicalDocuments.userId, userId)),
        )
        .orderBy(clinicalDocuments.createdAt);

      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    });

    // -----------------------------------------------------------------------
    // Step 9: fetch-attachments
    // -----------------------------------------------------------------------
    const attachmentsRaw = await step.run('fetch-attachments', async () => {
      if (!filters.sections.anexosIndex) return [];

      const { db } = await import('@/shared/db/client');

      const rows = await db
        .select({
          displayName: evolutionAttachments.displayName,
          category: evolutionAttachments.category,
          fileSize: evolutionAttachments.fileSize,
          uploadedAt: evolutionAttachments.uploadedAt,
        })
        .from(evolutionAttachments)
        .where(
          and(
            eq(evolutionAttachments.patientId, patientId),
            eq(evolutionAttachments.userId, userId),
            isNull(evolutionAttachments.deletedAt),
          ),
        )
        .orderBy(evolutionAttachments.uploadedAt);

      return rows.map((r) => ({
        ...r,
        uploadedAt: r.uploadedAt.toISOString(),
      }));
    });

    // -----------------------------------------------------------------------
    // Step 10: fetch-personal-notes (conditional)
    // -----------------------------------------------------------------------
    const personalNotesRaw = await step.run('fetch-personal-notes', async () => {
      if (!filters.includePersonalNotes) return null;

      const { db } = await import('@/shared/db/client');

      const rows = await db
        .select({
          content: personalNotes.content,
          updatedAt: personalNotes.updatedAt,
        })
        .from(personalNotes)
        .where(and(eq(personalNotes.patientId, patientId), eq(personalNotes.userId, userId)));

      if (rows.length === 0) return null;

      return rows.map((r) => ({
        ...r,
        updatedAt: r.updatedAt.toISOString(),
      }));
    });

    // -----------------------------------------------------------------------
    // Step 11: build-pdf
    //
    // Reconstruct Date objects from ISO strings (Inngest step serialization
    // converts Date -> string). The section-builder interfaces require Date.
    // -----------------------------------------------------------------------
    const pdfBase64: string = await step.run('build-pdf', async (): Promise<string> => {
      const input: BuildProntuarioPdfInput = {
        patient: patientData.patient,
        psychologist: patientData.psychologist,
        exportRequestedAt,
        filters,
        anamnesis: anamnesisData,
        evolutions: evolutionsRaw.map((e) => ({
          ...e,
          createdAt: new Date(e.createdAt),
          finalizedAt: e.finalizedAt ? new Date(e.finalizedAt) : null,
          addenda: e.addenda.map((a) => ({
            ...a,
            createdAt: new Date(a.createdAt),
          })),
        })),
        hypotheses: hypothesesRaw.map((h) => ({
          ...h,
          createdAt: new Date(h.createdAt),
        })),
        treatmentPlan: treatmentPlanData,
        scales: scalesRaw.map((g) => ({
          ...g,
          applications: g.applications.map((a) => ({
            ...a,
            appliedAt: new Date(a.appliedAt),
          })),
        })),
        documents: documentsRaw.map((d) => ({
          ...d,
          createdAt: new Date(d.createdAt),
        })),
        attachments: attachmentsRaw.map((a) => ({
          ...a,
          uploadedAt: new Date(a.uploadedAt),
        })),
        personalNotes: personalNotesRaw
          ? personalNotesRaw.map((n) => ({
              ...n,
              updatedAt: new Date(n.updatedAt),
            }))
          : null,
      };

      const buffer = await buildProntuarioPdf(input);

      // Inngest step serialization requires JSON-safe return values.
      // Convert Buffer to base64 string for cross-step transport.
      return buffer.toString('base64');
    });

    // -----------------------------------------------------------------------
    // Step 12: upload to Storage
    // -----------------------------------------------------------------------
    const storagePath = `${userId}/${patientId}/${exportId}.pdf`;
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const fileSize = pdfBuffer.length;

    await step.run('upload-to-storage', async (): Promise<void> => {
      const { createClient } = await import('@supabase/supabase-js');
      const { serverEnv } = await import('@/shared/env');
      const { clientEnv } = await import('@/shared/env/client');

      // service-role Supabase client — bypasses Storage policies.
      // Justified: background job with no user session; the bucket has
      // restrictive policies; we need programmatic upload.
      const storageClient = createClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      );

      const { error } = await storageClient.storage
        .from('prontuario-exports')
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
      }
    });

    // -----------------------------------------------------------------------
    // Step 13: complete — update status to ready
    // -----------------------------------------------------------------------
    const completedAt = new Date();
    const expiresAt = computeExpiresAt(fileSize, completedAt);

    await step.run('complete', async (): Promise<void> => {
      const { db } = await import('@/shared/db/client');

      // service-role — export status transitions are service-managed
      await db
        .update(prontuarioExports)
        .set({
          status: 'ready',
          storagePath,
          fileSize,
          expiresAt,
          completedAt,
        })
        .where(eq(prontuarioExports.id, exportId));
    });

    // -----------------------------------------------------------------------
    // Step 14: notify — in-app notification + email if file_size > 10MB
    // -----------------------------------------------------------------------
    await step.run('notify', async (): Promise<void> => {
      const { db } = await import('@/shared/db/client');

      // In-app notification (always)
      const patientFirstName = patientData.patient.fullName.trim().split(' ')[0] || 'paciente';
      await notify(db, {
        userId,
        type: 'prontuario_export_ready',
        title: `Exportação do prontuário de ${patientFirstName} está pronta para download`,
        actionUrl: `/pacientes/${patientId}/prontuario/exportacoes`,
      });

      // Email only if large file
      if (fileSize > LARGE_EXPORT_THRESHOLD_BYTES) {
        const { createClient } = await import('@supabase/supabase-js');
        const { serverEnv } = await import('@/shared/env');
        const { clientEnv } = await import('@/shared/env/client');
        const { sendEmailViaResend } = await import('@/shared/lib/mail');

        // Determine recipient email
        const recipientEmail = filters.deliveryEmail ?? patientData.psychologist.email;

        // Generate signed URL with expiry matching the export's expiration
        const storageClient = createClient(
          clientEnv.NEXT_PUBLIC_SUPABASE_URL,
          serverEnv.SUPABASE_SERVICE_ROLE_KEY,
        );

        const expiresInSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

        const { data: signedUrlData } = await storageClient.storage
          .from('prontuario-exports')
          .createSignedUrl(storagePath, expiresInSeconds);

        const downloadUrl = signedUrlData?.signedUrl ?? '';
        const fileSizeMb = (fileSize / 1_000_000).toFixed(1);
        const expiryDate = expiresAt.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });

        await sendEmailViaResend({
          to: recipientEmail,
          subject: `Exportação de prontuário pronta (${fileSizeMb} MB)`,
          html: buildExportEmailHtml({
            patientFirstName,
            fileSizeMb,
            downloadUrl,
            expiryDate,
          }),
          text: buildExportEmailText({
            patientFirstName,
            fileSizeMb,
            downloadUrl,
            expiryDate,
          }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Step 15: audit-complete
    // -----------------------------------------------------------------------
    await step.run('audit-complete', async (): Promise<void> => {
      const { db } = await import('@/shared/db/client');

      // service-role — audit_log has no INSERT policy for authenticated users
      await db.insert(auditLog).values({
        userId,
        action: 'prontuario.export-completed',
        resourceType: 'prontuario_export',
        resourceId: exportId,
        metadata: {
          storagePath,
          fileSize,
          patientId,
          expiresAt: expiresAt.toISOString(),
          includesPersonalNotes: filters.includePersonalNotes,
        },
      });
    });

    logger.info(
      { event: 'prontuario_export_complete', exportId, fileSize },
      `Prontuario export completed for export ${exportId}`,
    );

    return { success: true, exportId, storagePath, fileSize };
  },
);

// ---------------------------------------------------------------------------
// Email templates (inline — no PII in template structure)
// ---------------------------------------------------------------------------

interface ExportEmailParams {
  patientFirstName: string;
  fileSizeMb: string;
  downloadUrl: string;
  expiryDate: string;
}

function buildExportEmailHtml(params: ExportEmailParams): string {
  // Belt-and-suspenders: reject non-HTTPS URLs to prevent injection via
  // unexpected protocol schemes (javascript:, data:, etc.)
  if (!params.downloadUrl.startsWith('https://') && !params.downloadUrl.startsWith('http://')) {
    throw new Error('downloadUrl must use https:// or http:// protocol');
  }

  // Escape all interpolated values to prevent HTML injection
  const name = escapeHtml(params.patientFirstName);
  const size = escapeHtml(params.fileSizeMb);
  const url = escapeHtml(params.downloadUrl);
  const expiry = escapeHtml(params.expiryDate);

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; color: #1a1a1a; line-height: 1.6;">
  <h2>Exportação de prontuário pronta</h2>
  <p>Olá,</p>
  <p>A exportação do prontuário de <strong>${name}</strong> foi concluída com sucesso.</p>
  <p>Tamanho do arquivo: <strong>${size} MB</strong></p>
  <p>O link para download expira em <strong>${expiry}</strong>.</p>
  <p><a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;">Baixar prontuário</a></p>
  <p style="font-size: 0.85em; color: #666;">Se você não solicitou esta exportação, por favor desconsidere este e-mail.</p>
  <br/>
  <p>— Equipe HubrityP</p>
</body>
</html>`.trim();
}

function buildExportEmailText(params: ExportEmailParams): string {
  return [
    'Exportação de prontuário pronta',
    '',
    'Olá,',
    '',
    `A exportação do prontuário de ${params.patientFirstName} foi concluída com sucesso.`,
    `Tamanho do arquivo: ${params.fileSizeMb} MB`,
    `O link para download expira em ${params.expiryDate}.`,
    '',
    `Link para download: ${params.downloadUrl}`,
    '',
    'Se você não solicitou esta exportação, por favor desconsidere este e-mail.',
    '',
    '— Equipe HubrityP',
  ].join('\n');
}
