import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getTranscriptionSettingsImpl,
  getTranscriptionStatsImpl,
  updateTranscriptionSettingsImpl,
} from '@/modules/ai-transcription/server';
import {
  aiTranscriptions,
  aiTranscriptionSettings,
} from '@/shared/db/schema/ai-transcription/tables';
import { auditLog } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({ id: patientId, userId, fullName: 'Maria Silva' });
  });
}

async function seedTranscription(values: {
  userId: string;
  patientId: string;
  status?: string;
  savedToProntuario?: boolean;
  userEditsCount?: number;
  transcriptionCostUsd?: string | null;
  llmCostUsd?: string | null;
  createdAt?: Date;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: randomUUID(),
      userId: values.userId,
      patientId: values.patientId,
      source: 'manual_upload',
      status: values.status ?? 'ready',
      savedToProntuario: values.savedToProntuario ?? false,
      userEditsCount: values.userEditsCount ?? 0,
      transcriptionCostUsd: values.transcriptionCostUsd ?? null,
      llmCostUsd: values.llmCostUsd ?? null,
      createdAt: values.createdAt ?? new Date(),
    });
  });
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof getTranscriptionSettingsImpl>[0];
}

async function readSettings(userId: string) {
  const { sql, db } = openClient();
  try {
    const [row] = await db
      .select()
      .from(aiTranscriptionSettings)
      .where(eq(aiTranscriptionSettings.userId, userId))
      .limit(1);
    return row;
  } finally {
    await sql.end();
  }
}

async function countSettingsRows(userId: string): Promise<number> {
  return runAsService(async (db) => {
    const rows = await db
      .select({ id: aiTranscriptionSettings.id })
      .from(aiTranscriptionSettings)
      .where(eq(aiTranscriptionSettings.userId, userId));
    return rows.length;
  });
}

async function auditActions(userId: string): Promise<string[]> {
  return runAsService(async (db) => {
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.userId, userId), eq(auditLog.resourceType, 'ai_transcription_settings')),
      );
    return rows.map((r) => r.action);
  });
}

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// getTranscriptionSettings
// ---------------------------------------------------------------------------

