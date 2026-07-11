import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

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
      fullName: 'Paciente Teste',
      phone: `+551198888${Math.floor(1000 + Math.random() * 8999)}`,
    });
  });
}

interface MessageSeed {
  body: string | null;
  templateKey?: string | null;
  createdAt?: Date;
}

async function seedMessage(userId: string, patientId: string, opts: MessageSeed): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id,
      userId,
      patientId,
      direction: 'outbound',
      status: 'sent',
      body: opts.body,
      templateKey: opts.templateKey ?? null,
      createdAt: opts.createdAt ?? new Date(),
    });
  });
  return id;
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

// ISO yyyy-MM-dd range wide enough to always contain "now".
const DATE_RANGE = { from: '2000-01-01', to: '2100-12-31' };

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchMessageHistoryImpl — body IS NULL template sends', () => {
  it('does not error when template-send rows have body=null and returns them', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Template sends store body=null (design D7).
    await seedMessage(userId, patientId, { body: null, templateKey: 'lembrete_24h' });
    await seedMessage(userId, patientId, { body: null, templateKey: 'confirmacao_recebida' });
    // A free-form reply with body text.
    await seedMessage(userId, patientId, { body: 'Confirmado, obrigada', templateKey: null });

    const { searchMessageHistoryImpl } =
      await import('@/modules/whatsapp/server/inbox/search-message-history');

    // No query string — the FTS `coalesce(body,'')` branch is skipped, but the
    // rows with body=null must still be returned without erroring.
    const result = await searchMessageHistoryImpl(fakeSupabase(userId), {
      dateRange: DATE_RANGE,
      page: 1,
      pageSize: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it('runs the FTS query without error on body=null rows and does not match template sends by content', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Template send: body=null. Its label ("Lembrete 24h") lives only in the
    // UI layer — it is NOT stored, so a content search must never match it.
    await seedMessage(userId, patientId, { body: null, templateKey: 'lembrete_24h' });
    // Free-form reply carrying the searchable word.
    await seedMessage(userId, patientId, {
      body: 'Preciso remarcar a consulta',
      templateKey: null,
    });

    const { searchMessageHistoryImpl } =
      await import('@/modules/whatsapp/server/inbox/search-message-history');

    // Searching for the free-form word returns only the free-form row —
    // `coalesce(body,'')` guards the body=null template row from erroring.
    const freeFormHit = await searchMessageHistoryImpl(fakeSupabase(userId), {
      query: 'remarcar',
      dateRange: DATE_RANGE,
      page: 1,
      pageSize: 20,
    });

    expect(freeFormHit.ok).toBe(true);
    if (!freeFormHit.ok) return;
    expect(freeFormHit.total).toBe(1);
    expect(freeFormHit.results[0]?.message.templateKey).toBeNull();

    // Searching for the template label text matches nothing — template sends
    // are not searchable by their rendered content (accepted tradeoff).
    const labelMiss = await searchMessageHistoryImpl(fakeSupabase(userId), {
      query: 'lembrete',
      dateRange: DATE_RANGE,
      page: 1,
      pageSize: 20,
    });

    expect(labelMiss.ok).toBe(true);
    if (!labelMiss.ok) return;
    expect(labelMiss.total).toBe(0);
    expect(labelMiss.results).toHaveLength(0);
  });
});
