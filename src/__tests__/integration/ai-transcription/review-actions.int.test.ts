import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discardTranscriptionImpl,
  getTranscriptionForReviewImpl,
  saveTranscriptionToProntuarioImpl,
  updateTranscriptionDraftImpl,
} from '@/modules/ai-transcription/server';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { auditLog, evolutions } from '@/shared/db/schema/medical-records/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NOTE = {
  schemaVersion: 1 as const,
  humorInicial: 'ansioso',
  humorFinal: 'tranquilo',
  pauta: ['ansiedade no trabalho'],
  conteudoTrabalhado: ['reestruturação cognitiva'],
  tarefaCasa: ['registro de pensamentos'],
  palavrasRisco: [],
  observacoesExtras: null,
};

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  fullName = 'Maria Silva',
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({ id: patientId, userId, fullName });
  });
}

async function seedSession(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    const now = new Date();
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3_600_000),
      durationMinutes: 60,
      status: 'done',
    });
  });
}

async function seedActiveConsent(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id: randomUUID(),
      patientId,
      userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: randomBytes(32).toString('hex'),
      signedAt: new Date(),
      revokedAt: null,
      templateVersion: 1,
      templateSnapshot: { version: 1 },
      revocationTakesEffectImmediately: true,
      createdAt: new Date(),
    });
  });
}

async function seedTranscription(values: {
  id: string;
  userId: string;
  patientId: string;
  sessionId?: string | null;
  status?: string;
  generatedNote?: unknown;
  riskAlerts?: unknown;
  savedToProntuario?: boolean;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: values.id,
      userId: values.userId,
      patientId: values.patientId,
      sessionId: values.sessionId ?? null,
      source: 'manual_upload',
      status: values.status ?? 'ready',
      templateUsed: 'tcc',
      generatedNote: values.generatedNote ?? VALID_NOTE,
      riskAlerts: values.riskAlerts ?? [],
      savedToProntuario: values.savedToProntuario ?? false,
    });
  });
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof getTranscriptionForReviewImpl>[0];
}

async function readTranscription(id: string) {
  const { sql, db } = openClient();
  try {
    const [row] = await db
      .select()
      .from(aiTranscriptions)
      .where(eq(aiTranscriptions.id, id))
      .limit(1);
    return row;
  } finally {
    await sql.end();
  }
}

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// getTranscriptionForReview
// ---------------------------------------------------------------------------

