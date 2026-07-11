import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the SUT. `vi.mock` is hoisted by Vitest,
// so declaration order is safe. The db mock lets us drive the idempotency
// short-circuit (existing count) and capture the rows inserted by the seed
// transaction.
// ---------------------------------------------------------------------------

let existingCount = 0;
const insertedRows: Record<string, unknown>[] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ count: existingCount }])),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn((row: Record<string, unknown>) => {
            insertedRows.push(row);
            return Promise.resolve();
          }),
        })),
      };
      await fn(tx);
    }),
  },
}));

import { seedDefaultTemplates } from '@/modules/whatsapp/server/seed-default-templates';

// The four platform Content SIDs seeded by `vitest.setup.ts` for the unit env.
// `confirmacao_recebida` is intentionally absent — the confirmation ack is a
// free-form message in the MVP, not a platform Content template, so it carries
// no SID and its env var was removed.
const EXPECTED_SID_BY_KEY: Record<string, string> = {
  lembrete_24h: 'HXunit24h',
  lembrete_2h: 'HXunit2h',
  link_video: 'HXunitvideo',
  cancelamento_aviso: 'HXunitcancel',
};

const REMINDER_KEYS = Object.keys(EXPECTED_SID_BY_KEY);

function rowByKey(templateKey: string): Record<string, unknown> {
  const row = insertedRows.find((r) => r.templateKey === templateKey);
  if (!row) throw new Error(`no inserted row for templateKey=${templateKey}`);
  return row;
}

describe('seedDefaultTemplates — platform Content SID mapping', () => {
  beforeEach(() => {
    existingCount = 0;
    insertedRows.length = 0;
  });

  it('stamps every reminder template with its platform Content SID and approved status', async () => {
    await seedDefaultTemplates(randomUUID());

    for (const templateKey of REMINDER_KEYS) {
      const row = rowByKey(templateKey);
      expect(row.metaTemplateId).toBe(EXPECTED_SID_BY_KEY[templateKey]);
      expect(row.metaStatus).toBe('approved');
      expect(row.metaTemplateId).not.toBeNull();
    }
  });

  it('maps each reminder templateKey to the correct Content SID (complete + no cross-wiring)', async () => {
    await seedDefaultTemplates(randomUUID());

    const seededSids = REMINDER_KEYS.map((key) => rowByKey(key).metaTemplateId);
    // All four SIDs are distinct — proves no two keys share the same SID.
    expect(new Set(seededSids).size).toBe(REMINDER_KEYS.length);
    expect(seededSids).toEqual(['HXunit24h', 'HXunit2h', 'HXunitvideo', 'HXunitcancel']);
  });

  it('leaves non-reminder templates (termo_consentimento) pending with a null SID', async () => {
    await seedDefaultTemplates(randomUUID());

    const row = rowByKey('termo_consentimento');
    expect(row.metaTemplateId).toBeNull();
    expect(row.metaStatus).toBe('pending');
  });

  it('marks all seeded templates as default', async () => {
    await seedDefaultTemplates(randomUUID());

    expect(insertedRows.length).toBeGreaterThan(0);
    for (const row of insertedRows) {
      expect(row.isDefault).toBe(true);
    }
  });

  it('is idempotent — does not insert when templates already exist', async () => {
    existingCount = 6;

    await seedDefaultTemplates(randomUUID());

    expect(insertedRows).toHaveLength(0);
  });

  it('rejects a non-uuid userId before touching the database', async () => {
    await expect(seedDefaultTemplates('not-a-uuid')).rejects.toThrow();
    expect(insertedRows).toHaveLength(0);
  });
});
