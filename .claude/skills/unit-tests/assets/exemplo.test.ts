// Esqueleto AAA para Server Action / função com dependências mockadas.
// Copie e adapte: renomeie módulo sob teste, dependências mockadas e cenários.
//
// Localização canônica: src/__tests__/unit/<mirror-of-source-path>.test.ts
// Exemplo: src/__tests__/unit/modules/agenda/server/agendar-consulta.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1) Hoisted mocks — declarar ANTES de qualquer import do módulo sob teste.
vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@/shared/lib/inngest/client', () => ({
  inngest: { send: vi.fn() },
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// 2) Imports reais — vêm depois dos vi.mock por convenção.
import { createServerClient } from '@/shared/supabase/server';
import { inngest } from '@/shared/lib/inngest/client';
import { revalidatePath } from 'next/cache';
import { funcaoSobTeste } from '@/modules/agenda/server/agendar-consulta';

describe('funcaoSobTeste', () => {
  beforeEach(() => {
    // Arrange compartilhado: estado padrão de dependências para o caminho feliz.
    vi.mocked(createServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: { id: 'x_1' }, error: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u_1' } },
          error: null,
        }),
      },
    } as never);
  });

  it('descreve o comportamento esperado no caminho feliz', async () => {
    // Arrange (extra ao beforeEach, se necessário)
    const input = { campo: 'valor' };

    // Act
    const resultado = await funcaoSobTeste(input);

    // Assert
    expect(resultado).toEqual({ ok: true, id: 'x_1' });
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dominio/evento.disparado' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/rota-relevante');
  });

  it('rejeita entrada inválida com mensagem acionável', async () => {
    await expect(funcaoSobTeste({ campo: '' })).rejects.toThrow(
      /campo.*obrigatório/i
    );
  });

  it('propaga erro quando dependência externa falha', async () => {
    vi.mocked(createServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'duplicate key' },
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u_1' } },
          error: null,
        }),
      },
    } as never);

    await expect(funcaoSobTeste({ campo: 'ok' })).rejects.toThrow(/duplicate/);
  });
});
