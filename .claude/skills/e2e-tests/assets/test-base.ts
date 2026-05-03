import { test as base, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { psicologos } from '@/shared/db/schema';

import { readSeedState, STORAGE_STATE_PATH } from '../seeded/setup/seed-state';
import { truncateAllExceptSeed } from './db-helpers';

const SEED_PSICOLOGO_ID = '00000000-0000-4000-8000-000000000001';

type Fixtures = {
  dr: { id: string; nome: string };
  twilioCalls: string[];
};

export const test = base.extend<Fixtures>({
  storageState: STORAGE_STATE_PATH,

  dr: async ({}, use) => {
    const seed = await readSeedState();
    const client = postgres(seed.databaseUrl, { max: 1 });
    const db = drizzle(client);
    try {
      const [row] = await db
        .select()
        .from(psicologos)
        .where(eq(psicologos.id, SEED_PSICOLOGO_ID));
      await use({ id: row.id, nome: row.nome });
    } finally {
      await client.end();
    }
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
