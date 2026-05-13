import { describe, expect, it } from 'vitest';

import {
  MissingTemplateVariableError,
  renderTemplate,
} from '@/modules/whatsapp/lib/render-template';

// ---------------------------------------------------------------------------
// Successful substitution
// ---------------------------------------------------------------------------

describe('renderTemplate — substitution', () => {
  it('replaces all variables correctly', () => {
    const result = renderTemplate({
      body: 'Olá {nome_paciente}, sua sessão com {nome_psicologo} é às {hora}.',
      vars: {
        nome_paciente: 'Maria',
        nome_psicologo: 'Dra. Ana',
        hora: '14:00',
      },
    });
    expect(result).toBe('Olá Maria, sua sessão com Dra. Ana é às 14:00.');
  });

  it('replaces multiple occurrences of the same variable', () => {
    const result = renderTemplate({
      body: '{nome_paciente} chegou. Bem-vinda, {nome_paciente}!',
      vars: { nome_paciente: 'Maria' },
    });
    expect(result).toBe('Maria chegou. Bem-vinda, Maria!');
  });

  it('returns body unchanged when it contains no variables', () => {
    const body = 'Mensagem simples sem variáveis.';
    const result = renderTemplate({ body, vars: {} });
    expect(result).toBe(body);
  });

  it('returns empty string when body is empty', () => {
    const result = renderTemplate({ body: '', vars: {} });
    expect(result).toBe('');
  });

  it('silently ignores extra variables in vars that are not in the body', () => {
    const result = renderTemplate({
      body: 'Olá {nome_paciente}.',
      vars: {
        nome_paciente: 'Maria',
        hora: '14:00',
        valor: 'R$ 200,00',
      },
    });
    expect(result).toBe('Olá Maria.');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — position and idempotency
// ---------------------------------------------------------------------------

describe('renderTemplate — edge cases', () => {
  it('handles variable at the very beginning of the body', () => {
    const result = renderTemplate({
      body: '{nome_paciente} confirmou.',
      vars: { nome_paciente: 'Maria' },
    });
    expect(result).toBe('Maria confirmou.');
  });

  it('handles variable at the very end of the body', () => {
    const result = renderTemplate({
      body: 'Sessão às {hora}',
      vars: { hora: '14:00' },
    });
    expect(result).toBe('Sessão às 14:00');
  });

  it('does not re-substitute when a value contains literal braces (idempotency)', () => {
    const result = renderTemplate({
      body: 'Instrução: {instrucao_chegada}',
      vars: { instrucao_chegada: 'Digite {nome_paciente} no interfone' },
    });
    // The literal {nome_paciente} inside the value must NOT be replaced
    expect(result).toBe('Instrução: Digite {nome_paciente} no interfone');
  });

  it('handles adjacent variables without separator', () => {
    const result = renderTemplate({
      body: '{nome_paciente}{hora}',
      vars: { nome_paciente: 'Maria', hora: '14:00' },
    });
    expect(result).toBe('Maria14:00');
  });
});

// ---------------------------------------------------------------------------
// Missing variables — error behavior
// ---------------------------------------------------------------------------

describe('renderTemplate — missing variables', () => {
  it('throws MissingTemplateVariableError when a variable is missing', () => {
    expect(() =>
      renderTemplate({
        body: 'Olá {nome_paciente}, sessão às {hora}.',
        vars: { nome_paciente: 'Maria' },
      }),
    ).toThrow(MissingTemplateVariableError);
  });

  it('includes the missing variable name in the error', () => {
    try {
      renderTemplate({
        body: 'Sessão às {hora}.',
        vars: {},
      });
      // Should not reach here
      expect.fail('Expected MissingTemplateVariableError');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTemplateVariableError);
      expect((error as MissingTemplateVariableError).variableName).toBe('hora');
      expect((error as MissingTemplateVariableError).message).toBe(
        'Missing template variable: {hora}',
      );
    }
  });

  it('throws on the first missing variable when multiple are missing', () => {
    expect(() =>
      renderTemplate({
        body: '{nome_paciente} às {hora} em {data}.',
        vars: {},
      }),
    ).toThrow(MissingTemplateVariableError);
  });
});
