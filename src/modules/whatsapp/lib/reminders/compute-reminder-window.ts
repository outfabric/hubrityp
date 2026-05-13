/**
 * Computes the due-time windows for each reminder type of a given session.
 *
 * Pure function — no side effects, no I/O. All timezone arithmetic uses
 * date-fns-tz with the caller-supplied timezone (typically America/Sao_Paulo).
 *
 * Business rules implemented:
 *   - Early reminder: session.startAt − early_reminder_hours
 *   - Final reminder: session.startAt − final_reminder_hours
 *   - Video link:     session.startAt − video_link_minutes (online only)
 *   - RN-04.03:       skip early reminder when session was created less than
 *                     early_reminder_hours before it starts
 *   - Night shift:    when send_during_night=false, any due time falling
 *                     between 22:00–06:59 BRT is deferred to 07:00
 *   - Past session:   all fields return null
 *   - Disabled type:  null hours → null for that type
 */

import { isBefore, subHours, subMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

import type { ReminderSettingsInput } from './reminder-settings-schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionForReminder {
  startAt: Date;
  createdAt: Date;
  modality?: string;
}

export interface ReminderWindow {
  earlyDueAt: Date | null;
  finalDueAt: Date | null;
  videoDueAt: Date | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NIGHT_START_HOUR = 22;
const MORNING_HOUR = 7;

// ---------------------------------------------------------------------------
// Night-shift helper
// ---------------------------------------------------------------------------

/**
 * If `send_during_night` is false and the computed due time falls within
 * the night window (22:00–06:59 in the given timezone), defer to 07:00
 * on the same calendar day (or next day if >= 22:00).
 *
 * Returns the (possibly shifted) UTC date.
 */
function applyNightShift(dueAtUtc: Date, sendDuringNight: boolean, timezone: string): Date {
  if (sendDuringNight) return dueAtUtc;

  const zoned = toZonedTime(dueAtUtc, timezone);
  const hour = zoned.getHours();

  // 22:00–23:59 → defer to 07:00 next calendar day
  // 00:00–06:59 → defer to 07:00 same calendar day
  const isNight = hour >= NIGHT_START_HOUR || hour < MORNING_HOUR;
  if (!isNight) return dueAtUtc;

  // Build 07:00 on the correct calendar day in the target timezone
  const deferred = new Date(zoned);
  if (hour >= NIGHT_START_HOUR) {
    // Move to next day
    deferred.setDate(deferred.getDate() + 1);
  }
  deferred.setHours(MORNING_HOUR, 0, 0, 0);

  // Convert back to UTC
  return fromZonedTime(deferred, timezone);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function computeReminderWindow(
  session: SessionForReminder,
  settings: ReminderSettingsInput,
  now: Date,
  timezone: string,
): ReminderWindow {
  // Past session → all null
  if (isBefore(session.startAt, now)) {
    return { earlyDueAt: null, finalDueAt: null, videoDueAt: null };
  }

  // --- Early reminder ---
  let earlyDueAt: Date | null = null;
  if (settings.early_reminder_hours !== null) {
    const rawEarly = subHours(session.startAt, settings.early_reminder_hours);

    // RN-04.03: skip early if session was created less than
    // early_reminder_hours before start
    const creationThreshold = subHours(session.startAt, settings.early_reminder_hours);
    const sessionCreatedAfterThreshold = isBefore(creationThreshold, session.createdAt);

    if (!sessionCreatedAfterThreshold) {
      earlyDueAt = applyNightShift(rawEarly, settings.send_during_night, timezone);
    }
  }

  // --- Final reminder ---
  let finalDueAt: Date | null = null;
  if (settings.final_reminder_hours !== null) {
    const rawFinal = subHours(session.startAt, settings.final_reminder_hours);
    finalDueAt = applyNightShift(rawFinal, settings.send_during_night, timezone);
  }

  // --- Video link (online only) ---
  let videoDueAt: Date | null = null;
  if (session.modality === 'online') {
    const rawVideo = subMinutes(session.startAt, settings.video_link_minutes);
    videoDueAt = applyNightShift(rawVideo, settings.send_during_night, timezone);
  }

  return { earlyDueAt, finalDueAt, videoDueAt };
}
