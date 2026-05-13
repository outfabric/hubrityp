import { describe, expect, it } from 'vitest';

import { formatConversationTime } from '@/modules/whatsapp/lib/inbox/format-conversation-time';

/**
 * All tests use explicit `now` to make assertions deterministic.
 *
 * Dates are constructed in UTC. The function internally converts to
 * America/Sao_Paulo (BRT = UTC-3, BRST = UTC-2) for calendar-day
 * comparisons, so we account for the offset when building fixtures.
 */

// Helper: build a UTC date from components
function utc(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

describe('formatConversationTime', () => {
  // ------------------------------------------------------------------
  // "agora" — less than 1 minute
  // ------------------------------------------------------------------
  describe('less than 1 minute ago', () => {
    it('returns "agora" when date equals now', () => {
      const now = utc(2026, 5, 13, 17, 0, 0);
      expect(formatConversationTime(now, now)).toBe('agora');
    });

    it('returns "agora" for 30 seconds ago', () => {
      const now = utc(2026, 5, 13, 17, 0, 30);
      const date = utc(2026, 5, 13, 17, 0, 0);
      expect(formatConversationTime(date, now)).toBe('agora');
    });

    it('returns "agora" for 59 seconds ago', () => {
      const now = utc(2026, 5, 13, 17, 0, 59);
      const date = utc(2026, 5, 13, 17, 0, 0);
      expect(formatConversationTime(date, now)).toBe('agora');
    });
  });

  // ------------------------------------------------------------------
  // Boundary: exactly 1 minute — should NOT be "agora"
  // ------------------------------------------------------------------
  describe('exactly 1 minute boundary', () => {
    it('returns time format (not "agora") at exactly 60 seconds', () => {
      // 2026-05-13 17:01:00 UTC = 14:01 BRT (same day)
      const now = utc(2026, 5, 13, 17, 1, 0);
      const date = utc(2026, 5, 13, 17, 0, 0);
      const result = formatConversationTime(date, now);
      expect(result).not.toBe('agora');
      expect(result).toBe('h 14:00');
    });
  });

  // ------------------------------------------------------------------
  // Today — "h HH:mm"
  // ------------------------------------------------------------------
  describe('same calendar day (today in BRT)', () => {
    it('formats as "h HH:mm" for a message earlier today', () => {
      // now = 2026-05-13 20:00 UTC = 17:00 BRT
      // date = 2026-05-13 17:30 UTC = 14:30 BRT
      const now = utc(2026, 5, 13, 20, 0, 0);
      const date = utc(2026, 5, 13, 17, 30, 0);
      expect(formatConversationTime(date, now)).toBe('h 14:30');
    });

    it('formats morning time correctly', () => {
      // date = 2026-05-13 12:05 UTC = 09:05 BRT
      const now = utc(2026, 5, 13, 20, 0, 0);
      const date = utc(2026, 5, 13, 12, 5, 0);
      expect(formatConversationTime(date, now)).toBe('h 09:05');
    });
  });

  // ------------------------------------------------------------------
  // Yesterday — "ontem"
  // ------------------------------------------------------------------
  describe('previous calendar day (yesterday in BRT)', () => {
    it('returns "ontem" for the previous day', () => {
      // now = 2026-05-13 15:00 UTC = 12:00 BRT (May 13)
      // date = 2026-05-12 18:00 UTC = 15:00 BRT (May 12)
      const now = utc(2026, 5, 13, 15, 0, 0);
      const date = utc(2026, 5, 12, 18, 0, 0);
      expect(formatConversationTime(date, now)).toBe('ontem');
    });

    it('returns "ontem" for yesterday late at night', () => {
      // now = 2026-05-13 06:00 UTC = 03:00 BRT (May 13)
      // date = 2026-05-12 05:00 UTC = 02:00 BRT (May 12)
      const now = utc(2026, 5, 13, 6, 0, 0);
      const date = utc(2026, 5, 12, 5, 0, 0);
      expect(formatConversationTime(date, now)).toBe('ontem');
    });
  });

  // ------------------------------------------------------------------
  // Same year — "DD/MM"
  // ------------------------------------------------------------------
  describe('same year but older than yesterday', () => {
    it('formats as "DD/MM" for a date earlier this year', () => {
      // now = 2026-05-13, date = 2026-05-10 (3 days ago)
      const now = utc(2026, 5, 13, 15, 0, 0);
      const date = utc(2026, 5, 10, 10, 0, 0);
      expect(formatConversationTime(date, now)).toBe('10/05');
    });

    it('formats as "DD/MM" for January date in same year', () => {
      // now = 2026-05-13, date = 2026-01-15
      const now = utc(2026, 5, 13, 15, 0, 0);
      const date = utc(2026, 1, 15, 10, 0, 0);
      expect(formatConversationTime(date, now)).toBe('15/01');
    });
  });

  // ------------------------------------------------------------------
  // Different year — "DD/MM/YYYY"
  // ------------------------------------------------------------------
  describe('different year', () => {
    it('formats as "DD/MM/YYYY" for a date in the previous year', () => {
      // now = 2026-05-13, date = 2025-05-15
      const now = utc(2026, 5, 13, 15, 0, 0);
      const date = utc(2025, 5, 15, 10, 0, 0);
      expect(formatConversationTime(date, now)).toBe('15/05/2025');
    });

    it('formats as "DD/MM/YYYY" for a date several years ago', () => {
      // now = 2026-05-13, date = 2023-12-25
      const now = utc(2026, 5, 13, 15, 0, 0);
      const date = utc(2023, 12, 25, 10, 0, 0);
      expect(formatConversationTime(date, now)).toBe('25/12/2023');
    });
  });

  // ------------------------------------------------------------------
  // Midnight boundary — timezone-aware edge case
  // ------------------------------------------------------------------
  describe('midnight boundary (timezone edge case)', () => {
    it('treats a UTC date crossing midnight in BRT as yesterday', () => {
      // now = 2026-05-14 02:30 UTC = 2026-05-13 23:30 BRT (May 13)
      // date = 2026-05-13 02:30 UTC = 2026-05-12 23:30 BRT (May 12)
      // In BRT, now is May 13 and date is May 12 → "ontem"
      const now = utc(2026, 5, 14, 2, 30, 0);
      const date = utc(2026, 5, 13, 2, 30, 0);
      expect(formatConversationTime(date, now)).toBe('ontem');
    });

    it('treats dates on the same BRT day even if UTC day differs', () => {
      // now = 2026-05-14 01:00 UTC = 2026-05-13 22:00 BRT (May 13)
      // date = 2026-05-13 04:00 UTC = 2026-05-13 01:00 BRT (May 13)
      // Both are May 13 in BRT → same day → "h HH:mm"
      const now = utc(2026, 5, 14, 1, 0, 0);
      const date = utc(2026, 5, 13, 4, 0, 0);
      expect(formatConversationTime(date, now)).toBe('h 01:00');
    });

    it('just past midnight BRT: message from 23:59 yesterday is "ontem"', () => {
      // now = 2026-05-14 03:01 UTC = 2026-05-14 00:01 BRT (May 14)
      // date = 2026-05-14 02:59 UTC = 2026-05-13 23:59 BRT (May 13)
      // In BRT: now is May 14, date is May 13 → "ontem"
      const now = utc(2026, 5, 14, 3, 1, 0);
      const date = utc(2026, 5, 14, 2, 59, 0);
      expect(formatConversationTime(date, now)).toBe('ontem');
    });
  });

  // ------------------------------------------------------------------
  // Default `now` parameter
  // ------------------------------------------------------------------
  describe('default now parameter', () => {
    it('uses current time when now is omitted', () => {
      // A date far in the past should return "DD/MM/YYYY"
      const veryOldDate = utc(2020, 1, 1, 12, 0, 0);
      expect(formatConversationTime(veryOldDate)).toBe('01/01/2020');
    });
  });
});
