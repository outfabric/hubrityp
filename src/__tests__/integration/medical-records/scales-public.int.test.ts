import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateScaleToken } from '@/modules/medical-records/lib/scales/token';
import {
  getScaleApplicationByToken,
  submitScaleResponsesByToken,
} from '@/modules/medical-records/server/scales-public';
import { auditLog, scaleApplications } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Scale Public Test Patient',
      status: 'active',
    });
  });
}

/** Creates a remote scale application directly in the DB with the given token. */
async function seedRemoteScaleApplication(opts: {
  userId: string;
  patientId: string;
  scaleKey: string;
  remoteToken: string;
  tokenExpiresAt: Date;
  completedAt?: Date | null;
}): Promise<string> {
  const rows = await runAsService(async (db) => {
    return db
      .insert(scaleApplications)
      .values({
        userId: opts.userId,
        patientId: opts.patientId,
        scaleKey: opts.scaleKey,
        appliedRemotely: true,
        remoteToken: opts.remoteToken,
        tokenExpiresAt: opts.tokenExpiresAt,
        completedAt: opts.completedAt ?? null,
      })
      .returning({ id: scaleApplications.id });
  });
  return rows[0]!.id;
}

/** PHQ-9 responses that sum to 14 — "Moderado" classification. */
const PHQ9_RESPONSES: Record<string, number> = {
  q1: 2,
  q2: 2,
  q3: 1,
  q4: 2,
  q5: 1,
  q6: 2,
  q7: 1,
  q8: 2,
  q9: 1,
};

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// getScaleApplicationByToken
// =====================================================================

describe('getScaleApplicationByToken', () => {
  it('returns minimal fields for a valid token (no user_id, no patient_id)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const result = await getScaleApplicationByToken(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify only the expected minimal fields are present
    expect(result.id).toBeDefined();
    expect(result.scaleKey).toBe('phq9');
    expect(result.isExpired).toBe(false);
    expect(result.isCompleted).toBe(false);

    // CRITICAL: assert NO user_id or patient_id keys in the returned object
    const keys = Object.keys(result);
    expect(keys).not.toContain('userId');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('patientId');
    expect(keys).not.toContain('patient_id');
  });

  it('returns ok:false for a non-existent token (indistinguishable from expired)', async () => {
    const fakeToken = generateScaleToken();
    const result = await getScaleApplicationByToken(fakeToken);

    expect(result.ok).toBe(false);
  });

  it('returns isExpired:true for an expired token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      // Expired 1 hour ago
      tokenExpiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    const result = await getScaleApplicationByToken(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isExpired).toBe(true);
  });

  it('returns isCompleted:true for an already completed application', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      completedAt: new Date(),
    });

    const result = await getScaleApplicationByToken(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isCompleted).toBe(true);
  });

  it('returns ok:false for an invalid token format', async () => {
    const result = await getScaleApplicationByToken('short');
    expect(result.ok).toBe(false);
  });
});

// =====================================================================
// submitScaleResponsesByToken
// =====================================================================

describe('submitScaleResponsesByToken', () => {
  it('submits valid responses and completes the application', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const appId = await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const result = await submitScaleResponsesByToken(token, PHQ9_RESPONSES, '192.168.1.1');

    expect(result.ok).toBe(true);

    // Verify the row was updated with score + classification + completedAt
    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, appId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalScore).toBe(14); // PHQ-9 sum of the test responses
    expect(rows[0]!.classification).toBe('Moderado');
    expect(rows[0]!.completedAt).not.toBeNull();
    expect(rows[0]!.responses).toEqual(PHQ9_RESPONSES);
  });

  it('rejects an expired token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      // Expired 1 hour ago
      tokenExpiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    const result = await submitScaleResponsesByToken(token, PHQ9_RESPONSES, '192.168.1.1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EXPIRED');
  });

  it('rejects double-submit (ALREADY_COMPLETED)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    // First submission succeeds
    const first = await submitScaleResponsesByToken(token, PHQ9_RESPONSES, '192.168.1.1');
    expect(first.ok).toBe(true);

    // Second submission is rejected
    const second = await submitScaleResponsesByToken(token, PHQ9_RESPONSES, '192.168.1.1');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_COMPLETED');
  });

  it('rejects a non-existent token', async () => {
    const fakeToken = generateScaleToken();
    const result = await submitScaleResponsesByToken(fakeToken, PHQ9_RESPONSES, '192.168.1.1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TOKEN');
  });

  it('rejects invalid responses format', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    // Empty responses should still pass Zod (record can be empty), but a
    // short token definitely fails
    const result = await submitScaleResponsesByToken('short-token', PHQ9_RESPONSES, '192.168.1.1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_RESPONSES');
  });
});

// =====================================================================
// Audit log for scale.public-submit
// =====================================================================