describe('getTranscriptionForReviewImpl (integration)', () => {
  it('returns the owner-scoped review payload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'João Pedro Souza');
    await seedSession(userId, patientId, sessionId);
    await seedTranscription({ id: transcriptionId, userId, patientId, sessionId });

    const result = await getTranscriptionForReviewImpl(fakeSupabase(userId), { transcriptionId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcriptionId).toBe(transcriptionId);
    expect(result.patientFirstName).toBe('João');
    expect(result.sessionId).toBe(sessionId);
    expect(result.sessionDate).toBeInstanceOf(Date);
    expect(result.generatedNote).toMatchObject({ schemaVersion: 1 });
  });

  it('returns NOT_FOUND when another tenant queries the row (IDOR)', async () => {
    const ownerId = randomUUID();
    const attackerId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(ownerId);
    await seedAuthUser(attackerId);
    await seedPatient(ownerId, patientId);
    await seedTranscription({ id: transcriptionId, userId: ownerId, patientId });

    const result = await getTranscriptionForReviewImpl(fakeSupabase(attackerId), {
      transcriptionId,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('degrades generatedNote to null and keeps the row readable on schema drift', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription({
      id: transcriptionId,
      userId,
      patientId,
      generatedNote: { schemaVersion: 1, pauta: ['x'] }, // missing required fields
    });

    const result = await getTranscriptionForReviewImpl(fakeSupabase(userId), { transcriptionId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.generatedNote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTranscriptionDraft
// ---------------------------------------------------------------------------

describe('updateTranscriptionDraftImpl (integration)', () => {
  it('persists edits and increments user_edits_count', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription({ id: transcriptionId, userId, patientId, status: 'ready' });

    const edited = { ...VALID_NOTE, observacoesExtras: 'editado pelo psicólogo' };
    const result = await updateTranscriptionDraftImpl(fakeSupabase(userId), {
      transcriptionId,
      generatedNote: edited,
    });

    expect(result.ok).toBe(true);

    const row = await readTranscription(transcriptionId);
    expect(row?.userEditsCount).toBe(1);
    expect((row?.generatedNote as { observacoesExtras: string }).observacoesExtras).toBe(
      'editado pelo psicólogo',
    );
  });

  it("returns NOT_EDITABLE when status='pending'", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription({ id: transcriptionId, userId, patientId, status: 'pending' });

    const result = await updateTranscriptionDraftImpl(fakeSupabase(userId), {
      transcriptionId,
      generatedNote: VALID_NOTE,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_EDITABLE' });
  });

  it('returns NOT_EDITABLE for a cross-tenant id and leaves the row untouched (IDOR)', async () => {
    const ownerId = randomUUID();
    const attackerId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(ownerId);
    await seedAuthUser(attackerId);
    await seedPatient(ownerId, patientId);
    await seedTranscription({ id: transcriptionId, userId: ownerId, patientId, status: 'ready' });

    const result = await updateTranscriptionDraftImpl(fakeSupabase(attackerId), {
      transcriptionId,
      generatedNote: { ...VALID_NOTE, observacoesExtras: 'attacker edit' },
    });

    expect(result).toEqual({ ok: false, code: 'NOT_EDITABLE' });

    const row = await readTranscription(transcriptionId);
    expect(row?.userEditsCount).toBe(0);
    expect(
      (row?.generatedNote as { observacoesExtras: string | null }).observacoesExtras,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveTranscriptionToProntuario
// ---------------------------------------------------------------------------

describe('saveTranscriptionToProntuarioImpl (integration)', () => {
  it('creates a flagged evolution and marks the transcription saved', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedSession(userId, patientId, sessionId);
    await seedTranscription({ id: transcriptionId, userId, patientId, sessionId, status: 'ready' });

    const result = await saveTranscriptionToProntuarioImpl(fakeSupabase(userId), {
      transcriptionId,
      reviewedChecked: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const evo = await runAsService(async (db) => {
      const [e] = await db
        .select()
        .from(evolutions)
        .where(eq(evolutions.id, result.evolutionId))
        .limit(1);
      return e;
    });
    expect(evo?.aiAssisted).toBe(true);
    expect(evo?.aiTranscriptionId).toBe(transcriptionId);

    const row = await readTranscription(transcriptionId);
    expect(row?.status).toBe('reviewed');
    expect(row?.savedToProntuario).toBe(true);
    expect(row?.evolutionId).toBe(result.evolutionId);
  });

  it('rejects a second save (idempotent ALREADY_SAVED) without creating a second evolution', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedSession(userId, patientId, sessionId);
    await seedTranscription({ id: transcriptionId, userId, patientId, sessionId, status: 'ready' });

    const first = await saveTranscriptionToProntuarioImpl(fakeSupabase(userId), {
      transcriptionId,
      reviewedChecked: true,
    });
    expect(first.ok).toBe(true);

    const second = await saveTranscriptionToProntuarioImpl(fakeSupabase(userId), {
      transcriptionId,
      reviewedChecked: true,
    });
    expect(second).toEqual({ ok: false, code: 'ALREADY_SAVED' });

    const evoCount = await runAsService(async (db) => {
      const rows = await db
        .select({ id: evolutions.id })
        .from(evolutions)
        .where(eq(evolutions.patientId, patientId));
      return rows.length;
    });
    expect(evoCount).toBe(1);
  });

  it('returns NOT_FOUND for a cross-tenant save and creates no evolution (IDOR)', async () => {
    const ownerId = randomUUID();
    const attackerId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(ownerId);
    await seedAuthUser(attackerId);
    await seedPatient(ownerId, patientId);
    await seedTranscription({ id: transcriptionId, userId: ownerId, patientId, status: 'ready' });

    const result = await saveTranscriptionToProntuarioImpl(fakeSupabase(attackerId), {
      transcriptionId,
      reviewedChecked: true,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });

    const evoCount = await runAsService(async (db) => {
      const rows = await db.select({ id: evolutions.id }).from(evolutions);
      return rows.length;
    });
    expect(evoCount).toBe(0);

    const row = await readTranscription(transcriptionId);
    expect(row?.savedToProntuario).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discardTranscription
// ---------------------------------------------------------------------------

describe('discardTranscriptionImpl (integration)', () => {
  it('marks the row reviewed-without-saving and writes a PII-free audit row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription({ id: transcriptionId, userId, patientId, status: 'ready' });

    const result = await discardTranscriptionImpl(fakeSupabase(userId), { transcriptionId });
    expect(result).toEqual({ ok: true });

    const row = await readTranscription(transcriptionId);
    expect(row?.status).toBe('reviewed');
    expect(row?.savedToProntuario).toBe(false);
    expect(row?.reviewedAt).toBeInstanceOf(Date);

    const audit = await runAsService(async (db) => {
      const [a] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'ai_transcription_discarded'),
            eq(auditLog.resourceId, transcriptionId),
          ),
        )
        .limit(1);
      return a;
    });
    expect(audit?.userId).toBe(userId);
    expect(audit?.metadata).toEqual({});
  });

  it('is idempotent: second discard returns ALREADY_REVIEWED, no second audit row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription({ id: transcriptionId, userId, patientId, status: 'ready' });

    await discardTranscriptionImpl(fakeSupabase(userId), { transcriptionId });
    const second = await discardTranscriptionImpl(fakeSupabase(userId), { transcriptionId });
    expect(second).toEqual({ ok: false, code: 'ALREADY_REVIEWED' });

    const auditCount = await runAsService(async (db) => {
      const rows = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'ai_transcription_discarded'),
            eq(auditLog.resourceId, transcriptionId),
          ),
        );
      return rows.length;
    });
    expect(auditCount).toBe(1);
  });

  it('returns NOT_FOUND for a cross-tenant discard (IDOR)', async () => {
    const ownerId = randomUUID();
    const attackerId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(ownerId);
    await seedAuthUser(attackerId);
    await seedPatient(ownerId, patientId);
    await seedTranscription({ id: transcriptionId, userId: ownerId, patientId, status: 'ready' });

    const result = await discardTranscriptionImpl(fakeSupabase(attackerId), { transcriptionId });
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });

    const row = await readTranscription(transcriptionId);
    expect(row?.status).toBe('ready'); // untouched
  });
});
