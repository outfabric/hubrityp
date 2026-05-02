import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// `health_pings` is the canonical owner-scoped table that exercises the
// project-wide RLS template. Every future domain table MUST follow the same
// shape:
//   - `owner_id uuid` referencing `auth.users`
//   - RLS enabled with the four owner-scoped policies declared in
//     `db/schema/<domain>/policies.ts` and appended manually to the generated
//     migration (Drizzle has no first-class RLS DSL).
// See `db/migrations/README.md` for the canonical template.
export const healthPings = pgTable('health_pings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  note: text('note'),
});

export type HealthPing = typeof healthPings.$inferSelect;
export type NewHealthPing = typeof healthPings.$inferInsert;
