import { describe, expect, it } from 'vitest';

import {
  detectColumnMapping,
  normalizeHeader,
  PATIENT_FIELDS,
} from '@/modules/patients/lib/csv-column-mapping';

// ---------------------------------------------------------------------------
// normalizeHeader
// ---------------------------------------------------------------------------

describe('normalizeHeader', () => {
  it('trims whitespace', () => {
    expect(normalizeHeader('  nome  ')).toBe('nome');
  });

  it('lowercases', () => {
    expect(normalizeHeader('NOME')).toBe('nome');
  });

  it('strips combining diacritical marks (accents)', () => {
    expect(normalizeHeader('Observação')).toBe('observacao');
    expect(normalizeHeader('Anotações')).toBe('anotacoes');
  });

  it('handles mixed case + accents + whitespace', () => {
    expect(normalizeHeader(' Observação ')).toBe('observacao');
  });

  it('preserves hyphens and underscores', () => {
    expect(normalizeHeader('e-mail')).toBe('e-mail');
    expect(normalizeHeader('data_nascimento')).toBe('data_nascimento');
  });
});

// ---------------------------------------------------------------------------
// detectColumnMapping — auto-mapping common PT-BR headers
// ---------------------------------------------------------------------------

describe('detectColumnMapping', () => {
  it('maps standard PT-BR headers correctly', () => {
    const headers = ['nome', 'telefone', 'email', 'data_nascimento', 'tags', 'observacao'];
    const result = detectColumnMapping(headers);

    expect(result.mapped).toEqual({
      nome: 'full_name',
      telefone: 'phone',
      email: 'email',
      data_nascimento: 'birth_date',
      tags: 'tags',
      observacao: 'notes',
    });
    expect(result.unmapped).toEqual([]);
  });

  it('maps accented headers (Observação → notes)', () => {
    const result = detectColumnMapping(['Observação']);
    expect(result.mapped).toEqual({ Observação: 'notes' });
    expect(result.unmapped).toEqual([]);
  });

  it('maps "Nome Completo" to full_name', () => {
    const result = detectColumnMapping(['Nome Completo']);
    expect(result.mapped).toEqual({ 'Nome Completo': 'full_name' });
  });

  it('maps EN headers (name, phone, birth date, notes)', () => {
    const result = detectColumnMapping(['name', 'phone', 'birth date', 'notes']);
    expect(result.mapped).toEqual({
      name: 'full_name',
      phone: 'phone',
      'birth date': 'birth_date',
      notes: 'notes',
    });
    expect(result.unmapped).toEqual([]);
  });

  it('maps "celular" and "whatsapp" to phone', () => {
    const resultCelular = detectColumnMapping(['celular']);
    expect(resultCelular.mapped).toEqual({ celular: 'phone' });

    const resultWhatsapp = detectColumnMapping(['whatsapp']);
    expect(resultWhatsapp.mapped).toEqual({ whatsapp: 'phone' });
  });

  it('maps "e-mail" (hyphenated) to email', () => {
    const result = detectColumnMapping(['e-mail']);
    expect(result.mapped).toEqual({ 'e-mail': 'email' });
  });

  it('maps "nascimento" to birth_date', () => {
    const result = detectColumnMapping(['nascimento']);
    expect(result.mapped).toEqual({ nascimento: 'birth_date' });
  });

  it('maps "paciente" to full_name', () => {
    const result = detectColumnMapping(['paciente']);
    expect(result.mapped).toEqual({ paciente: 'full_name' });
  });

  it('maps case-insensitive headers (NOME, Telefone, EMAIL)', () => {
    const result = detectColumnMapping(['NOME', 'Telefone', 'EMAIL']);
    expect(result.mapped).toEqual({
      NOME: 'full_name',
      Telefone: 'phone',
      EMAIL: 'email',
    });
    expect(result.unmapped).toEqual([]);
  });

  // ---- Unknown / unmapped headers ----

  it('puts unknown headers in unmapped', () => {
    const headers = ['nome', 'cpf', 'endereco'];
    const result = detectColumnMapping(headers);

    expect(result.mapped).toEqual({ nome: 'full_name' });
    expect(result.unmapped).toEqual(['cpf', 'endereco']);
  });

  it('returns all headers as unmapped when none match', () => {
    const headers = ['campo1', 'campo2', 'campo3'];
    const result = detectColumnMapping(headers);

    expect(result.mapped).toEqual({});
    expect(result.unmapped).toEqual(['campo1', 'campo2', 'campo3']);
  });

  it('handles empty headers array', () => {
    const result = detectColumnMapping([]);
    expect(result.mapped).toEqual({});
    expect(result.unmapped).toEqual([]);
  });

  // ---- Duplicate field resolution ----

  it('first header wins when two headers map to the same field', () => {
    // Both "nome" and "paciente" map to full_name — first one wins
    const headers = ['nome', 'paciente', 'telefone'];
    const result = detectColumnMapping(headers);

    expect(result.mapped).toEqual({
      nome: 'full_name',
      telefone: 'phone',
    });
    expect(result.unmapped).toEqual(['paciente']);
  });

  it('does not map duplicate phone aliases (telefone + celular)', () => {
    const headers = ['telefone', 'celular'];
    const result = detectColumnMapping(headers);

    expect(result.mapped).toEqual({ telefone: 'phone' });
    expect(result.unmapped).toEqual(['celular']);
  });

  // ---- Whitespace / accent resilience ----

  it('trims and normalizes headers with leading/trailing spaces', () => {
    const result = detectColumnMapping(['  nome  ', ' telefone ']);
    expect(result.mapped).toEqual({
      '  nome  ': 'full_name',
      ' telefone ': 'phone',
    });
  });

  it('strips accents for matching (Anotações → notes)', () => {
    const result = detectColumnMapping(['Anotações']);
    expect(result.mapped).toEqual({ Anotações: 'notes' });
  });
});

// ---------------------------------------------------------------------------
// PATIENT_FIELDS constant
// ---------------------------------------------------------------------------

describe('PATIENT_FIELDS', () => {
  it('contains the expected set of fields', () => {
    expect(PATIENT_FIELDS).toEqual(['full_name', 'phone', 'email', 'birth_date', 'tags', 'notes']);
  });
});
