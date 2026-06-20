import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPersonalNotesImpl,
  upsertPersonalNotesImpl,
} from '@/modules/medical-records/server/personal-notes';
import { personalNotes } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Manual "Salvar" button on the Notas Pessoais editor — integration coverage.
//
// The manual save button is rendered ONLY in the unlocked editor view and
// reuses `upsertPersonalNotesImpl` (the same action auto-save calls). These
// tests assert that a manual save persists an unlocked note under the owner's
// session, and is denied for a non-owner psychologist.
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
      fullName: 'Test Patient',
      status: 'active',
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof upsertPersonalNotesImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

describe('manual save — Notas Pessoais', () => {
  it('persists an unlocked note via upsertPersonalNotes under the owner session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const supabase = fakeSupabaseClient(userId);

    // Manual "Salvar" click on the unlocked notes editor.
    const result = await upsertPersonalNotesImpl(supabase, {
      patientId,
      content: '<p>Nota salva manualmente</p>',
    });
    expect(result).toEqual({ ok: true });

    // Owner sees the persisted note (no password set → unlocked, content visible).
    const read = await getPersonalNotesImpl(supabase, { patientId });
    expect(read).toMatchObject({
      ok: true,
      content: '<p>Nota salva manualmente</p>',
      hasPassword: false,
      isLocked: false,
    });

    // Persisted row is owned by the session user.
    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(personalNotes).where(eq(personalNotes.patientId, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.content).toBe('<p>Nota salva manualmente</p>');
  });

  it('denies a manual save for a non-owner psychologist and writes nothing', async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(owner);
    await seedAuthUser(attacker);
    await seedPatient(owner, patientId);

    // Attacker triggers a manual save on the owner's patient notes.
    const result = await upsertPersonalNotesImpl(fakeSupabaseClient(attacker), {
      patientId,
      content: '<p>Injetado</p>',
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });

    // No note row was created.
    const rows = await runAsService(async (db) => {
      return db.select().from(personalNotes).where(eq(personalNotes.patientId, patientId));
    });
    expect(rows).toHaveLength(0);
  });
});
