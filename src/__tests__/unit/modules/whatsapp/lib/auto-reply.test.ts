import { describe, expect, it } from 'vitest';

import {
  AUTO_REPLY_BODY,
  AUTO_REPLY_TEMPLATE_KEY,
  AUTO_REPLY_THROTTLE_MS,
  shouldSendAutoReply,
} from '@/modules/whatsapp/lib/auto-reply';

describe('shouldSendAutoReply — throttle rule', () => {
  const now = new Date('2026-07-10T12:00:00Z');

  it('allows the first auto-reply when there is no prior one', () => {
    expect(shouldSendAutoReply(null, now)).toBe(true);
  });

  it('suppresses when a prior auto-reply was sent within the last 24h', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(shouldSendAutoReply(oneHourAgo, now)).toBe(false);
  });

  it('suppresses at just under the 24h boundary', () => {
    const justUnder24h = new Date(now.getTime() - (AUTO_REPLY_THROTTLE_MS - 1));
    expect(shouldSendAutoReply(justUnder24h, now)).toBe(false);
  });

  it('allows again exactly at the 24h boundary', () => {
    const exactly24h = new Date(now.getTime() - AUTO_REPLY_THROTTLE_MS);
    expect(shouldSendAutoReply(exactly24h, now)).toBe(true);
  });

  it('allows again after more than 24h', () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * AUTO_REPLY_THROTTLE_MS);
    expect(shouldSendAutoReply(twoDaysAgo, now)).toBe(true);
  });
});

describe('AUTO_REPLY_BODY — fixed, PII-free body', () => {
  it('is the exact fixed non-clinical string', () => {
    expect(AUTO_REPLY_BODY).toBe(
      'Olá, esse canal é utilizado apenas para envio de lembretes. Para falar com seu psicólogo (a), entre em contato diretamente com ele.',
    );
  });

  it('contains no template placeholders (no interpolated PII)', () => {
    // A fixed body must not carry any {{var}} / {var} / ${var} placeholders
    // that would inject a patient name, phone, or other PII at send time.
    expect(AUTO_REPLY_BODY).not.toMatch(/\{\{.*?\}\}/);
    expect(AUTO_REPLY_BODY).not.toMatch(/\{[^}]+\}/);
    expect(AUTO_REPLY_BODY).not.toMatch(/\$\{.*?\}/);
  });

  it('exposes a stable template-key label for throttle lookups', () => {
    expect(AUTO_REPLY_TEMPLATE_KEY).toBe('auto_reply');
  });
});