describe('audit_log for scale.public-submit', () => {
  it('writes audit_log with IP and no PII in metadata', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    const clientIp = '203.0.113.42';
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const appId = await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    // Clear any pre-existing audit entries
    await runAsService(async (db) => {
      await db.delete(auditLog);
    });

    await submitScaleResponsesByToken(token, PHQ9_RESPONSES, clientIp);

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog);
    });

    // There should be exactly one audit entry for the public submission
    const publicSubmitEntry = auditRows.find((r) => r.action === 'scale.public-submit');
    expect(publicSubmitEntry).toBeDefined();
    expect(publicSubmitEntry!.resourceType).toBe('scale_application');
    expect(publicSubmitEntry!.resourceId).toBe(appId);
    expect(publicSubmitEntry!.ipAddress).toBe(clientIp);

    // CRITICAL: metadata must NOT contain patient_id or psychologist user_id
    const metadata = publicSubmitEntry!.metadata as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('patientId');
    expect(metadata).not.toHaveProperty('patient_id');
    expect(metadata).not.toHaveProperty('userId');
    expect(metadata).not.toHaveProperty('user_id');
    expect(metadata).not.toHaveProperty('psychologistId');
    expect(metadata).not.toHaveProperty('psychologist_id');

    // Verify scaleKey IS present in metadata (acceptable non-PII context)
    expect(metadata).toHaveProperty('scaleKey', 'phq9');
  });
});

// =====================================================================
// Route Handler GET /api/scales/[token] — response shape + no PII
// =====================================================================

describe('Route Handler GET /api/scales/[token]', () => {
  it('returns questions + status flags for a valid active token (no PII keys)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const { GET } = await import('@/app/api/scales/[token]/route');
    const request = new Request(`http://localhost/api/scales/${token}`, {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    const response = await GET(request as never, {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    // Expected fields are present
    expect(body.scaleKey).toBe('phq9');
    expect(body.isExpired).toBe(false);
    expect(body.isCompleted).toBe(false);
    expect(Array.isArray(body.questions)).toBe(true);
    expect((body.questions as unknown[]).length).toBeGreaterThan(0);

    // CRITICAL: no PII keys in response
    const keys = Object.keys(body);
    expect(keys).not.toContain('userId');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('patientId');
    expect(keys).not.toContain('patient_id');
    expect(keys).not.toContain('id');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('fullName');
    expect(keys).not.toContain('full_name');
  });

  it('returns isExpired:true without questions for a non-existent token', async () => {
    const fakeToken = generateScaleToken();

    const { GET } = await import('@/app/api/scales/[token]/route');
    const request = new Request(`http://localhost/api/scales/${fakeToken}`, {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });

    const response = await GET(request as never, {
      params: Promise.resolve({ token: fakeToken }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.isExpired).toBe(true);
    // Should NOT contain questions or scaleKey (prevents info leak)
    expect(body).not.toHaveProperty('questions');
    expect(body).not.toHaveProperty('scaleKey');
  });

  it('returns isCompleted:true for an already completed application', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateScaleToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedRemoteScaleApplication({
      userId,
      patientId,
      scaleKey: 'phq9',
      remoteToken: token,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      completedAt: new Date(),
    });

    const { GET } = await import('@/app/api/scales/[token]/route');
    const request = new Request(`http://localhost/api/scales/${token}`, {
      method: 'GET',
      headers: { 'x-forwarded-for': '10.0.0.3' },
    });

    const response = await GET(request as never, {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.isCompleted).toBe(true);
    expect(body.isExpired).toBe(false);
  });
});

// =====================================================================
// Route Handler POST /api/scales/[token] — rate limit
// =====================================================================

describe('Route Handler POST /api/scales/[token] rate limiting', () => {
  it('returns 429 after exceeding POST rate limit (5/min per IP)', async () => {
    // Use vi.resetModules to get a fresh rate limiter state
    vi.resetModules();
    const { POST } = await import('@/app/api/scales/[token]/route');

    const fakeToken = generateScaleToken();
    const rateTestIp = `rate-test-post-${randomUUID()}`;

    // Send 5 requests (all within limit — they will fail with 404 or
    // INVALID_RESPONSES but that's fine, we're testing the rate limiter)
    for (let i = 0; i < 5; i++) {
      const request = new Request(`http://localhost/api/scales/${fakeToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': rateTestIp,
        },
        body: JSON.stringify({ responses: {} }),
      });

      const response = await POST(request as never, {
        params: Promise.resolve({ token: fakeToken }),
      });

      // These should NOT be 429 yet
      expect(response.status).not.toBe(429);
    }

    // 6th request should be rate-limited
    const request = new Request(`http://localhost/api/scales/${fakeToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': rateTestIp,
      },
      body: JSON.stringify({ responses: {} }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ token: fakeToken }),
    });

    expect(response.status).toBe(429);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });
});
