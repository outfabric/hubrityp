import { describe, expect, it } from 'vitest';

import {
  computeReminderWindow,
  type SessionForReminder,
} from '@/modules/whatsapp/lib/reminders/compute-reminder-window';
import type { ReminderSettingsInput } from '@/modules/whatsapp/lib/reminders/reminder-settings-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TZ = 'America/Sao_Paulo';

/**
 * BRT (Brasília Time) is UTC-3. This helper creates a UTC Date from a
 * BRT-local hour on a fixed date (2026-06-15), which is during standard
 * time (no DST in Brazil since 2019).
 */
function utcFromBrt(year: number, month: number, day: number, hour: number, min = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, min, 0, 0));
}

function defaultSettings(overrides?: Partial<ReminderSettingsInput>): ReminderSettingsInput {
  return {
    early_reminder_hours: 24,
    final_reminder_hours: 2,
    video_link_minutes: 30,
    send_during_night: false,
    ...overrides,
  };
}

function defaultSession(overrides?: Partial<SessionForReminder>): SessionForReminder {
  return {
    // Session at 14:00 BRT on 2026-06-16 (17:00 UTC)
    startAt: utcFromBrt(2026, 6, 16, 14, 0),
    // Created 3 days earlier
    createdAt: utcFromBrt(2026, 6, 13, 10, 0),
    modality: 'in_person',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic computation — early / final / video
// ---------------------------------------------------------------------------

describe('computeReminderWindow — basic computation', () => {
  const now = utcFromBrt(2026, 6, 14, 10, 0); // 2 days before session

  it('computes early and final due times correctly for a standard session', () => {
    const result = computeReminderWindow(defaultSession(), defaultSettings(), now, TZ);

    // early: startAt - 24h = 2026-06-15 14:00 BRT
    expect(result.earlyDueAt).toEqual(utcFromBrt(2026, 6, 15, 14, 0));
    // final: startAt - 2h = 2026-06-16 12:00 BRT
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 16, 12, 0));
    // video: null (not online)
    expect(result.videoDueAt).toBeNull();
  });

  it('computes video due time for online sessions', () => {
    const session = defaultSession({ modality: 'online' });
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    // video: startAt - 30min = 2026-06-16 13:30 BRT
    expect(result.videoDueAt).toEqual(utcFromBrt(2026, 6, 16, 13, 30));
  });

  it('does not set video for in_person sessions', () => {
    const session = defaultSession({ modality: 'in_person' });
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.videoDueAt).toBeNull();
  });

  it('uses video_link_minutes=60 correctly', () => {
    const session = defaultSession({ modality: 'online' });
    const settings = defaultSettings({ video_link_minutes: 60 });
    const result = computeReminderWindow(session, settings, now, TZ);

    // video: startAt - 60min = 2026-06-16 13:00 BRT
    expect(result.videoDueAt).toEqual(utcFromBrt(2026, 6, 16, 13, 0));
  });
});

// ---------------------------------------------------------------------------
// RN-04.03 — skip early when session created recently
// ---------------------------------------------------------------------------