describe('getTranscriptionSettingsImpl (integration)', () => {
  it('rejects an anonymous caller', async () => {
    const result = await getTranscriptionSettingsImpl(fakeSupabase(null));
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('creates the default row on first read and reuses it on the second', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const first = await getTranscriptionSettingsImpl(fakeSupabase(userId));
    expect(first).toEqual({
      ok: true,
      enabled: false,
      defaultTemplate: 'livre',
      keepAudioHours: 24,
      keepTranscription: false,
      riskDetectionSensitivity: 'medium',
    });
    expect(await countSettingsRows(userId)).toBe(1);

    const second = await getTranscriptionSettingsImpl(fakeSupabase(userId));
    expect(second).toEqual(first);
    // Still exactly one row — the second read did not duplicate it.
    expect(await countSettingsRows(userId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// updateTranscriptionSettings
// ---------------------------------------------------------------------------

describe('updateTranscriptionSettingsImpl (integration)', () => {
  it('persists the values, writes the enable audit, and is idempotent', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await updateTranscriptionSettingsImpl(fakeSupabase(userId), {
      enabled: true,
      defaultTemplate: 'tcc',
      riskDetectionSensitivity: 'high',
      keepAudioHours: 24,
      keepTranscription: true,
    });
    expect(result).toEqual({ ok: true });

    const row = await readSettings(userId);
    expect(row?.enabled).toBe(true);
    expect(row?.defaultTemplate).toBe('tcc');
    expect(row?.riskDetectionSensitivity).toBe('high');
    expect(row?.keepTranscription).toBe(true);

    // Enabling + toggling keepTranscription → two audit rows.
    const actions = await auditActions(userId);
    expect(actions).toContain('ai_transcription_enabled');
    expect(actions).toContain('ai_transcription_keep_transcription_toggled');

    // Re-saving the identical values emits no further audit rows.
    const again = await updateTranscriptionSettingsImpl(fakeSupabase(userId), {
      enabled: true,
      defaultTemplate: 'tcc',
      riskDetectionSensitivity: 'high',
      keepAudioHours: 24,
      keepTranscription: true,
    });
    expect(again).toEqual({ ok: true });
    expect(await auditActions(userId)).toHaveLength(actions.length);
  });

  it('writes the disable audit when turning the feature off', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await updateTranscriptionSettingsImpl(fakeSupabase(userId), {
      enabled: true,
      defaultTemplate: 'livre',
      riskDetectionSensitivity: 'medium',
      keepAudioHours: 24,
      keepTranscription: false,
    });
    await updateTranscriptionSettingsImpl(fakeSupabase(userId), {
      enabled: false,
      defaultTemplate: 'livre',
      riskDetectionSensitivity: 'medium',
      keepAudioHours: 24,
      keepTranscription: false,
    });

    expect(await auditActions(userId)).toContain('ai_transcription_disabled');
  });

  it('rejects an anonymous caller without writing', async () => {
    const result = await updateTranscriptionSettingsImpl(fakeSupabase(null), {
      enabled: true,
      defaultTemplate: 'livre',
      riskDetectionSensitivity: 'medium',
      keepAudioHours: 24,
      keepTranscription: false,
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('cross-tenant: user B cannot overwrite user A settings (UPSERT keyed by session uid)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // A enables the feature.
    await updateTranscriptionSettingsImpl(fakeSupabase(userA), {
      enabled: true,
      defaultTemplate: 'tcc',
      riskDetectionSensitivity: 'high',
      keepAudioHours: 24,
      keepTranscription: true,
    });

    // B saves their own settings while trying to forge A's user id in the input.
    await updateTranscriptionSettingsImpl(fakeSupabase(userB), {
      enabled: false,
      defaultTemplate: 'livre',
      riskDetectionSensitivity: 'low',
      keepAudioHours: 24,
      keepTranscription: false,
      // forged — must be ignored in favor of the session
      userId: userA,
    });

    // A's row is untouched: the upsert keyed on B's session uid created a
    // separate row, it did not clobber A's.
    const rowA = await readSettings(userA);
    expect(rowA?.enabled).toBe(true);
    expect(rowA?.defaultTemplate).toBe('tcc');
    expect(rowA?.riskDetectionSensitivity).toBe('high');

    const rowB = await readSettings(userB);
    expect(rowB?.enabled).toBe(false);
    expect(rowB?.defaultTemplate).toBe('livre');

    // A and B own distinct rows.
    expect(rowA?.id).not.toBe(rowB?.id);
  });
});

// ---------------------------------------------------------------------------
// getTranscriptionStats
// ---------------------------------------------------------------------------

describe('getTranscriptionStatsImpl (integration)', () => {
  it('returns all-zero metrics for a user with no transcriptions', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await getTranscriptionStatsImpl(fakeSupabase(userId));
    expect(result).toEqual({
      ok: true,
      totalProcessed: 0,
      monthProcessed: 0,
      reviewed: 0,
      savedToProntuario: 0,
      estimatedMinutesSaved: 0,
      acceptanceRatePercent: null,
      avgCostUsd: null,
      failedCount: 0,
    });
  });

  it('aggregates counts, withholds acceptance below 5 reviews, and averages cost', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // 6 reviewed rows; 5 saved without edits, 1 saved with an edit → 5/6 ≈ 83%.
    for (let i = 0; i < 5; i += 1) {
      await seedTranscription({
        userId,
        patientId,
        status: 'reviewed',
        savedToProntuario: true,
        userEditsCount: 0,
        transcriptionCostUsd: '0.0100',
        llmCostUsd: '0.0200',
      });
    }
    await seedTranscription({
      userId,
      patientId,
      status: 'reviewed',
      savedToProntuario: true,
      userEditsCount: 3,
      transcriptionCostUsd: '0.0100',
      llmCostUsd: '0.0200',
    });
    // 1 failed row (no cost metadata).
    await seedTranscription({ userId, patientId, status: 'failed' });

    const result = await getTranscriptionStatsImpl(fakeSupabase(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totalProcessed).toBe(7);
    expect(result.failedCount).toBe(1);
    expect(result.monthProcessed).toBe(7);
    expect(result.estimatedMinutesSaved).toBe(56); // 7 * 8
    expect(result.reviewed).toBe(6);
    expect(result.savedToProntuario).toBe(6);
    expect(result.acceptanceRatePercent).toBe(83); // round(100 * 5/6)
    // 6 rows each cost 0.03; the failed row carries no cost → average 0.03.
    expect(result.avgCostUsd).toBeCloseTo(0.03, 4);
  });

  it('withholds the acceptance rate when reviewed < 5', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    for (let i = 0; i < 4; i += 1) {
      await seedTranscription({
        userId,
        patientId,
        status: 'reviewed',
        savedToProntuario: true,
        userEditsCount: 0,
      });
    }

    const result = await getTranscriptionStatsImpl(fakeSupabase(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviewed).toBe(4);
    expect(result.acceptanceRatePercent).toBeNull();
  });

  it('cross-tenant: stats never count another tenant rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userB, patientB);

    // Only B has transcriptions.
    await seedTranscription({ userId: userB, patientId: patientB, status: 'ready' });
    await seedTranscription({ userId: userB, patientId: patientB, status: 'failed' });

    const resultA = await getTranscriptionStatsImpl(fakeSupabase(userA));
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.totalProcessed).toBe(0);
    expect(resultA.failedCount).toBe(0);
  });
});
