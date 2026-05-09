import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { agendaSettings, type AgendaSettings } from '@/shared/db/schema/agenda/tables';

// ---------------------------------------------------------------------------
// Default values (returned when no row exists for the user)
// ---------------------------------------------------------------------------

/** Mon-Fri 08:00-20:00, Sat 08:00-12:00 */
const DEFAULT_BUSINESS_HOURS = [
  { day: 1, start: '08:00', end: '20:00' },
  { day: 2, start: '08:00', end: '20:00' },
  { day: 3, start: '08:00', end: '20:00' },
  { day: 4, start: '08:00', end: '20:00' },
  { day: 5, start: '08:00', end: '20:00' },
  { day: 6, start: '08:00', end: '12:00' },
];

const DEFAULT_SETTINGS = {
  defaultDurationMinutes: 50,
  intervalMinutes: 10,
  businessHours: DEFAULT_BUSINESS_HOURS,
  cancellationPolicy: null,
  defaultColor: null,
} as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetAgendaSettingsResult =
  | { ok: true; settings: AgendaSettings; isDefault: false }
  | { ok: true; settings: typeof DEFAULT_SETTINGS; isDefault: true }
  | { ok: false; error: 'unauthenticated' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Fetches the agenda settings for the authenticated psychologist.
 *
 * If no row exists yet (first-time user), returns sensible defaults without
 * creating a DB row — the row is created lazily by `saveAgendaSettingsImpl`
 * when the user explicitly saves.
 */
export async function getAgendaSettingsImpl(
  supabase: SupabaseClient,
): Promise<GetAgendaSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query
  const [row] = await db
    .select()
    .from(agendaSettings)
    .where(eq(agendaSettings.userId, user.id))
    .limit(1);

  if (!row) {
    return { ok: true, settings: DEFAULT_SETTINGS, isDefault: true };
  }

  return { ok: true, settings: row, isDefault: false };
}
