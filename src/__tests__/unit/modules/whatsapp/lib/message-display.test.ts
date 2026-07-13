import { describe, expect, it } from 'vitest';

import { deriveMessageDisplay, templateKeyLabel } from '@/modules/whatsapp/lib/message-display';

describe('templateKeyLabel', () => {
  it('maps a known template_key to its human-readable label', () => {
    expect(templateKeyLabel('lembrete_24h')).toBe('Lembrete 24h');
    expect(templateKeyLabel('cancelamento_aviso')).toBe('Aviso de cancelamento');
  });

  it('falls back to the raw key for historical values not in the enum', () => {
    expect(templateKeyLabel('confirmacao_recebida')).toBe('confirmacao_recebida');
    expect(templateKeyLabel('some_legacy_key')).toBe('some_legacy_key');
  });
});

describe('deriveMessageDisplay', () => {
  it('renders the template label for a template send (body=null, template_key set)', () => {
    expect(deriveMessageDisplay({ body: null, templateKey: 'lembrete_24h' })).toBe('Lembrete 24h');
    expect(deriveMessageDisplay({ body: null, templateKey: 'lembrete_2h' })).toBe('Lembrete 2h');
  });

  it('falls back to the raw template_key for historical template sends', () => {
    expect(deriveMessageDisplay({ body: null, templateKey: 'confirmacao_recebida' })).toBe(
      'confirmacao_recebida',
    );
  });

  it('renders body text unchanged for free-form replies (body present, no template_key)', () => {
    expect(deriveMessageDisplay({ body: 'Oi, doutora, tudo bem?', templateKey: null })).toBe(
      'Oi, doutora, tudo bem?',
    );
  });

  it('prefers the body text when both body and template_key are present (legacy rows)', () => {
    expect(deriveMessageDisplay({ body: 'Lembrete enviado', templateKey: 'lembrete_24h' })).toBe(
      'Lembrete enviado',
    );
  });

  it('returns an empty string when neither body nor template_key is present', () => {
    expect(deriveMessageDisplay({ body: null, templateKey: null })).toBe('');
    expect(deriveMessageDisplay({ body: '', templateKey: null })).toBe('');
  });
});
