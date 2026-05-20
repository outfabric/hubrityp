import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { openClient } from '@/__tests__/integration/setup/db';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { expireExports } from '@/modules/medical-records/inngest/expire-exports';
import { profiles } from '@/shared/db/schema/auth/tables';
import { prontuarioExports } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// Module mocks required by transitive imports.
// The expire-exports module calls `inngest.createFunction` at module scope,
// so the mock must provide that method in addition to `send`.
vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: [] }),
    createFunction: vi.fn().mockReturnValue(vi.fn()),
  },
  MEDICAL_RECORDS_EVENTS: { PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf' },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('127.0.0.1'),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
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

async function seedProfile(userId: string): Promise<void> {
  const crpSerial = userId.replace(/-/g, '').slice(0, 7);
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName: 'Dr. Cron Test',
      crpNumber: `06/${crpSerial}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Cron Patient',
    });
  });
}

async function seedExport(
  userId: string,
  patientId: string,
  exportId: string,
  overrides: {
    status: string;
    expiresAt: Date | null;
    storagePath?: string | null;
  },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(prontuarioExports).values({
      id: exportId,
      userId,
      patientId,
      status: overrides.status,
      filters: {
        dateRange: { from: null, to: null },
        sections: {
          anamnese: true,
          evolucoes: true,
          hipoteses: true,
          planoTerapeutico: true,
          escalas: true,
          documentos: true,
          anexosIndex: true,
        },
        includePersonalNotes: false,
      },
      storagePath: overrides.storagePath ?? `${userId}/${patientId}/${exportId}.pdf`,
      expiresAt: overrides.expiresAt,
      completedAt: overrides.status === 'ready' ? new Date() : null,
    });
  });
}

function createMockStorageClient(shouldFail = false) {
  const removeMock = vi.fn().mockResolvedValue({
    error: shouldFail ? { message: 'Storage delete failed' } : null,
  });
  const fromMock = vi.fn().mockReturnValue({ remove: removeMock });

  return {
    client: { storage: { from: fromMock } },
    removeMock,
    fromMock,
  };
}

const silentLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

afterEach(async () => {
  vi.clearAllMocks();
  await cleanTestData();
});

// ===========================================================================
// expireExports (core logic)
// ===========================================================================

describe('expireExports cron logic', () => {
  it('transitions expired-ready row to expired status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const expiredId = randomUUID();
    const futureId = randomUUID();
    const failedId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    // Row 1: ready + expired (should transition)
    await seedExport(userId, patientId, expiredId, {
      status: 'ready',
      expiresAt: new Date(Date.now() - 60_000), // 1 minute ago
    });

    // Row 2: ready + future (should NOT change)
    await seedExport(userId, patientId, futureId, {
      status: 'ready',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    });

    // Row 3: failed (should NOT change)
    await seedExport(userId, patientId, failedId, {
      status: 'failed',
      expiresAt: new Date(Date.now() - 60_000), // expired but status=failed
    });

    const { client } = createMockStorageClient();

    // Run the expiry logic with a real DB connection
    const { sql, db } = openClient();
    try {
      const result = await expireExports({ db, storageClient: client }, silentLogger);

      expect(result.expiredCount).toBe(1);
      expect(result.storageDeleteErrors).toBe(0);
    } finally {
      await sql.end();
    }

    // Verify row states
    const rows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });

    const expired = rows.find((r) => r.id === expiredId);
    const future = rows.find((r) => r.id === futureId);
    const failed = rows.find((r) => r.id === failedId);

    expect(expired!.status).toBe('expired');
    expect(future!.status).toBe('ready');
    expect(failed!.status).toBe('failed');
  });

  it('calls Storage remove for the expired row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();
    const storagePath = `${userId}/${patientId}/${exportId}.pdf`;

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, {
      status: 'ready',
      expiresAt: new Date(Date.now() - 60_000),
      storagePath,
    });

    const { client, removeMock, fromMock } = createMockStorageClient();

    const { sql, db } = openClient();
    try {
      await expireExports({ db, storageClient: client }, silentLogger);
    } finally {
      await sql.end();
    }

    expect(fromMock).toHaveBeenCalledWith('prontuario-exports');
    expect(removeMock).toHaveBeenCalledWith([storagePath]);
  });

  it('still transitions to expired when Storage delete fails (non-fatal)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, {
      status: 'ready',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const { client } = createMockStorageClient(true); // Storage fails

    const { sql, db } = openClient();
    try {
      const result = await expireExports({ db, storageClient: client }, silentLogger);

      expect(result.expiredCount).toBe(1);
      expect(result.storageDeleteErrors).toBe(1);
    } finally {
      await sql.end();
    }

    // Status should still be expired despite Storage failure
    const rows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports).where(eq(prontuarioExports.id, exportId));
    });
    expect(rows[0]!.status).toBe('expired');
  });

  it('returns zero counts when no rows match', async () => {
    const { client } = createMockStorageClient();

    const { sql, db } = openClient();
    try {
      const result = await expireExports({ db, storageClient: client }, silentLogger);

      expect(result.expiredCount).toBe(0);
      expect(result.storageDeleteErrors).toBe(0);
    } finally {
      await sql.end();
    }
  });
});
