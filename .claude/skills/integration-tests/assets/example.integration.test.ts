// Skeleton for a Server Action against the real DB, with RLS and external boundary mocked.
// Copy and adapt: swap the module under test, factories and assertions.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/__tests__/integration/setup/db';
import {
  runAsUser,
  runAsService,
  truncateAll,
} from '@/__tests__/integration/setup/rls';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';
import { createPaciente } from '@/__tests__/integration/factories/paciente';
import { agendamentos } from '@/shared/db/schema';
import { agendarConsulta } from '@/modules/agenda/server/agendar-consulta';

vi.mock('@/shared/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['evt_1'] }) },
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { inngest } from '@/shared/lib/inngest/client';
import { revalidatePath } from 'next/cache';

describe('agendarConsulta — integration', () => {
  beforeEach(() => truncateAll(db));

  it('creates appointment, dispatches event and revalidates agenda', async () => {
    const dr = await createPsicologo();
    const paciente = await createPaciente({ psicologoId: dr.id });

    const resultado = await runAsUser(dr.id, () =>
      agendarConsulta({
        pacienteId: paciente.id,
        horario: '2026-06-01T14:00:00-03:00',
      })
    );

    expect(resultado).toMatchObject({ ok: true });

    const persistido = await runAsService((admin) =>
      admin.select().from(agendamentos).where(eq(agendamentos.id, resultado.id))
    );
    expect(persistido).toHaveLength(1);
    expect(persistido[0]).toMatchObject({
      pacienteId: paciente.id,
      psicologoId: dr.id,
      status: 'agendado',
    });

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agenda/lembrete.agendar' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/agenda');
  });

  it('another psychologist cannot schedule for someone else\'s patient (RLS)', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();
    const pacienteDeA = await createPaciente({ psicologoId: dr_a.id });

    await expect(
      runAsUser(dr_b.id, () =>
        agendarConsulta({
          pacienteId: pacienteDeA.id,
          horario: '2026-06-01T14:00:00-03:00',
        })
      )
    ).rejects.toThrow(/paciente não encontrado|row-level security/i);
  });
});
