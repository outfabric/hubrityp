import { describe, expect, it } from 'vitest';

import {
  buildContentVariables,
  isPlatformTemplateKey,
  resolvePlatformContentSid,
  type ContentVariableContext,
  type PlatformTemplateKey,
} from '@/modules/whatsapp/lib/reminders/platform-template-contract';
import { serverEnv } from '@/shared/env';

// A fixed UTC instant. São Paulo is UTC-3 year-round (no DST since 2019), so
// 2026-03-15T13:30:00Z is 2026-03-15 10:30 local → date 15/03/2026, time 10:30.
const START_AT = new Date('2026-03-15T13:30:00Z');

function baseContext(overrides: Partial<ContentVariableContext> = {}): ContentVariableContext {
  return {
    patientFullName: 'Maria Silva Santos',
    professionalName: 'Dra. Ana Paula',
    startAt: START_AT,
    sessionLink: 'https://app.hubrity.com/s/abc123',
    ...overrides,
  };
}

// Expected named-variable key set per template — must match the Twilio Content
// Template Builder definitions exactly (extra keys → Twilio error 63028).
const EXPECTED_KEYS: Record<PlatformTemplateKey, string[]> = {
  lembrete_24h: ['first_name', 'professional_name', 'date', 'time'],
  lembrete_2h: ['first_name', 'professional_name', 'time'],
  link_video: ['first_name', 'professional_name', 'date', 'time', 'session_link'],
  cancelamento_aviso: ['first_name', 'professional_name', 'date', 'time'],
};

const PLATFORM_KEYS = Object.keys(EXPECTED_KEYS) as PlatformTemplateKey[];

describe('buildContentVariables — exact key sets', () => {
  it.each(PLATFORM_KEYS)('emits exactly the declared keys for %s (no extras)', (key) => {
    const result = buildContentVariables(key, baseContext());
    expect(Object.keys(result).sort()).toEqual([...EXPECTED_KEYS[key]].sort());
  });

  it('omits date for lembrete_2h even when startAt is present', () => {
    const result = buildContentVariables('lembrete_2h', baseContext());
    expect(result).not.toHaveProperty('date');
    expect(result).toHaveProperty('time', '10:30');
  });
});

describe('buildContentVariables — value resolution', () => {
  it('extracts the first name from the full name', () => {
    const result = buildContentVariables(
      'lembrete_24h',
      baseContext({ patientFullName: 'João Pedro de Oliveira' }),
    );
    expect(result.first_name).toBe('João');
  });

  it('formats date as dd/MM/yyyy and time as HH:mm in America/Sao_Paulo', () => {
    const result = buildContentVariables('lembrete_24h', baseContext());
    expect(result.date).toBe('15/03/2026');
    expect(result.time).toBe('10:30');
  });

  it('maps professional_name and session_link through unchanged', () => {
    const result = buildContentVariables('link_video', baseContext());
    expect(result.professional_name).toBe('Dra. Ana Paula');
    expect(result.session_link).toBe('https://app.hubrity.com/s/abc123');
  });

  it('strips newlines from values, collapsing them to a single space', () => {
    const result = buildContentVariables(
      'cancelamento_aviso',
      baseContext({ professionalName: 'Dra.\nAna\r\nPaula' }),
    );
    expect(result.professional_name).toBe('Dra. Ana Paula');
  });
});

describe('buildContentVariables — empty-value guard', () => {
  it('throws when session_link is missing for link_video', () => {
    expect(() => buildContentVariables('link_video', baseContext({ sessionLink: null }))).toThrow(
      /session_link/,
    );
  });

  it('throws when session_link is an empty string for link_video', () => {
    expect(() => buildContentVariables('link_video', baseContext({ sessionLink: '' }))).toThrow(
      /session_link/,
    );
  });

  it('throws when the full name resolves to an empty first name', () => {
    expect(() =>
      buildContentVariables('lembrete_24h', baseContext({ patientFullName: '   ' })),
    ).toThrow(/first_name/);
  });

  it('throws when a value is only newlines (empty after stripping)', () => {
    expect(() =>
      buildContentVariables('lembrete_24h', baseContext({ professionalName: '\n\r\n' })),
    ).toThrow(/professional_name/);
  });
});

describe('resolvePlatformContentSid', () => {
  it.each(PLATFORM_KEYS)('resolves the env SID for %s', (key) => {
    const expected = {
      lembrete_24h: serverEnv.TWILIO_CONTENT_SID_LEMBRETE_24H,
      lembrete_2h: serverEnv.TWILIO_CONTENT_SID_LEMBRETE_2H,
      link_video: serverEnv.TWILIO_CONTENT_SID_LINK_VIDEO,
      cancelamento_aviso: serverEnv.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO,
    }[key];
    expect(resolvePlatformContentSid(key)).toBe(expected);
  });

  it('returns null for non-platform template keys', () => {
    expect(resolvePlatformContentSid('termo_consentimento')).toBeNull();
    expect(resolvePlatformContentSid('confirmacao_recebida')).toBeNull();
    expect(resolvePlatformContentSid('unknown_key')).toBeNull();
  });
});

describe('isPlatformTemplateKey', () => {
  it.each(PLATFORM_KEYS)('returns true for the platform key %s', (key) => {
    expect(isPlatformTemplateKey(key)).toBe(true);
  });

  it('returns false for non-platform keys', () => {
    expect(isPlatformTemplateKey('termo_consentimento')).toBe(false);
    expect(isPlatformTemplateKey('confirmacao_recebida')).toBe(false);
  });
});
