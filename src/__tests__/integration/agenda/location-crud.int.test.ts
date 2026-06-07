import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocationImpl } from '@/modules/agenda/server/create-location';
import { deleteLocationImpl } from '@/modules/agenda/server/delete-location';
import { listLocationsImpl } from '@/modules/agenda/server/list-locations';
import { updateLocationImpl } from '@/modules/agenda/server/update-location';
import { locations } from '@/shared/db/schema/agenda/tables';
import { sessions } from '@/shared/db/schema/agenda/tables';

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

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. This isolates the server action logic from the real
 * Supabase Auth service (which requires GoTrue running).
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createLocationImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessions);
    await db.delete(locations);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// createLocationImpl
// ---------------------------------------------------------------------------

describe('createLocationImpl', () => {
  it('creates a location successfully with minimal fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createLocationImpl(client, {
      name: 'Consultorio A',
      type: 'in_person',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locationId).toBeDefined();
    expect(typeof result.locationId).toBe('string');

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, result.locationId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Consultorio A');
    expect(rows[0]!.type).toBe('in_person');
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.isDefault).toBe(false);
  });

  it('creates a location with all optional fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createLocationImpl(client, {
      name: 'Sala Online',
      type: 'online',
      address: 'https://meet.example.com/sala1',
      color: '#FF5733',
      arrival_instructions: 'Clique no link 5 minutos antes.',
      is_default: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, result.locationId));
    });
    expect(rows[0]!.address).toBe('https://meet.example.com/sala1');
    expect(rows[0]!.color).toBe('#FF5733');
    expect(rows[0]!.arrivalInstructions).toBe('Clique no link 5 minutos antes.');
  });

  it('returns invalid_input for missing required fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createLocationImpl(client, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('name');
    expect(result.fieldErrors).toHaveProperty('type');
  });

  it('returns invalid_input for invalid color format', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createLocationImpl(client, {
      name: 'Test',
      type: 'in_person',
      color: 'red',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('color');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await createLocationImpl(client, {
      name: 'Test',
      type: 'in_person',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// listLocationsImpl
// ---------------------------------------------------------------------------

describe('listLocationsImpl', () => {
  it('lists locations for authenticated user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create two locations
    await createLocationImpl(client, { name: 'Sala B', type: 'online' });
    await createLocationImpl(client, { name: 'Sala A', type: 'in_person' });

    const result = await listLocationsImpl(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(2);
    // Ordered by is_default DESC, name ASC — both non-default, so alphabetical
    expect(result.locations[0]!.name).toBe('Sala A');
    expect(result.locations[1]!.name).toBe('Sala B');
  });

  it('returns empty array when user has no locations', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await listLocationsImpl(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(0);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await listLocationsImpl(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// updateLocationImpl
// ---------------------------------------------------------------------------

describe('updateLocationImpl', () => {
  it('updates location fields successfully', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const createResult = await createLocationImpl(client, {
      name: 'Original',
      type: 'in_person',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await updateLocationImpl(client, createResult.locationId, {
      name: 'Updated Name',
      type: 'online',
      address: 'https://zoom.us/123',
    });

    expect(result.ok).toBe(true);

    // Verify DB
    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, createResult.locationId));
    });
    expect(rows[0]!.name).toBe('Updated Name');
    expect(rows[0]!.type).toBe('online');
    expect(rows[0]!.address).toBe('https://zoom.us/123');
  });

  it('returns not_found for non-existent location', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updateLocationImpl(client, randomUUID(), {
      name: 'Ghost',
      type: 'in_person',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for location owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createLocationImpl(clientA, {
      name: 'Location of A',
      type: 'in_person',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to update User A's location
    const clientB = fakeSupabaseClient(userB);
    const result = await updateLocationImpl(clientB, createResult.locationId, {
      name: 'Hijacked',
      type: 'in_person',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');

    // Verify original is unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, createResult.locationId));
    });
    expect(rows[0]!.name).toBe('Location of A');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await updateLocationImpl(client, randomUUID(), {
      name: 'Test',
      type: 'in_person',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns invalid_input for invalid type', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updateLocationImpl(client, randomUUID(), {
      name: 'Test',
      type: 'invalid_type' as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });
});

// ---------------------------------------------------------------------------
// deleteLocationImpl
// ---------------------------------------------------------------------------

describe('deleteLocationImpl', () => {
  it('deletes a location successfully', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const createResult = await createLocationImpl(client, {
      name: 'To Delete',
      type: 'in_person',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await deleteLocationImpl(client, createResult.locationId);
    expect(result.ok).toBe(true);

    // Verify it is gone
    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, createResult.locationId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns not_found for non-existent location', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await deleteLocationImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for location owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createLocationImpl(clientA, {
      name: 'Location of A',
      type: 'in_person',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to delete User A's location
    const clientB = fakeSupabaseClient(userB);
    const result = await deleteLocationImpl(clientB, createResult.locationId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('blocks deletion when location has linked sessions', async () => {
    const userId = randomUUID();
    const locationId = randomUUID();
    await seedAuthUser(userId);

    // Seed location and a session that references it
    await runAsService(async (db) => {
      await db.insert(locations).values({
        id: locationId,
        userId,
        name: 'Linked Location',
        type: 'in_person',
      });

      await db.insert(sessions).values({
        userId,
        locationId,
        startAt: new Date('2026-01-15T10:00:00Z'),
        endAt: new Date('2026-01-15T10:50:00Z'),
        durationMinutes: 50,
        status: 'scheduled',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await deleteLocationImpl(client, locationId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('has_linked_sessions');
    if (result.error !== 'has_linked_sessions') return;
    expect(result.message).toBe(
      'Este local está vinculado a sessões. Remova o vínculo antes de excluir.',
    );

    // Verify location still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, locationId));
    });
    expect(rows).toHaveLength(1);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await deleteLocationImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// Default toggle
// ---------------------------------------------------------------------------

describe('default toggle', () => {
  it('clears previous default when creating a new default location', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create first location as default
    const first = await createLocationImpl(client, {
      name: 'First Default',
      type: 'in_person',
      is_default: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Verify it is default
    const rowsAfterFirst = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, first.locationId));
    });
    expect(rowsAfterFirst[0]!.isDefault).toBe(true);

    // Create second location as default
    const second = await createLocationImpl(client, {
      name: 'Second Default',
      type: 'online',
      is_default: true,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The first should no longer be default
    const rowsFirst = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, first.locationId));
    });
    expect(rowsFirst[0]!.isDefault).toBe(false);

    // The second should be default
    const rowsSecond = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, second.locationId));
    });
    expect(rowsSecond[0]!.isDefault).toBe(true);
  });

  it('clears previous default when updating a location to default', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create two locations, first as default
    const first = await createLocationImpl(client, {
      name: 'Default One',
      type: 'in_person',
      is_default: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await createLocationImpl(client, {
      name: 'Not Default',
      type: 'online',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Update second to be default
    const updateResult = await updateLocationImpl(client, second.locationId, {
      name: 'Not Default',
      type: 'online',
      is_default: true,
    });
    expect(updateResult.ok).toBe(true);

    // First should no longer be default
    const rowsFirst = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, first.locationId));
    });
    expect(rowsFirst[0]!.isDefault).toBe(false);

    // Second should be default
    const rowsSecond = await runAsService(async (db) => {
      return db.select().from(locations).where(eq(locations.id, second.locationId));
    });
    expect(rowsSecond[0]!.isDefault).toBe(true);
  });

  it('default location appears first in list', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create non-default first (alphabetically first)
    await createLocationImpl(client, { name: 'AAA Non-Default', type: 'in_person' });
    // Create default second (alphabetically later)
    await createLocationImpl(client, {
      name: 'ZZZ Default',
      type: 'online',
      is_default: true,
    });

    const result = await listLocationsImpl(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Default should come first despite being alphabetically later
    expect(result.locations[0]!.name).toBe('ZZZ Default');
    expect(result.locations[0]!.isDefault).toBe(true);
    expect(result.locations[1]!.name).toBe('AAA Non-Default');
    expect(result.locations[1]!.isDefault).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RLS cross-user isolation
// ---------------------------------------------------------------------------

describe('RLS cross-user isolation', () => {
  it('psychologist A does not see locations of psychologist B', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const clientB = fakeSupabaseClient(userB);

    // Each user creates a location
    await createLocationImpl(clientA, { name: 'Location of A', type: 'in_person' });
    await createLocationImpl(clientB, { name: 'Location of B', type: 'online' });

    // User A lists — should only see their own
    const resultA = await listLocationsImpl(clientA);
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.locations).toHaveLength(1);
    expect(resultA.locations[0]!.name).toBe('Location of A');

    // User B lists — should only see their own
    const resultB = await listLocationsImpl(clientB);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.locations).toHaveLength(1);
    expect(resultB.locations[0]!.name).toBe('Location of B');
  });
});

// ---------------------------------------------------------------------------
// Full CRUD flow
// ---------------------------------------------------------------------------

describe('full CRUD flow', () => {
  it('create → list → update → delete lifecycle', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create
    const createResult = await createLocationImpl(client, {
      name: 'Lifecycle Location',
      type: 'in_person',
      address: 'Rua Teste, 123',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // List — should contain the created location
    const listResult = await listLocationsImpl(client);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.locations).toHaveLength(1);
    expect(listResult.locations[0]!.name).toBe('Lifecycle Location');

    // Update — change name
    const updateResult = await updateLocationImpl(client, createResult.locationId, {
      name: 'Updated Lifecycle',
      type: 'online',
    });
    expect(updateResult.ok).toBe(true);

    // Verify update
    const listAfterUpdate = await listLocationsImpl(client);
    expect(listAfterUpdate.ok).toBe(true);
    if (!listAfterUpdate.ok) return;
    expect(listAfterUpdate.locations[0]!.name).toBe('Updated Lifecycle');
    expect(listAfterUpdate.locations[0]!.type).toBe('online');

    // Delete
    const deleteResult = await deleteLocationImpl(client, createResult.locationId);
    expect(deleteResult.ok).toBe(true);

    // List — should be empty
    const listAfterDelete = await listLocationsImpl(client);
    expect(listAfterDelete.ok).toBe(true);
    if (!listAfterDelete.ok) return;
    expect(listAfterDelete.locations).toHaveLength(0);
  });
});
