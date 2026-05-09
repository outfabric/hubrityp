import { addWeeks, getDay, startOfDay } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  generateRecurrenceInstances,
  MAX_MATERIALIZED_SESSIONS,
  type RecurrenceRule,
} from '@/modules/sessions/lib/generate-recurrence-instances';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tuesday 2026-01-06 (a Tuesday in January 2026). */
const TUESDAY_JAN_2026 = new Date(2026, 0, 6);

/** Thursday 2026-01-08. */
const THURSDAY_JAN_2026 = new Date(2026, 0, 8);

/** Jan 31, 2026 — edge case for monthly clamping. */
const JAN_31_2026 = new Date(2026, 0, 31);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateRecurrenceInstances', () => {
  describe('weekly frequency', () => {
    it('generates correct Tuesdays for 6 months (~26 dates)', () => {
      const rule: RecurrenceRule = {
        frequency: 'weekly',
        daysOfWeek: [2], // Tuesday
        startDate: TUESDAY_JAN_2026,
        endDate: new Date(2026, 6, 6), // ~6 months out (July 6)
      };

      const dates = generateRecurrenceInstances(rule);

      // Every date should be a Tuesday.
      for (const d of dates) {
        expect(getDay(d)).toBe(2);
      }

      // 6 months of Tuesdays: Jan 6 to Jul 6 should yield 26 dates.
      expect(dates.length).toBe(26);

      // First date is the start date.
      expect(dates[0]).toEqual(startOfDay(TUESDAY_JAN_2026));

      // Dates are 7 days apart.
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]!.getTime() - dates[i - 1]!.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      }
    });
  });

  describe('biweekly frequency', () => {
    it('generates 12 dates over 24 weeks', () => {
      const rule: RecurrenceRule = {
        frequency: 'biweekly',
        startDate: TUESDAY_JAN_2026,
        occurrenceCount: 12,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(12);

      // First date is the start date.
      expect(dates[0]).toEqual(startOfDay(TUESDAY_JAN_2026));

      // Dates are 14 days apart.
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]!.getTime() - dates[i - 1]!.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
      }

      // Last date should be 22 weeks after start (12 biweekly = 11 gaps of 2 weeks).
      expect(dates[11]).toEqual(startOfDay(addWeeks(TUESDAY_JAN_2026, 22)));
    });
  });

  describe('monthly frequency', () => {
    it('generates 6 dates over 6 months', () => {
      const rule: RecurrenceRule = {
        frequency: 'monthly',
        startDate: new Date(2026, 0, 15), // Jan 15
        occurrenceCount: 6,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(6);

      // Each date should be the 15th of its month.
      expect(dates[0]).toEqual(startOfDay(new Date(2026, 0, 15)));
      expect(dates[1]).toEqual(startOfDay(new Date(2026, 1, 15)));
      expect(dates[2]).toEqual(startOfDay(new Date(2026, 2, 15)));
      expect(dates[3]).toEqual(startOfDay(new Date(2026, 3, 15)));
      expect(dates[4]).toEqual(startOfDay(new Date(2026, 4, 15)));
      expect(dates[5]).toEqual(startOfDay(new Date(2026, 5, 15)));
    });

    it('handles month boundaries — Jan 31 monthly clamps to Feb 28', () => {
      const rule: RecurrenceRule = {
        frequency: 'monthly',
        startDate: JAN_31_2026,
        occurrenceCount: 4,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(4);
      expect(dates[0]).toEqual(startOfDay(new Date(2026, 0, 31))); // Jan 31
      expect(dates[1]).toEqual(startOfDay(new Date(2026, 1, 28))); // Feb 28 (non-leap year)
      expect(dates[2]).toEqual(startOfDay(new Date(2026, 2, 31))); // Mar 31
      expect(dates[3]).toEqual(startOfDay(new Date(2026, 3, 30))); // Apr 30
    });

    it('empty daysOfWeek for monthly is valid — uses startDate day-of-month', () => {
      const rule: RecurrenceRule = {
        frequency: 'monthly',
        daysOfWeek: [], // empty — should be ignored for monthly
        startDate: new Date(2026, 0, 10), // Jan 10
        occurrenceCount: 3,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(3);
      expect(dates[0]!.getDate()).toBe(10);
      expect(dates[1]!.getDate()).toBe(10);
      expect(dates[2]!.getDate()).toBe(10);
    });
  });

  describe('multi-day weekly (Tue + Thu)', () => {
    it('generates 2x dates per week', () => {
      const rule: RecurrenceRule = {
        frequency: 'weekly',
        daysOfWeek: [2, 4], // Tue + Thu
        startDate: TUESDAY_JAN_2026,
        occurrenceCount: 8,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(8);

      // Pattern: Tue, Thu, Tue, Thu, ...
      expect(getDay(dates[0]!)).toBe(2); // Tue Jan 6
      expect(getDay(dates[1]!)).toBe(4); // Thu Jan 8
      expect(getDay(dates[2]!)).toBe(2); // Tue Jan 13
      expect(getDay(dates[3]!)).toBe(4); // Thu Jan 15
    });
  });

  describe('indefinite recurrence', () => {
    it('caps at MAX_MATERIALIZED_SESSIONS (104)', () => {
      const rule: RecurrenceRule = {
        frequency: 'weekly',
        daysOfWeek: [2], // Tuesday
        startDate: TUESDAY_JAN_2026,
        isIndefinite: true,
        materializationWindowMonths: 24,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(MAX_MATERIALIZED_SESSIONS);

      // All dates should be Tuesdays.
      for (const d of dates) {
        expect(getDay(d)).toBe(2);
      }
    });
  });

  describe('custom frequency with specific days', () => {
    it('generates sessions on Mon+Wed+Fri', () => {
      const rule: RecurrenceRule = {
        frequency: 'custom',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        startDate: new Date(2026, 0, 5), // Monday Jan 5
        occurrenceCount: 9,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(9);

      // First week: Mon 5, Wed 7, Fri 9
      expect(getDay(dates[0]!)).toBe(1);
      expect(getDay(dates[1]!)).toBe(3);
      expect(getDay(dates[2]!)).toBe(5);

      // Second week: Mon 12, Wed 14, Fri 16
      expect(getDay(dates[3]!)).toBe(1);
      expect(getDay(dates[4]!)).toBe(3);
      expect(getDay(dates[5]!)).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no termination condition is provided', () => {
      const rule: RecurrenceRule = {
        frequency: 'weekly',
        daysOfWeek: [2],
        startDate: TUESDAY_JAN_2026,
        // no endDate, occurrenceCount, or isIndefinite
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(0);
    });

    it('startDate on a different day than daysOfWeek starts from the first matching day', () => {
      // Start on a Thursday but recurrence is on Tuesdays — should skip to next Tue.
      const rule: RecurrenceRule = {
        frequency: 'weekly',
        daysOfWeek: [2], // Tuesday
        startDate: THURSDAY_JAN_2026, // Thursday
        occurrenceCount: 3,
      };

      const dates = generateRecurrenceInstances(rule);

      expect(dates.length).toBe(3);

      // All dates should be Tuesdays, starting from the first Tuesday >= start.
      for (const d of dates) {
        expect(getDay(d)).toBe(2);
      }

      // First Tuesday after Jan 8 (Thursday) is Jan 13.
      expect(dates[0]).toEqual(startOfDay(new Date(2026, 0, 13)));
    });
  });
});
