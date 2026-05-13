import { describe, expect, it } from 'vitest';

import {
  getVariableByKey,
  TEMPLATE_VARIABLES,
} from '@/modules/whatsapp/lib/template-variables';

// ---------------------------------------------------------------------------
// Dictionary completeness
// ---------------------------------------------------------------------------

describe('TEMPLATE_VARIABLES — dictionary', () => {
  it('contains exactly 12 variables', () => {
    expect(TEMPLATE_VARIABLES).toHaveLength(12);
  });

  it('every variable has key, label, example, and applicableTemplates', () => {
    for (const variable of TEMPLATE_VARIABLES) {
      expect(variable.key).toBeTruthy();
      expect(typeof variable.key).toBe('string');

      expect(variable.label).toBeTruthy();
      expect(typeof variable.label).toBe('string');

      expect(variable.example).toBeTruthy();
      expect(typeof variable.example).toBe('string');

      expect(Array.isArray(variable.applicableTemplates)).toBe(true);
      expect(variable.applicableTemplates.length).toBeGreaterThan(0);
    }
  });

  it('has unique keys (no duplicates)', () => {
    const keys = TEMPLATE_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains the expected set of variable keys', () => {
    const keys = TEMPLATE_VARIABLES.map((v) => v.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'nome_paciente',
        'nome_completo',
        'nome_psicologo',
        'data',
        'dia_semana',
        'hora',
        'duracao_min',
        'endereco',
        'instrucao_chegada',
        'link_confirmacao',
        'link_video',
        'valor',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// getVariableByKey
// ---------------------------------------------------------------------------

describe('getVariableByKey', () => {
  it('returns the correct variable for a valid key', () => {
    const result = getVariableByKey('nome_paciente');
    expect(result).toBeDefined();
    expect(result!.key).toBe('nome_paciente');
    expect(result!.label).toBe('Nome do paciente');
    expect(result!.example).toBe('Maria');
  });

  it('returns undefined for an invalid key', () => {
    const result = getVariableByKey('nonexistent_variable');
    expect(result).toBeUndefined();
  });

  it('returns the correct variable for every known key', () => {
    for (const variable of TEMPLATE_VARIABLES) {
      const result = getVariableByKey(variable.key);
      expect(result).toStrictEqual(variable);
    }
  });
});