describe('computeReminderWindow — RN-04.03 (late creation skip early)', () => {
  it('skips early reminder when session created less than early_reminder_hours ago', () => {
    // Session at 14:00 BRT on 2026-06-16, created at 16:00 BRT on 2026-06-15
    // That is only 22h before session — less than 24h window
    const session = defaultSession({
      createdAt: utcFromBrt(2026, 6, 15, 16, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 17, 0);
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.earlyDueAt).toBeNull();
    // final should still be set
    expect(result.finalDueAt).not.toBeNull();
  });

  it('does NOT skip early when session created exactly at the threshold', () => {
    // Session at 14:00 BRT on 2026-06-16, created at 14:00 BRT on 2026-06-15
    // That is exactly 24h before session = exactly at the threshold
    const session = defaultSession({
      createdAt: utcFromBrt(2026, 6, 15, 14, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 14, 30);
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.earlyDueAt).not.toBeNull();
  });

  it('does NOT skip final even when session created recently', () => {
    const session = defaultSession({
      createdAt: utcFromBrt(2026, 6, 15, 16, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 17, 0);
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.finalDueAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Night shift
// ---------------------------------------------------------------------------

describe('computeReminderWindow — night shift', () => {
  it('defers to 07:00 when send_during_night=false and due falls at 23:00 BRT', () => {
    // Session at 01:00 BRT on 2026-06-17 → final at 23:00 BRT on 2026-06-16
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 17, 1, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 10, 0);
    const settings = defaultSettings({ send_during_night: false });
    const result = computeReminderWindow(session, settings, now, TZ);

    // final: 01:00 - 2h = 23:00 BRT on 6/16 → deferred to 07:00 BRT on 6/17
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 17, 7, 0));
  });

  it('defers to 07:00 when due falls at 03:00 BRT (early morning)', () => {
    // Session at 05:00 BRT on 2026-06-16 → final at 03:00 BRT
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 16, 5, 0),
    });
    const now = utcFromBrt(2026, 6, 14, 10, 0);
    const settings = defaultSettings({ send_during_night: false });
    const result = computeReminderWindow(session, settings, now, TZ);

    // final: 05:00 - 2h = 03:00 BRT → deferred to 07:00 same day
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 16, 7, 0));
  });

  it('keeps original time when send_during_night=true', () => {
    // Session at 01:00 BRT on 2026-06-17 → final at 23:00 BRT on 2026-06-16
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 17, 1, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 10, 0);
    const settings = defaultSettings({ send_during_night: true });
    const result = computeReminderWindow(session, settings, now, TZ);

    // final: 23:00 BRT → kept as-is
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 16, 23, 0));
  });

  it('does not defer when due time is exactly 07:00 BRT', () => {
    // Session at 09:00 BRT → final at 07:00 BRT (boundary)
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 16, 9, 0),
    });
    const now = utcFromBrt(2026, 6, 14, 10, 0);
    const settings = defaultSettings({ send_during_night: false });
    const result = computeReminderWindow(session, settings, now, TZ);

    // 09:00 - 2h = 07:00 → NOT in night window, stays 07:00
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 16, 7, 0));
  });

  it('defers when due time is exactly 22:00 BRT', () => {
    // Session at 00:00 BRT on 2026-06-17 → final at 22:00 BRT on 2026-06-16
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 17, 0, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 10, 0);
    const settings = defaultSettings({ send_during_night: false });
    const result = computeReminderWindow(session, settings, now, TZ);

    // 00:00 - 2h = 22:00 BRT on 6/16 → deferred to 07:00 BRT on 6/17
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 17, 7, 0));
  });
});

// ---------------------------------------------------------------------------
// Past session
// ---------------------------------------------------------------------------

describe('computeReminderWindow — past session', () => {
  it('returns all null when session is in the past', () => {
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 10, 14, 0),
      modality: 'online',
    });
    const now = utcFromBrt(2026, 6, 14, 10, 0);
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.earlyDueAt).toBeNull();
    expect(result.finalDueAt).toBeNull();
    expect(result.videoDueAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disabled reminder (null hours)
// ---------------------------------------------------------------------------

describe('computeReminderWindow — disabled reminders', () => {
  const now = utcFromBrt(2026, 6, 14, 10, 0);

  it('returns null earlyDueAt when early_reminder_hours is null', () => {
    const settings = defaultSettings({ early_reminder_hours: null });
    const result = computeReminderWindow(defaultSession(), settings, now, TZ);

    expect(result.earlyDueAt).toBeNull();
    expect(result.finalDueAt).not.toBeNull();
  });

  it('returns null finalDueAt when final_reminder_hours is null', () => {
    const settings = defaultSettings({ final_reminder_hours: null });
    const result = computeReminderWindow(defaultSession(), settings, now, TZ);

    expect(result.finalDueAt).toBeNull();
    expect(result.earlyDueAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Timezone correctness
// ---------------------------------------------------------------------------

describe('computeReminderWindow — timezone correctness', () => {
  it('uses the provided timezone for night shift calculation', () => {
    // Session at 01:00 BRT on 2026-06-17
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 17, 1, 0),
    });
    const now = utcFromBrt(2026, 6, 15, 10, 0);
    const settings = defaultSettings({ send_during_night: false });
    const result = computeReminderWindow(session, settings, now, TZ);

    // final: 23:00 BRT → deferred to 07:00 BRT = 10:00 UTC
    expect(result.finalDueAt).toEqual(utcFromBrt(2026, 6, 17, 7, 0));
  });
});

// ---------------------------------------------------------------------------
// Edge case — session exactly at window boundary
// ---------------------------------------------------------------------------

describe('computeReminderWindow — edge cases', () => {
  it('handles session starting exactly now (boundary: not past)', () => {
    const now = utcFromBrt(2026, 6, 16, 14, 0);
    const session = defaultSession({
      startAt: utcFromBrt(2026, 6, 16, 14, 0), // same as now
    });
    // startAt is not before now → should still compute (it is at the boundary)
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    // early would be 14:00 yesterday, final 12:00 today — both valid
    // (they are in the past relative to `now`, but the function does not
    // check per-field; it only checks session.startAt vs now)
    expect(result.finalDueAt).not.toBeNull();
  });

  it('online session without explicit modality gets no video', () => {
    const session = defaultSession({ modality: undefined });
    const now = utcFromBrt(2026, 6, 14, 10, 0);
    const result = computeReminderWindow(session, defaultSettings(), now, TZ);

    expect(result.videoDueAt).toBeNull();
  });
});
