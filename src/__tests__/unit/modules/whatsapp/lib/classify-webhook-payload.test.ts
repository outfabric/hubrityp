import { describe, expect, it } from 'vitest';

import {
  BUTTON_ID_CANCEL,
  BUTTON_ID_CONFIRM,
  classifyPayload,
} from '@/modules/whatsapp/lib/classify-webhook-payload';

describe('classifyPayload — quick-reply buttons (ButtonPayload)', () => {
  it("classifies ButtonPayload='confirm' as button_confirm", () => {
    expect(classifyPayload({ ButtonPayload: BUTTON_ID_CONFIRM }).type).toBe('button_confirm');
  });

  it("classifies ButtonPayload='cancel' as button_cancel", () => {
    expect(classifyPayload({ ButtonPayload: BUTTON_ID_CANCEL }).type).toBe('button_cancel');
  });

  it('classifies by ButtonPayload only, ignoring the ButtonText label', () => {
    // ButtonText is display copy: accents, re-worded labels, or a mismatched
    // label must never change the classification — only the payload ID matters.
    expect(
      classifyPayload({ ButtonPayload: 'confirm', ButtonText: 'Confirmar presença ✅' }).type,
    ).toBe('button_confirm');
    expect(
      classifyPayload({ ButtonPayload: 'cancel', ButtonText: 'Não posso comparecer' }).type,
    ).toBe('button_cancel');
    // A confirm payload wearing a cancel-looking label still confirms.
    expect(classifyPayload({ ButtonPayload: 'confirm', ButtonText: 'Cancelar' }).type).toBe(
      'button_confirm',
    );
  });

  it('falls through to inbound_text for an unrecognized ButtonPayload', () => {
    expect(
      classifyPayload({ ButtonPayload: 'something_else', From: 'whatsapp:+5511999999999' }).type,
    ).toBe('inbound_text');
  });

  it('does NOT classify buttons by ButtonText when ButtonPayload is absent', () => {
    // Legacy behavior removed: a bare ButtonText (no payload) is now inbound_text.
    expect(classifyPayload({ ButtonText: 'Confirmar' }).type).toBe('inbound_text');
  });
});

describe('classifyPayload — status / stop / free-text (unchanged)', () => {
  it('classifies a payload with MessageStatus as status_update', () => {
    expect(classifyPayload({ MessageStatus: 'delivered', MessageSid: 'SM1' }).type).toBe(
      'status_update',
    );
  });

  it('classifies an exact PARAR body as stop_command (trimmed, case-insensitive)', () => {
    expect(classifyPayload({ Body: 'PARAR' }).type).toBe('stop_command');
    expect(classifyPayload({ Body: 'parar' }).type).toBe('stop_command');
    expect(classifyPayload({ Body: '  PARAR  ' }).type).toBe('stop_command');
  });

  it('classifies non-PARAR body as inbound_text', () => {
    expect(classifyPayload({ Body: 'quero parar de ir na quarta' }).type).toBe('inbound_text');
    expect(classifyPayload({ Body: 'Oi, tudo bem?' }).type).toBe('inbound_text');
  });

  it('classifies an empty payload as inbound_text', () => {
    expect(classifyPayload({}).type).toBe('inbound_text');
  });
});
