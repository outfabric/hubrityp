import { test as base, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { db, truncateAllExceptSeed } from '../helpers/db';
import { psicologos } from '@/lib/db/schema';

const SEED_PSICOLOGO_ID = '00000000-0000-0000-0000-000000000001';

type Fixtures = {
  dr: { id: string; nome: string };
  twilioCalls: string[];
};

export const test = base.extend<Fixtures>({
  dr: async ({}, use) => {
    const [row] = await db
      .select()
      .from(psicologos)
      .where(eq(psicologos.id, SEED_PSICOLOGO_ID));
    await use({ id: row.id, nome: row.nome });
  },

  twilioCalls: [
    async ({ context }, use) => {
      const calls: string[] = [];
      await context.route('https://api.twilio.com/**/Messages.json', async (route) => {
        const body = (await route.request().postData()) ?? '';
        calls.push(body);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ sid: 'SM_test', status: 'queued' }),
        });
      });
      await context.route('https://api.asaas.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'pay_test', status: 'PENDING' }),
        })
      );
      await use(calls);
    },
    { auto: true },
  ],

  page: async ({ page }, use) => {
    await truncateAllExceptSeed();
    await use(page);
  },
});

export { expect };
