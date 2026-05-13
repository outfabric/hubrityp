import { describe, expect, it } from 'vitest';

import { templateKeySchema } from '@/modules/whatsapp/lib/template-key-schema';

// ---------------------------------------------------------------------------
// Valid keys
// ---------------------------------------------------------------------------

describe('templateKeySchema — valid keys', () => {
  const validKeys = [
    'lembrete_24h',
    'lembrete_2h',
    'confirmacao_recebida',
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
  it.each([
    ['invalido'],
    [''],
    ['lembrete_48h'],
  ])('rejects "%s"', (key) => {
    const result = templateKeySchema.safeParse(key);
    expect(result.success).toBe(false);
  });

  it('provides a pt-BR error message for invalid key', () => {
    const result = templateKeySchema.safeParse('invalido');
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = result.error.issues[0]?.message;
    expect(message).toBe('Tipo de template inválido.');
  });
});
