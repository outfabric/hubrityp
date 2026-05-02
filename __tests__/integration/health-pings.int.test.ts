import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { healthPings } from '@/db/schema/health/tables';

import { healthPingFactory } from './factories/health-pings';
import { runAsService } from './setup/run-as-service';
import { runAsUser } from './setup/run-as-user';

afterEach(async () => {
  // Each test seeds rows via the service-role bypass; clean them up so the
  // suite stays order-independent.
  await runAsService(async (db) => {
    await db.delete(healthPings);
  });
});

describe('RLS on health_pings', () => {
  it('owner reads their own ping', async () => {
    const userA = randomUUID();
    const ping = healthPingFactory.build({ ownerId: userA });

    await runAsService(async (db) => {
      await db.insert(healthPings).values(ping);
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(healthPings).where(eq(healthPings.ownerId, userA));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ping.id);
  });

  it('non-owner cannot read another user’s ping', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const ping = healthPingFactory.build({ ownerId: userA });

    await runAsService(async (db) => {
      await db.insert(healthPings).values(ping);
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(healthPings);
    });

    expect(rows).toHaveLength(0);
  });

  it('service-role connection bypasses RLS and sees all rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();

    await runAsService(async (db) => {
      await db
        .insert(healthPings)
        .values([
          healthPingFactory.build({ ownerId: userA }),
          healthPingFactory.build({ ownerId: userB }),
        ]);
    });

    const rows = await runAsService(async (db) => db.select().from(healthPings));
    expect(rows).toHaveLength(2);
  });
});
