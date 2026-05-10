import { subDays } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { computeEditScope, type SeriesSession } from '@/modules/sessions/lib/compute-edit-scope';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a series of 5 weekly sessions starting from a fixed future date.
 * IDs are `s1` through `s5`. All start in the future with status `scheduled`.
 */
function createFutureSeries(): SeriesSession[] {
  // Use dates far in the future so "all" scope considers them all as future.
  const base = new Date(2099, 0, 6); // Monday Jan 6, 2099

  return [
    { id: 's1', startAt: new Date(base.getTime()), status: 'scheduled' },
    {
      id: 's2',
      startAt: new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000),
      status: 'scheduled',
    },
    {
      id: 's3',
      startAt: new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000),
      status: 'scheduled',
    },
    {
      id: 's4',
      startAt: new Date(base.getTime() + 21 * 24 * 60 * 60 * 1000),
      status: 'done',
    },
    {
      id: 's5',
      startAt: new Date(base.getTime() + 28 * 24 * 60 * 60 * 1000),
      status: 'scheduled',
    },
  ];
}

/**
 * Creates a series where some sessions are in the past and some have completed statuses.
 */
function createMixedSeries(): SeriesSession[] {
  return [
    // Past and completed.
    { id: 'm1', startAt: new Date(2020, 0, 6), status: 'done' },
    { id: 'm2', startAt: new Date(2020, 0, 13), status: 'cancelled' },
    { id: 'm3', startAt: new Date(2020, 0, 20), status: 'no_show' },
    // Future and scheduled.
    { id: 'm4', startAt: new Date(2099, 0, 6), status: 'scheduled' },
    { id: 'm5', startAt: new Date(2099, 0, 13), status: 'scheduled' },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeEditScope', () => {
  describe("scope = 'this'", () => {
    it('returns only the target session for detach', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this', 's3', series);

      expect(result.toDetach).toEqual(['s3']);
      expect(result.toUpdate).toEqual([]);
      expect(result.newRecurrenceEndDate).toBeUndefined();
    });

    it('returns empty arrays when session is not found', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this', 'nonexistent', series);

      expect(result.toDetach).toEqual([]);
      expect(result.toUpdate).toEqual([]);
    });
  });

  describe("scope = 'this_and_future'", () => {
    it('returns target + all sessions after it for update', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this_and_future', 's2', series);

      // s2, s3, s4, s5 — all sessions from target onward, regardless of status.
      expect(result.toUpdate).toEqual(['s2', 's3', 's4', 's5']);
      expect(result.toDetach).toEqual([]);
    });

    it('calculates correct newRecurrenceEndDate (day before target)', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this_and_future', 's3', series);

      const s3 = series.find((s) => s.id === 's3')!;
      const expectedEndDate = subDays(s3.startAt, 1);

      expect(result.newRecurrenceEndDate).toEqual(expectedEndDate);
    });

    it('includes only the target when target is the last session', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this_and_future', 's5', series);

      expect(result.toUpdate).toEqual(['s5']);
    });

    it('includes all sessions when target is the first session', () => {
      const series = createFutureSeries();
      const result = computeEditScope('this_and_future', 's1', series);

      expect(result.toUpdate).toEqual(['s1', 's2', 's3', 's4', 's5']);
    });
  });

  describe("scope = 'all'", () => {
    it('returns only future non-completed sessions', () => {
      const series = createFutureSeries();
      const result = computeEditScope('all', 's1', series);

      // s4 has status 'done', so it is excluded.
      // All sessions are in the future (2099), but s4 is done.
      expect(result.toUpdate).toEqual(['s1', 's2', 's3', 's5']);
      expect(result.toDetach).toEqual([]);
    });

    it('excludes sessions with status done/cancelled/no_show', () => {
      const series = createMixedSeries();
      const result = computeEditScope('all', 'm4', series);

      // m1 (done, past), m2 (cancelled, past), m3 (no_show, past) — excluded.
      // m4, m5 — future + scheduled.
      expect(result.toUpdate).toEqual(['m4', 'm5']);
    });

    it('excludes past sessions even if they have status scheduled', () => {
      const series: SeriesSession[] = [
        { id: 'past-scheduled', startAt: new Date(2020, 0, 1), status: 'scheduled' },
        { id: 'future-scheduled', startAt: new Date(2099, 5, 1), status: 'scheduled' },
      ];

      const result = computeEditScope('all', 'past-scheduled', series);

      // Past sessions are excluded even if scheduled.
      expect(result.toUpdate).toEqual(['future-scheduled']);
    });
  });
});
