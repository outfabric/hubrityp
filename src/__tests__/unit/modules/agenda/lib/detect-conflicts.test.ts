import { describe, expect, it } from 'vitest';

import {
  detectConflicts,
  type CandidateInterval,
  type ExistingSession,
} from '@/modules/agenda/lib/detect-conflicts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to create a Date from "HH:MM" on a fixed day (2026-06-15). */
function t(hhmm: string): Date {
  return new Date(`2026-06-15T${hhmm}:00Z`);
}

/** Build an ExistingSession with sensible defaults. */
function session(
  overrides: Partial<ExistingSession> & Pick<ExistingSession, 'id' | 'startAt' | 'endAt'>,
): ExistingSession {
  return {
    patientName: null,
    blockingTitle: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Candidate: 10:00 – 11:00 */
const CANDIDATE: CandidateInterval = {
  startAt: t('10:00'),
  endAt: t('11:00'),
};

// ---------------------------------------------------------------------------
// No conflict
// ---------------------------------------------------------------------------

describe('detectConflicts — no conflict', () => {
  it('returns empty array when existing sessions is empty', () => {
    const result = detectConflicts(CANDIDATE, []);
    expect(result).toEqual([]);
  });

  it('returns empty array when existing session is entirely before candidate', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('08:00'), endAt: t('09:00'), patientName: 'João' }),
    ]);
    expect(result).toEqual([]);
  });

  it('returns empty array when existing session is entirely after candidate', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('12:00'), endAt: t('13:00'), patientName: 'Maria' }),
    ]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adjacent sessions (no overlap)
// ---------------------------------------------------------------------------

describe('detectConflicts — adjacent sessions (no overlap)', () => {
  it('does not conflict when existing session ends exactly at candidate start', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('09:00'), endAt: t('10:00'), patientName: 'Ana' }),
    ]);
    expect(result).toEqual([]);
  });

  it('does not conflict when existing session starts exactly at candidate end', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('11:00'), endAt: t('12:00'), patientName: 'Pedro' }),
    ]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Total overlap
// ---------------------------------------------------------------------------

describe('detectConflicts — total overlap', () => {
  it('detects conflict when existing session completely contains candidate', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('09:00'), endAt: t('12:00'), patientName: 'Laura' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: '1',
      label: 'Laura',
      conflictStart: t('09:00'),
      conflictEnd: t('12:00'),
    });
  });

  it('detects conflict when candidate completely contains existing session', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('10:15'), endAt: t('10:45'), patientName: 'Bruno' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('1');
  });

  it('detects conflict when sessions are exactly equal', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('10:00'), endAt: t('11:00'), patientName: 'Clara' }),
    ]);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Partial overlap (start)
// ---------------------------------------------------------------------------

describe('detectConflicts — partial overlap at start', () => {
  it('detects conflict when existing session overlaps the beginning of candidate', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('09:30'), endAt: t('10:30'), patientName: 'Diego' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: '1',
      label: 'Diego',
      conflictStart: t('09:30'),
      conflictEnd: t('10:30'),
    });
  });
});

// ---------------------------------------------------------------------------
// Partial overlap (end)
// ---------------------------------------------------------------------------

describe('detectConflicts — partial overlap at end', () => {
  it('detects conflict when existing session overlaps the end of candidate', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: '1', startAt: t('10:45'), endAt: t('11:30'), patientName: 'Elena' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sessionId: '1',
      label: 'Elena',
      conflictStart: t('10:45'),
      conflictEnd: t('11:30'),
    });
  });
});

// ---------------------------------------------------------------------------
// Multiple conflicts
// ---------------------------------------------------------------------------

describe('detectConflicts — multiple conflicts', () => {
  it('returns all overlapping sessions', () => {
    const existing: ExistingSession[] = [
      session({ id: '1', startAt: t('09:30'), endAt: t('10:15'), patientName: 'Fábio' }),
      session({ id: '2', startAt: t('10:45'), endAt: t('11:15'), patientName: 'Gabi' }),
      session({ id: '3', startAt: t('12:00'), endAt: t('13:00'), patientName: 'Hugo' }), // no overlap
    ];

    const result = detectConflicts(CANDIDATE, existing);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.sessionId)).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// Conflict with blocking slot
// ---------------------------------------------------------------------------

describe('detectConflicts — blocking slot', () => {
  it('uses blockingTitle as label when patientName is null', () => {
    const result = detectConflicts(CANDIDATE, [
      session({
        id: 'block-1',
        startAt: t('10:00'),
        endAt: t('10:30'),
        blockingTitle: 'Almoço',
        patientName: null,
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('Almoço');
  });

  it('prefers blockingTitle over patientName when both are set', () => {
    // Edge case: both fields populated (shouldn't happen in practice, but
    // the function should behave deterministically).
    const result = detectConflicts(CANDIDATE, [
      session({
        id: 'hybrid-1',
        startAt: t('10:00'),
        endAt: t('10:30'),
        blockingTitle: 'Reunião',
        patientName: 'Isa',
      }),
    ]);
    expect(result[0]?.label).toBe('Reunião');
  });
});

// ---------------------------------------------------------------------------
// Label fallback
// ---------------------------------------------------------------------------

describe('detectConflicts — label fallback', () => {
  it('returns empty string label when both patientName and blockingTitle are null', () => {
    const result = detectConflicts(CANDIDATE, [
      session({ id: 'anon-1', startAt: t('10:00'), endAt: t('10:30') }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('');
  });
});
