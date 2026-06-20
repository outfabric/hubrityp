import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createEvolutionImpl } from '@/modules/medical-records/server/create-evolution';
import { updateEvolutionImpl } from '@/modules/medical-records/server/update-evolution';
import { evolutions, evolutionVersions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Manual "Salvar" button on the Evoluções editor — integration coverage.
//
// The manual save button reuses the SAME server actions auto-save calls
// (`createEvolutionImpl` / `updateEvolutionImpl`). These tests assert that a
// manual save persists evolution content against a real Postgres + RLS, under
// the resource owner's session, exactly as the button triggers it.
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
      fullName: 'Patient Test',
      status: 'active',
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createEvolutionImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

describe('manual save — Evoluções', () => {
  it('persists evolution content via createEvolution under the owner session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Simulates the manual "Salvar" click on a brand-new evolution.
    const result = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Conteúdo salvo manualmente' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The owner sees the persisted row through their own RLS context.
    const ownerRows = await runAsUser(userId, async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, result.id));
    });
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]!.content).toEqual({ conteudo: 'Conteúdo salvo manualmente' });
    expect(ownerRows[0]!.currentVersion).toBe(1);
  });

  it('persists an updated content + new version via updateEvolution on a manual save', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const created = await createEvolutionImpl(fakeSupabaseClient(userId), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Rascunho inicial' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Manual "Salvar" of an edited evolution (within the edit window).
    const updated = await updateEvolutionImpl(fakeSupabaseClient(userId), {
      evolutionId: created.id,
      content: { conteudo: 'Conteúdo editado e salvo manualmente' },
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.version).toBe(2);
    expect(updated.isAddendum).toBe(false);

    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, created.id));
    });
    expect(evoRows[0]!.content).toEqual({ conteudo: 'Conteúdo editado e salvo manualmente' });
    expect(evoRows[0]!.currentVersion).toBe(2);

    const verRows = await runAsService(async (db) => {
      return db
        .select()
        .from(evolutionVersions)
        .where(eq(evolutionVersions.evolutionId, created.id));
    });
    expect(verRows).toHaveLength(2);
  });

  it('denies a manual save against another psychologist evolution (RLS / ownership)', async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(owner);
    await seedAuthUser(attacker);
    await seedPatient(owner, patientId);

    const created = await createEvolutionImpl(fakeSupabaseClient(owner), {
      patientId,
      templateType: 'livre',
      content: { conteudo: 'Conteúdo do dono' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Attacker triggers a manual save on the owner's evolution.
    const hijack = await updateEvolutionImpl(fakeSupabaseClient(attacker), {
      evolutionId: created.id,
      content: { conteudo: 'Sequestrado' },
    });

    expect(hijack.ok).toBe(false);
    if (hijack.ok) return;
    expect(hijack.code).toBe('NOT_FOUND');

    // Original content is untouched.
    const evoRows = await runAsService(async (db) => {
      return db.select().from(evolutions).where(eq(evolutions.id, created.id));
    });
    expect(evoRows[0]!.content).toEqual({ conteudo: 'Conteúdo do dono' });
  });
});
