import { describe, expect, it } from 'vitest';

import { templateInputSchema } from '@/modules/whatsapp/lib/template-input-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validPayload = {
  body: 'Olá {nome_paciente}, sua sessão é às {hora} de {dia_semana}.',
  template_key: 'lembrete_24h' as const,
};

// ---------------------------------------------------------------------------
// Valid payloads
// ---------------------------------------------------------------------------

describe('templateInputSchema — valid payloads', () => {
  it('accepts a body with known variables', () => {
    const result = templateInputSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a body without any variables (plain text)', () => {
    const result = templateInputSchema.safeParse({
      body: 'Mensagem simples sem variáveis nenhuma.',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a body with duplicate variables ({nome_paciente} twice)', () => {
    const result = templateInputSchema.safeParse({
      body: 'Olá {nome_paciente}, confirmamos sua sessão, {nome_paciente}.',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid template keys', () => {
    const keys = [
      'lembrete_24h',
      'lembrete_2h',
      'cancelamento_aviso',
      'link_video',
      'termo_consentimento',
    ] as const;

    for (const key of keys) {
      const result = templateInputSchema.safeParse({
        body: 'Uma mensagem válida com pelo menos 10 caracteres.',
        template_key: key,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects the removed confirmacao_recebida key', () => {
    const result = templateInputSchema.safeParse({
      body: 'Uma mensagem válida com pelo menos 10 caracteres.',
      template_key: 'confirmacao_recebida',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalid body — length constraints
// ---------------------------------------------------------------------------

describe('templateInputSchema — body length', () => {
  it('rejects a body that is too short (9 characters)', () => {
    const result = templateInputSchema.safeParse({
      body: '123456789',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const bodyErrors = result.error.flatten().fieldErrors.body;
    expect(bodyErrors).toBeDefined();
    expect(bodyErrors).toContain('O corpo do template deve ter pelo menos 10 caracteres.');
  });

  it('accepts a body with exactly 10 characters', () => {
    const result = templateInputSchema.safeParse({
      body: '1234567890',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a body that is too long (1025 characters)', () => {
    const result = templateInputSchema.safeParse({
      body: 'a'.repeat(1025),
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const bodyErrors = result.error.flatten().fieldErrors.body;
    expect(bodyErrors).toBeDefined();
    expect(bodyErrors).toContain('O corpo do template deve ter no máximo 1024 caracteres.');
  });

  it('accepts a body with exactly 1024 characters', () => {
    const result = templateInputSchema.safeParse({
      body: 'a'.repeat(1024),
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid body — unknown variables
// ---------------------------------------------------------------------------

describe('templateInputSchema — unknown variables', () => {
  it('rejects a body with an unknown variable ({nome_pet})', () => {
    const result = templateInputSchema.safeParse({
      body: 'Olá {nome_paciente}, seu pet {nome_pet} está lindo.',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const bodyErrors = result.error.flatten().fieldErrors.body;
    expect(bodyErrors).toBeDefined();
    expect(bodyErrors).toContain('Variável {nome_pet} não reconhecida.');
  });

  it('rejects a body with multiple unknown variables and reports each', () => {
    const result = templateInputSchema.safeParse({
      body: 'Oi {nome_pet}, seu dono é {dono_pet} e tudo mais.',
      template_key: 'lembrete_24h',
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const bodyErrors = result.error.flatten().fieldErrors.body ?? [];
    expect(bodyErrors).toContain('Variável {nome_pet} não reconhecida.');
    expect(bodyErrors).toContain('Variável {dono_pet} não reconhecida.');
  });
});

// ---------------------------------------------------------------------------
// Invalid template_key
// ---------------------------------------------------------------------------

describe('templateInputSchema — invalid template_key', () => {
  it('rejects an invalid template_key', () => {
    const result = templateInputSchema.safeParse({
      body: 'Uma mensagem válida com pelo menos 10 caracteres.',
      template_key: 'invalido',
    });
    expect(result.success).toBe(false);
  });
});
