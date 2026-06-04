import { describe, expect, it } from 'vitest';

import {
  getNotificationTypeMeta,
  markReadInputSchema,
  notificationTypeMeta,
  notificationTypeSchema,
} from '@/modules/notifications/lib/schemas';

// The 7 MVP types, frozen here as an independent source of truth so a drift in
// the module's allowlist is caught by this test rather than silently accepted.
const MVP_TYPES = [
  'session_confirmed',
  'session_cancelled',
  'evolution_pending',
  'consent_signed',
  'ai_note_ready',
  'ai_risk_alert',
  'system_notice',
] as const;

// Representative post-MVP discriminators that MUST NOT be part of the allowlist.
const POST_MVP_TYPES = [
  'receita_saude_pending',
  'payment_received',
  'whatsapp_failed',
  'reminder_failed',
] as const;

describe('markReadInputSchema', () => {
  it('accepts a valid UUID', () => {
    const result = markReadInputSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    const result = markReadInputSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty id', () => {
    const result = markReadInputSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a numeric id (wrong type)', () => {
    const result = markReadInputSchema.safeParse({ id: 42 });
    expect(result.success).toBe(false);
  });

  it('rejects a missing id', () => {
    const result = markReadInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('notification type allowlist', () => {
  it('covers exactly the 7 MVP types', () => {
    expect([...notificationTypeSchema.options].sort()).toEqual([...MVP_TYPES].sort());
  });

  it('accepts every MVP type', () => {
    for (const type of MVP_TYPES) {
      expect(notificationTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects post-MVP types', () => {
    for (const type of POST_MVP_TYPES) {
      expect(notificationTypeSchema.safeParse(type).success).toBe(false);
    }
  });
});

describe('notificationTypeMeta', () => {
  it('has a meta entry for exactly the 7 MVP types', () => {
    expect(Object.keys(notificationTypeMeta).sort()).toEqual([...MVP_TYPES].sort());
  });

  it('gives every type a non-empty icon name and a path-relative route', () => {
    for (const type of MVP_TYPES) {
      const meta = notificationTypeMeta[type];
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(meta.route.startsWith('/')).toBe(true);
    }
  });
});

describe('getNotificationTypeMeta', () => {
  it('returns the meta for an MVP type', () => {
    expect(getNotificationTypeMeta('session_confirmed')).toEqual(
      notificationTypeMeta.session_confirmed,
    );
  });

  it('returns null for a post-MVP type', () => {
    expect(getNotificationTypeMeta('payment_received')).toBeNull();
  });

  it('returns null for an unknown / tampered value', () => {
    expect(getNotificationTypeMeta('"><script>')).toBeNull();
  });
});
