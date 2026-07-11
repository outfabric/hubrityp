import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { messageTemplates, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Verifies the migration 0043 end state:
//   - message_templates.template_key CHECK now rejects 'confirmacao_recebida'
//     but still accepts the five remaining keys.
//   - whatsapp_messages.template_key has NO CHECK, so a historical ack row
//     recorded as 'confirmacao_recebida' survives the migration and stays
//     readable (no backfill, no data loss).
// ---------------------------------------------------------------------------

// The five keys the CHECK must still accept after the migration.
const VALID_KEYS = [
  'lembrete_24h',
  'lembrete_2h',
  'cancelamento_aviso',
  'link_video',
  'termo_consentimento',
] as const;

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(messageTemplates);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

describe('message_templates.template_key CHECK after confirmacao_recebida removal', () => {
  it('rejects an insert with template_key = confirmacao_recebida', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(messageTemplates).values({
          userId,
          templateKey: 'confirmacao_recebida',
          body: 'Obrigado! Sua presença está confirmada.',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts every one of the five remaining template keys', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      for (const key of VALID_KEYS) {
        await db.insert(messageTemplates).values({
          userId,
          templateKey: key,
          body: `Corpo válido para ${key}.`,
        });
      }
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(messageTemplates).where(eq(messageTemplates.userId, userId));
    });

    expect(rows).toHaveLength(VALID_KEYS.length);
    expect(new Set(rows.map((r) => r.templateKey))).toEqual(new Set(VALID_KEYS));
  });
});

describe('whatsapp_messages retains historical confirmacao_recebida rows (no CHECK)', () => {
  it('a pre-existing confirmacao_recebida message survives and stays readable', async () => {
    const userId = randomUUID();
    const messageId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        id: messageId,
        userId,
        direction: 'outbound',
        templateKey: 'confirmacao_recebida',
        toPhone: '+5511999999999',
        body: 'Sua presença está confirmada.',
        status: 'delivered',
      });
    });

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.id, messageId)));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.templateKey).toBe('confirmacao_recebida');
  });
});
