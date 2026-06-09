/**
 * Attendance-rate computation — pure helper (RN-13.03).
 *
 * The denominator counts only sessions attributable to the patient's
 * attendance behaviour: completed (`done`), patient-initiated cancellations
 * (`cancelledByPatient`), and no-shows (`noShow`). Therapist-initiated and
 * NULL-attributed cancellations are excluded by the caller's query, never
 * here — this helper trusts the buckets it is handed.
 *
 * Returns an integer percentage in `[0, 100]`, and `0` when the denominator
 * is zero (the rate is shown as `0%`, never hidden).
 */

export interface AttendanceRateBuckets {
  done: number;
  cancelledByPatient: number;
  noShow: number;
}

export function computeAttendanceRate({
  done,
  cancelledByPatient,
  noShow,
}: AttendanceRateBuckets): number {
  const denominator = done + cancelledByPatient + noShow;
  if (denominator === 0) return 0;
  return Math.round((done / denominator) * 100);
}
