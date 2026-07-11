import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { fetchTemplate } from '@/modules/whatsapp/inngest/reminders-dispatcher';
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

  it('dispatcher fetchTemplate returns a contentSid for every reminder kind after seed', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { seedDefaultTemplates } =
      await import('@/modules/whatsapp/server/seed-default-templates');
    await seedDefaultTemplates(userId);

    await runAsService(async (db) => {
      for (const key of REMINDER_KEYS) {
        const template = await fetchTemplate(db, userId, key);
        expect(template, `fetchTemplate returned null for ${key}`).not.toBeNull();
        expect(template!.contentSid).toBe(EXPECTED_SID_BY_KEY[key]);
        expect(template!.body.length).toBeGreaterThan(0);
      }

      // The non-reminder template has no SID → dispatcher skips it.
      const termo = await fetchTemplate(db, userId, 'termo_consentimento');
      expect(termo).toBeNull();
    });
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

    expect(rows).toHaveLength(6);
    // The reminder rows are still approved with their SID after the second call.
    const byKey = Object.fromEntries(rows.map((r) => [r.templateKey, r]));
    for (const key of REMINDER_KEYS) {
      expect(byKey[key]!.metaStatus).toBe('approved');
      expect(byKey[key]!.metaTemplateId).toBe(EXPECTED_SID_BY_KEY[key]);
    }
  });
});
