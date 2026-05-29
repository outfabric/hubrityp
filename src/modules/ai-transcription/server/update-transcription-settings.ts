import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { aiTranscriptionSettings } from '@/shared/db/schema/ai-transcription/tables';
import { auditLog, type NewAuditLog } from '@/shared/db/schema/medical-records/tables';

import { createTranscriptionLogger } from '../lib/logger';
import { UpdateTranscriptionSettingsInputSchema } from '../lib/settings-schemas';

export type UpdateTranscriptionSettingsResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' };

// Effective values used both for the diff and for synthesizing the "old" state
// when no row exists yet (a first save). Mirrors the table defaults.
const DEFAULT_OLD = {
  enabled: false,
  keepAudioHours: 24,
  keepTranscription: false,
} as const;

/**
 * Persists the caller's AI-transcription settings and writes a PII-free audit
 * trail for the security-relevant value changes.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Zod-validate input (`safeParse`).
 *   3. In a single transaction: read the current (old) values owner-scoped,
 *      UPSERT the new values keyed by `user_id`, then diff old↔new and append
 *      one audit row per changed dimension per the spec mapping.
 *
 * Audit mapping (each payload is `{ userId, oldValue, newValue }`, no PII):
 *   - enabled false→true            → `ai_transcription_enabled`
 *   - enabled true→false            → `ai_transcription_disabled`
 *   - keepAudioHours increased      → `ai_transcription_retention_changed`
 *   - keepTranscription toggled     → `ai_transcription_keep_transcription_toggled`
 *
 * Security: the UPSERT is keyed on `user_id = session.uid` and the input's
 * `userId` field (if forged) is never read — `userId` always comes from the
 * session. RLS is the last line; the explicit `user_id` here is defense-in-depth
 * (`db` bypasses RLS). An idempotent re-save (no value change) emits NO audit.
 */
export async function updateTranscriptionSettingsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateTranscriptionSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // 2. Validate input
  const parsed = UpdateTranscriptionSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'update_settings_validation_failed' });
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const next = parsed.data;

  // 3. Read old → upsert new → diff → audit, atomically.
  await db.transaction(async (tx) => {
    const [oldRow] = await tx
      .select({
        enabled: aiTranscriptionSettings.enabled,
        keepAudioHours: aiTranscriptionSettings.keepAudioHours,
        keepTranscription: aiTranscriptionSettings.keepTranscription,
      })
      .from(aiTranscriptionSettings)
      .where(eq(aiTranscriptionSettings.userId, userId))
      .limit(1);

    const old = oldRow ?? DEFAULT_OLD;

    const [upserted] = await tx
      .insert(aiTranscriptionSettings)
      .values({
        userId,
        enabled: next.enabled,
        defaultTemplate: next.defaultTemplate,
        keepAudioHours: next.keepAudioHours,
        keepTranscription: next.keepTranscription,
        riskDetectionSensitivity: next.riskDetectionSensitivity,
      })
      .onConflictDoUpdate({
        target: aiTranscriptionSettings.userId,
        set: {
          enabled: next.enabled,
          defaultTemplate: next.defaultTemplate,
          keepAudioHours: next.keepAudioHours,
          keepTranscription: next.keepTranscription,
          riskDetectionSensitivity: next.riskDetectionSensitivity,
          updatedAt: new Date(),
        },
      })
      .returning({ id: aiTranscriptionSettings.id });

    const settingsId = upserted!.id;

    const audits: NewAuditLog[] = [];
    const auditRow = (action: string, oldValue: unknown, newValue: unknown): NewAuditLog => ({
      userId,
      action,
      resourceType: 'ai_transcription_settings',
      resourceId: settingsId,
      metadata: { userId, oldValue, newValue },
    });

    // enabled toggled — distinct action per direction.
    if (old.enabled !== next.enabled) {
      audits.push(
        auditRow(
          next.enabled ? 'ai_transcription_enabled' : 'ai_transcription_disabled',
          old.enabled,
          next.enabled,
        ),
      );
    }

    // keepAudioHours — audited only on an increase (longer retention is the
    // privacy-relevant direction per the spec mapping).
    if (next.keepAudioHours > old.keepAudioHours) {
      audits.push(
        auditRow('ai_transcription_retention_changed', old.keepAudioHours, next.keepAudioHours),
      );
    }

    // keepTranscription — audited on any toggle (either direction).
    if (old.keepTranscription !== next.keepTranscription) {
      audits.push(
        auditRow(
          'ai_transcription_keep_transcription_toggled',
          old.keepTranscription,
          next.keepTranscription,
        ),
      );
    }

    if (audits.length > 0) {
      await tx.insert(auditLog).values(audits);
    }
  });

  log.info({ event: 'update_settings_success' });
  return { ok: true };
}
