import { describe, expect, it } from 'vitest';

import { computeAttendanceRate } from '@/modules/sessions/lib/compute-attendance-rate';

// ---------------------------------------------------------------------------
// computeAttendanceRate (RN-13.03)
// ---------------------------------------------------------------------------

describe('computeAttendanceRate', () => {
  it('returns 80% for 8 done out of (8 + 1 + 1)', () => {
    expect(computeAttendanceRate({ done: 8, cancelledByPatient: 1, noShow: 1 })).toBe(80);
  });

  it('returns 0% when all countable sessions were cancelled by the patient', () => {
    expect(computeAttendanceRate({ done: 0, cancelledByPatient: 5, noShow: 0 })).toBe(0);
  });

  it('returns 0% when the denominator is zero', () => {
    expect(computeAttendanceRate({ done: 0, cancelledByPatient: 0, noShow: 0 })).toBe(0);
  });

  it('returns 100% when every countable session is done', () => {
    expect(computeAttendanceRate({ done: 4, cancelledByPatient: 0, noShow: 0 })).toBe(100);
  });

  it('rounds to the nearest integer percentage', () => {
    // 2 / 3 = 66.66… → 67
    expect(computeAttendanceRate({ done: 2, cancelledByPatient: 1, noShow: 0 })).toBe(67);
  });

  it('counts no-shows in the denominator', () => {
    // 1 / (1 + 0 + 1) = 50
    expect(computeAttendanceRate({ done: 1, cancelledByPatient: 0, noShow: 1 })).toBe(50);
  });
});
