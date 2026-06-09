import { AlertTriangle, Calendar, CheckCircle2, MapPin, Video, X } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import {
  MODALITY_ICON,
  STATUS_PRESENTATION,
  formatFullDateWithWeekday,
  formatTime,
  formatTimeRange,
  isFinalizedReadOnly,
  monthGroupKey,
  monthGroupLabel,
} from '@/modules/sessions/lib/session-history-formatters';

describe('monthGroupKey / monthGroupLabel — SP timezone, year boundary', () => {
  it('keeps December and January in distinct groups across the year boundary', () => {
    // 2025-12-31 22:00 SP (UTC-3) === 2026-01-01 01:00 UTC. The SP wall clock
    // is still December, so it must group with December, not January.
    const decInSp = '2026-01-01T01:00:00.000Z';
    const janInSp = '2026-01-01T03:00:00.000Z'; // 2026-01-01 00:00 SP

    expect(monthGroupKey(decInSp)).toBe('2025-12');
    expect(monthGroupKey(janInSp)).toBe('2026-01');

    expect(monthGroupLabel(decInSp)).toBe('dezembro de 2025');
    expect(monthGroupLabel(janInSp)).toBe('janeiro de 2026');
  });

  it('groups instants in the same SP month under the same key', () => {
    expect(monthGroupKey('2025-06-01T12:00:00.000Z')).toBe('2025-06');
    expect(monthGroupKey('2025-06-30T12:00:00.000Z')).toBe('2025-06');
  });
});

describe('date / time formatters — SP timezone, pt-BR', () => {
  it('formats the full date with weekday in pt-BR', () => {
    // 2025-12-15 is a Monday.
    expect(formatFullDateWithWeekday('2025-12-15T17:00:00.000Z')).toBe(
      'segunda-feira, 15 de dezembro de 2025',
    );
  });

  it('formats time as SP wall clock', () => {
    // 17:30 UTC === 14:30 SP.
    expect(formatTime('2025-12-15T17:30:00.000Z')).toBe('14:30');
  });

  it('formats a time range with an en-dash', () => {
    expect(formatTimeRange('2025-12-15T17:30:00.000Z', '2025-12-15T18:20:00.000Z')).toBe(
      '14:30 – 15:20',
    );
  });
});

describe('STATUS_PRESENTATION map (RF-13.06)', () => {
  it('maps every status to the spec badge/icon/label', () => {
    expect(STATUS_PRESENTATION.scheduled).toEqual({
      badgeVariant: 'info',
      lucideIcon: Calendar,
      label: 'Agendada',
    });
    expect(STATUS_PRESENTATION.confirmed).toEqual({
      badgeVariant: 'info',
      lucideIcon: CheckCircle2,
      label: 'Confirmada',
    });
    expect(STATUS_PRESENTATION.done).toEqual({
      badgeVariant: 'success',
      lucideIcon: CheckCircle2,
      label: 'Realizada',
    });
    expect(STATUS_PRESENTATION.cancelled).toEqual({
      badgeVariant: 'neutral',
      lucideIcon: X,
      label: 'Cancelada',
    });
    expect(STATUS_PRESENTATION.no_show).toEqual({
      badgeVariant: 'warning',
      lucideIcon: AlertTriangle,
      label: 'Não compareceu',
    });
  });
});

describe('MODALITY_ICON map (RF-13.06)', () => {
  it('maps in_person to MapPin and online to Video', () => {
    expect(MODALITY_ICON.in_person).toBe(MapPin);
    expect(MODALITY_ICON.online).toBe(Video);
  });
});

describe('isFinalizedReadOnly (RN-13.05)', () => {
  const now = new Date('2026-06-09T12:00:00.000Z');

  it('returns true when finalized AND older than 30 days', () => {
    const finalized = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFinalizedReadOnly(finalized, now)).toBe(true);
  });

  it('returns false when finalized but within 30 days', () => {
    const finalized = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFinalizedReadOnly(finalized, now)).toBe(false);
  });

  it('returns false when not finalized (null)', () => {
    expect(isFinalizedReadOnly(null, now)).toBe(false);
  });

  it('returns false exactly at the 30-day boundary (strictly older required)', () => {
    const finalized = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFinalizedReadOnly(finalized, now)).toBe(false);
  });
});
