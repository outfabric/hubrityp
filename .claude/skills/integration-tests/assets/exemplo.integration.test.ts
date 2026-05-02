// Esqueleto para Server Action contra DB real, com RLS e fronteira externa mockada.
// Copie e adapte: troque o módulo sob teste, factories e asserções.

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
import { agendamentos } from '@/lib/db/schema';
import { agendarConsulta } from './actions';

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['evt_1'] }) },
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { inngest } from '@/lib/inngest/client';
import { revalidatePath } from 'next/cache';

describe('agendarConsulta — integração', () => {
  beforeEach(() => truncateAll(db));

  it('cria agendamento, dispara evento e revalida agenda', async () => {
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

  it('outro psicólogo não consegue agendar para paciente alheio (RLS)', async () => {
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
