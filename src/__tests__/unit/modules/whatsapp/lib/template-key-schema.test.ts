import { describe, expect, it } from 'vitest';

import { templateKeySchema } from '@/modules/whatsapp/lib/template-key-schema';

// ---------------------------------------------------------------------------
// Valid keys
// ---------------------------------------------------------------------------

describe('templateKeySchema — valid keys', () => {
  const validKeys = [
    'lembrete_24h',
    'lembrete_2h',
    'cancelamento_aviso',
    'link_video',
    'termo_consentimento',
  ] as const;

  it.each(validKeys)('accepts "%s"', (key) => {
    const result = templateKeySchema.safeParse(key);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid keys
// ---------------------------------------------------------------------------

describe('templateKeySchema — invalid keys', () => {
  // `confirmacao_recebida` was removed from the enum (Option B): the confirmation
  // ack is now a free-form message, not a template type. It must be rejected.
  it.each([['invalido'], [''], ['lembrete_48h'], ['confirmacao_recebida']])(
    'rejects "%s"',
    (key) => {
      const result = templateKeySchema.safeParse(key);
      expect(result.success).toBe(false);
    },
  );

  it('provides a pt-BR error message for invalid key', () => {
    const result = templateKeySchema.safeParse('invalido');
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = result.error.issues[0]?.message;
    expect(message).toBe('Tipo de template inválido.');
  });
});
