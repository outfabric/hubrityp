import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateEndTime,
  formatSessionDate,
  formatSessionDateFull,
  formatSessionTime,
  isInPast,
  toSaoPauloTime,
} from '@/modules/agenda/lib/date-helpers';

// ---------------------------------------------------------------------------
// toSaoPauloTime — UTC → America/Sao_Paulo conversion
// ---------------------------------------------------------------------------

describe('toSaoPauloTime', () => {
  it('converts UTC to São Paulo standard time (UTC-3)', () => {
    // 2026-06-15 17:00 UTC → 2026-06-15 14:00 BRT (June = no DST)
    const utc = new Date('2026-06-15T17:00:00Z');
    const sp = toSaoPauloTime(utc);

    expect(sp.getHours()).toBe(14);
    expect(sp.getMinutes()).toBe(0);
  });

  it('converts midnight UTC to 21:00 previous day in São Paulo (UTC-3)', () => {
    // 2026-06-16 00:00 UTC → 2026-06-15 21:00 BRT
    const utc = new Date('2026-06-16T00:00:00Z');
    const sp = toSaoPauloTime(utc);

    expect(sp.getHours()).toBe(21);
    expect(sp.getDate()).toBe(15);
  });

  it('preserves minutes and seconds during conversion', () => {
    const utc = new Date('2026-06-15T18:35:42Z');
    const sp = toSaoPauloTime(utc);

    expect(sp.getHours()).toBe(15);
    expect(sp.getMinutes()).toBe(35);
    expect(sp.getSeconds()).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// formatSessionTime
// ---------------------------------------------------------------------------

describe('formatSessionTime', () => {
  it('formats UTC date as HH:mm in São Paulo timezone', () => {
    // 17:00 UTC → 14:00 BRT (June = no DST, UTC-3)
    expect(formatSessionTime(new Date('2026-06-15T17:00:00Z'))).toBe('14:00');
  });

  it('includes leading zeros for single-digit hours', () => {
    // 12:05 UTC → 09:05 BRT
    expect(formatSessionTime(new Date('2026-06-15T12:05:00Z'))).toBe('09:05');
  });

  it('handles midnight in São Paulo', () => {
    // 03:00 UTC → 00:00 BRT
    expect(formatSessionTime(new Date('2026-06-15T03:00:00Z'))).toBe('00:00');
  });
});

// ---------------------------------------------------------------------------
// formatSessionDate
// ---------------------------------------------------------------------------

describe('formatSessionDate', () => {
  it('formats UTC date as "d de MMM. yyyy" in pt-BR São Paulo timezone', () => {
    expect(formatSessionDate(new Date('2026-05-15T17:00:00Z'))).toBe('15 de mai. 2026');
  });

  it('formats January correctly', () => {
    expect(formatSessionDate(new Date('2026-01-10T15:00:00Z'))).toBe('10 de jan. 2026');
  });

  it('formats December correctly', () => {
    expect(formatSessionDate(new Date('2026-12-25T15:00:00Z'))).toBe('25 de dez. 2026');
  });
});

// ---------------------------------------------------------------------------
// formatSessionDateFull
// ---------------------------------------------------------------------------

describe('formatSessionDateFull', () => {
  it('formats UTC date as full weekday date in pt-BR São Paulo timezone', () => {
    // 2026-05-15 is a Friday
    expect(formatSessionDateFull(new Date('2026-05-15T17:00:00Z'))).toBe(
      'sexta-feira, 15 de maio de 2026',
    );
  });

  it('formats a Monday correctly', () => {
    // 2026-06-15 is a Monday
    expect(formatSessionDateFull(new Date('2026-06-15T17:00:00Z'))).toBe(
      'segunda-feira, 15 de junho de 2026',
    );
  });

  it('formats a Sunday correctly', () => {
    // 2026-06-14 is a Sunday
    expect(formatSessionDateFull(new Date('2026-06-14T17:00:00Z'))).toBe(
      'domingo, 14 de junho de 2026',
    );
  });
});

// ---------------------------------------------------------------------------
// calculateEndTime
// ---------------------------------------------------------------------------

describe('calculateEndTime', () => {
  it('adds the specified minutes to the start time', () => {
    const start = new Date('2026-06-15T14:00:00Z');
    const end = calculateEndTime(start, 50);

    expect(end.toISOString()).toBe('2026-06-15T14:50:00.000Z');
  });

  it('handles standard 60-minute sessions', () => {
    const start = new Date('2026-06-15T10:00:00Z');
    const end = calculateEndTime(start, 60);

    expect(end.toISOString()).toBe('2026-06-15T11:00:00.000Z');
  });

  it('handles crossing midnight', () => {
    const start = new Date('2026-06-15T23:30:00Z');
    const end = calculateEndTime(start, 60);

    expect(end.toISOString()).toBe('2026-06-16T00:30:00.000Z');
  });

  it('handles zero-minute duration', () => {
    const start = new Date('2026-06-15T14:00:00Z');
    const end = calculateEndTime(start, 0);

    expect(end.toISOString()).toBe('2026-06-15T14:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// isInPast
// ---------------------------------------------------------------------------

describe('isInPast', () => {
  beforeEach(() => {
    // Fix "now" to 2026-06-15T12:00:00Z for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date in the past', () => {
    const pastDate = new Date('2026-06-15T11:59:59Z');
    expect(isInPast(pastDate)).toBe(true);
  });

  it('returns false for a date in the future', () => {
    const futureDate = new Date('2026-06-15T12:00:01Z');
    expect(isInPast(futureDate)).toBe(false);
  });

  it('returns false for a date equal to now', () => {
    // isPast returns false when the date equals the current time
    // (it checks strictly less than)
    const now = new Date('2026-06-15T12:00:00Z');
    expect(isInPast(now)).toBe(false);
  });

  it('returns true for a date far in the past', () => {
    const farPast = new Date('2020-01-01T00:00:00Z');
    expect(isInPast(farPast)).toBe(true);
  });
});
