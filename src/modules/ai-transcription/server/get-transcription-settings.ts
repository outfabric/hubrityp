import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { aiTranscriptionSettings } from '@/shared/db/schema/ai-transcription/tables';

import { createTranscriptionLogger } from '../lib/logger';
import { RiskSensitivitySchema, TranscriptionTemplateSchema } from '../lib/schemas';
import {
  TranscriptionSettingsViewSchema,
  type TranscriptionSettingsView,
} from '../lib/settings-schemas';

// Table defaults synthesized when the psychologist has no settings row yet.
// Mirror the DB column defaults (see `ai_transcription_settings` schema) so the
// upserted row and the synthesized view never diverge.
const DEFAULT_SETTINGS = {
  enabled: false,
  defaultTemplate: 'livre' as const,
  keepAudioHours: 24 as const,
  keepTranscription: false,
  riskDetectionSensitivity: 'medium' as const,
} satisfies TranscriptionSettingsView;

export type GetTranscriptionSettingsResult =
  | ({ ok: true } & TranscriptionSettingsView)
  | { ok: false; code: 'UNAUTHORIZED' };

/**
 * Reads the caller's AI-transcription settings, creating the default row on
 * first access.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. UPSERT a default row keyed by `user_id` (`ON CONFLICT DO NOTHING`), so a
 *      first-time reader gets a persisted row matching the table defaults while
 *      a returning reader is left untouched.
 *   3. SELECT the current row (owner-scoped) and project it through
 *      `TranscriptionSettingsViewSchema`.
 *
 * Security: `userId` always comes from the session, never from input. The
 * owner-scoped WHERE is defense-in-depth on top of RLS (`db` bypasses RLS).
 * The response carries no PII — only the boolean/enum preferences.
 */
export async function getTranscriptionSettingsImpl(
  supabase: SupabaseClient,
): Promise<GetTranscriptionSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // 2. Ensure a row exists. Insert defaults; if one already exists, the unique
  //    constraint on `user_id` makes this a no-op (the existing values win).
  await db
    .insert(aiTranscriptionSettings)
    .values({ userId, ...DEFAULT_SETTINGS })
    .onConflictDoNothing({ target: aiTranscriptionSettings.userId });

  // 3. Read the current row, owner-scoped.
  const [row] = await db
    .select({
      enabled: aiTranscriptionSettings.enabled,
      defaultTemplate: aiTranscriptionSettings.defaultTemplate,
      keepAudioHours: aiTranscriptionSettings.keepAudioHours,
      keepTranscription: aiTranscriptionSettings.keepTranscription,
      riskDetectionSensitivity: aiTranscriptionSettings.riskDetectionSensitivity,
    })
    .from(aiTranscriptionSettings)
    .where(eq(aiTranscriptionSettings.userId, userId))
    .limit(1);

  // Defensive: a row must exist after the upsert. If the read somehow misses
  // (e.g. a concurrent delete), fall back to the synthesized defaults rather
  // than throwing — the view contract is "always return the effective values".
  const effective = row ?? DEFAULT_SETTINGS;

  const view = TranscriptionSettingsViewSchema.parse({
    enabled: effective.enabled,
    defaultTemplate: TranscriptionTemplateSchema.parse(effective.defaultTemplate),
    riskDetectionSensitivity: RiskSensitivitySchema.parse(effective.riskDetectionSensitivity),
    keepAudioHours: effective.keepAudioHours,
    keepTranscription: effective.keepTranscription,
  });

  log.debug({ event: 'get_settings_success' });
  return { ok: true, ...view };
}
