/**
 * Unit tests for deferred-creation helpers in auto-create-room.ts.
 *
 * Verifies `computeWakeUpAt` returns exactly 1 hour before the session start,
 * which is the instant the Inngest function sleeps until before provisioning
 * the video room.
 */

import { describe, expect, it } from 'vitest';

import { computeWakeUpAt } from '@/modules/telepsicologia/inngest/auto-create-room';

describe('auto-create-room: computeWakeUpAt', () => {
  it('returns exactly 1 hour before the session start', () => {
    const startAt = new Date('2026-06-01T15:00:00.000Z');

    const wakeUpAt = computeWakeUpAt(startAt);

    expect(wakeUpAt.toISOString()).toBe('2026-06-01T14:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const startAt = new Date('2026-06-01T15:00:00.000Z');
    const original = startAt.getTime();

    computeWakeUpAt(startAt);

    expect(startAt.getTime()).toBe(original);
  });

  it('handles sub-hour and day-boundary offsets correctly', () => {
    const startAt = new Date('2026-06-01T00:30:00.000Z');

    const wakeUpAt = computeWakeUpAt(startAt);

    expect(wakeUpAt.toISOString()).toBe('2026-05-31T23:30:00.000Z');
  });
});
