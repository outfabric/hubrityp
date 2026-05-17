// AAA skeleton for Server Action / function with mocked dependencies.
// Copy and adapt: rename the module under test, mocked dependencies, and scenarios.
//
// Canonical location: src/__tests__/unit/<mirror-of-source-path>.test.ts
// Example: src/__tests__/unit/modules/agenda/server/agendar-consulta.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1) Hoisted mocks — declare BEFORE any import of the module under test.
vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));
vi.mock('@/shared/lib/inngest/client', () => ({
  inngest: { send: vi.fn() },
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// 2) Real imports — come after vi.mock by convention.
import { createServerClient } from '@/shared/supabase/server';
import { inngest } from '@/shared/lib/inngest/client';
import { revalidatePath } from 'next/cache';
import { funcaoSobTeste } from '@/modules/agenda/server/agendar-consulta';

describe('funcaoSobTeste', () => {
  beforeEach(() => {
    // Shared Arrange: default state of dependencies for the happy path.
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

  it('describes the expected behavior on the happy path', async () => {
    // Arrange (extra to beforeEach, if needed)
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

  it('rejects invalid input with actionable message', async () => {
    await expect(funcaoSobTeste({ campo: '' })).rejects.toThrow(
      /campo.*obrigatório/i
    );
  });

  it('propagates error when external dependency fails', async () => {
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
