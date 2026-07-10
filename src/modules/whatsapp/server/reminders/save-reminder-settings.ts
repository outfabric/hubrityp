import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import {
  reminderSettingsSchema,
  reminderSettingsWithConsentSchema,
} from '@/modules/whatsapp/lib/reminders/reminder-settings-schema';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { reminderSettings, whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

import { seedDefaultTemplates } from '../seed-default-templates';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SaveReminderSettingsResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'server_error' };

// ---------------------------------------------------------------------------
// Lazy provisioning
// ---------------------------------------------------------------------------

/**
 * Provisions the psychologist's shared-number WhatsApp account on the first
 * consented save and seeds their default templates.
 *
 * The account is scoped to the platform's shared WhatsApp number (via
 * `serverEnv`), marked `active`, and stamped with `consent_given_at = NOW()`
 * — the LGPD lawful basis. `INSERT ... ON CONFLICT (user_id) DO NOTHING`
 * guarantees that two concurrent first-saves settle on exactly one row without
 * an unhandled `23505`; templates are only seeded by the caller that actually
 * inserted the account (`returning` is empty for the loser of the race).
 *
 * `userId` MUST come from the authenticated session — never from client input.
 */
async function provisionWhatsappAccount(userId: string, platformNumber: string): Promise<void> {
  const profileRows = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const displayName = profileRows[0]?.fullName ?? null;

  const inserted = await db
    .insert(whatsappAccounts)
    .values({
      userId,
      provider: 'twilio',
      // Shared-number model: every psychologist reuses the platform sender, so
      // both identifiers are derived from the single platform number.
      accountId: platformNumber,
      phoneNumber: platformNumber,
      displayName,
      status: 'active',
      consentGivenAt: new Date(),
    })
    .onConflictDoNothing({ target: whatsappAccounts.userId })
    .returning({ id: whatsappAccounts.id });

  // Only the caller that won the insert seeds templates — this avoids a
  // duplicate-key race on `message_templates` between concurrent first-saves.
  if (inserted.length > 0) {
    await seedDefaultTemplates(userId);
    logger.info(
      { event: 'whatsapp_account_provisioned', userId },
      'shared-number WhatsApp account provisioned on first reminder save',
    );
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validates the input, upserts the psychologist's reminder settings and — on
 * the first consented save — lazily provisions their shared-number WhatsApp
 * account plus default templates.
 *
 * Security:
 *   - Authenticates with `supabase.auth.getUser()` (revalidates with GoTrue).
 *   - Authorizes from the session: `user_id` is always `user.id`, never input.
 *   - Validates every field with Zod at the boundary; consent is enforced only
 *     while the account is still unprovisioned.
 */
export async function saveReminderSettingsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SaveReminderSettingsResult> {
  // 1. Authenticate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Detect whether an account already exists. Consent is only required on
  //    the first save (before provisioning); once the account exists,
  //    subsequent saves must not re-ask for it.
  const existingAccount = await db
    .select({ id: whatsappAccounts.id })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, userId))
    .limit(1);

  const accountExists = existingAccount.length > 0;

  // 3. Validate — enforce consent only when this save will provision the account.
  const schema = accountExists ? reminderSettingsSchema : reminderSettingsWithConsentSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night } =
    parsed.data;

  // 4. Guard the platform number BEFORE any write when provisioning is pending,
  //    so a misconfigured deploy fails without persisting a half-completed state.
  const platformNumber = serverEnv.TWILIO_WHATSAPP_FROM;
  if (!accountExists && !platformNumber) {
    logger.error(
      { event: 'reminder_provisioning_missing_platform_number', userId },
      'TWILIO_WHATSAPP_FROM not configured; cannot provision shared WhatsApp account',
    );
    return { ok: false, error: 'server_error' };
  }

  // 5. Upsert reminder settings — INSERT ... ON CONFLICT (user_id) DO UPDATE.
  await db
    .insert(reminderSettings)
    .values({
      userId,
      earlyReminderHours: early_reminder_hours,
      finalReminderHours: final_reminder_hours,
      videoLinkMinutes: video_link_minutes,
      sendDuringNight: send_during_night,
    })
    .onConflictDoUpdate({
      target: reminderSettings.userId,
      set: {
        earlyReminderHours: early_reminder_hours,
        finalReminderHours: final_reminder_hours,
        videoLinkMinutes: video_link_minutes,
        sendDuringNight: send_during_night,
        updatedAt: sql`now()`,
      },
    });

  // 6. Lazy provisioning on the first consented save.
  if (!accountExists && platformNumber) {
    try {
      await provisionWhatsappAccount(userId, platformNumber);
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code === '23505') {
        // A concurrent first-save won the race — the account already exists.
        // Settings are saved; nothing more to do.
        logger.info(
          { event: 'whatsapp_account_provision_conflict', userId },
          'shared-number WhatsApp account provisioned by a concurrent request',
        );
      } else {
        logger.error(
          {
            event: 'whatsapp_account_provision_failed',
            userId,
            errorName: err instanceof Error ? err.name : 'UnknownError',
          },
          'failed to provision shared-number WhatsApp account',
        );
        return { ok: false, error: 'server_error' };
      }
    }
  }

  logger.info(
    { event: 'reminder_settings_saved', userId },
    'Reminder settings upserted successfully',
  );

  // 7. Invalidate cache.
  revalidatePath('/app/configuracoes/lembretes');

  return { ok: true };
}
