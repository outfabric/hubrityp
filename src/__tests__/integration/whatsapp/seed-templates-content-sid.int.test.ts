import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { resolvePlatformContentSid } from '@/modules/whatsapp/lib/reminders/platform-template-contract';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

// Reminder templates seeded with a platform Content SID, keyed to the env var
// resolved by `seedDefaultTemplates`. `termo_consentimento` is intentionally
// absent — it is not a reminder template and stays pending/null.
const EXPECTED_SID_BY_KEY: Record<string, string> = {
  lembrete_24h: serverEnv.TWILIO_CONTENT_SID_LEMBRETE_24H,
  lembrete_2h: serverEnv.TWILIO_CONTENT_SID_LEMBRETE_2H,
  link_video: serverEnv.TWILIO_CONTENT_SID_LINK_VIDEO,
  cancelamento_aviso: serverEnv.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO,
};

const REMINDER_KEYS = Object.keys(EXPECTED_SID_BY_KEY);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(messageTemplates);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// seedDefaultTemplates — platform Content SID persistence + dispatch contract
// ---------------------------------------------------------------------------

describe('seedDefaultTemplates — platform Content SIDs (real Postgres + RLS)', () => {
  it('persists non-null meta_template_id + approved for every reminder template', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { seedDefaultTemplates } =
      await import('@/modules/whatsapp/server/seed-default-templates');
    await seedDefaultTemplates(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(messageTemplates).where(eq(messageTemplates.userId, userId));
    });

    const byKey = Object.fromEntries(rows.map((r) => [r.templateKey, r]));

    // Exactly 5 rows — the four reminder templates + termo_consentimento. The
    // removed `confirmacao_recebida` row must never be seeded.
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.templateKey)).not.toContain('confirmacao_recebida');

    for (const key of REMINDER_KEYS) {
      const row = byKey[key];
      expect(row, `expected a seeded row for ${key}`).toBeDefined();
      expect(row!.metaStatus).toBe('approved');
      expect(row!.metaTemplateId).toBe(EXPECTED_SID_BY_KEY[key]);
    }

    // Non-reminder template stays pending with a null SID.
    expect(byKey['termo_consentimento']!.metaStatus).toBe('pending');
    expect(byKey['termo_consentimento']!.metaTemplateId).toBeNull();
  });

  it('dispatch resolves the same Content SID from serverEnv that the seed persisted', () => {
    // The dispatcher now resolves the Content SID from `serverEnv` via the
    // platform template contract — never from `message_templates`. The seed
    // stamps those same env SIDs onto the reminder rows, so the two must agree.
    for (const key of REMINDER_KEYS) {
      expect(resolvePlatformContentSid(key), `no env SID resolved for ${key}`).toBe(
        EXPECTED_SID_BY_KEY[key],
      );
    }

    // Non-reminder keys are not platform templates → no SID (never dispatched).
    expect(resolvePlatformContentSid('termo_consentimento')).toBeNull();
  });

  it('is idempotent — a second seed does not duplicate rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { seedDefaultTemplates } =
      await import('@/modules/whatsapp/server/seed-default-templates');
    await seedDefaultTemplates(userId);
    await seedDefaultTemplates(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(messageTemplates).where(eq(messageTemplates.userId, userId));
    });

    expect(rows).toHaveLength(5);
    // The reminder rows are still approved with their SID after the second call.
    const byKey = Object.fromEntries(rows.map((r) => [r.templateKey, r]));
    for (const key of REMINDER_KEYS) {
      expect(byKey[key]!.metaStatus).toBe('approved');
      expect(byKey[key]!.metaTemplateId).toBe(EXPECTED_SID_BY_KEY[key]);
    }
  });
});
