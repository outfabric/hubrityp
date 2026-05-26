import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// `rate_limits` is a lightweight infrastructure table backing the
// Postgres-based rate limiter (`src/shared/lib/rate-limit/postgres.ts`).
//
// The design uses a sliding-window counter with an atomic UPSERT:
//   - `key` is the composite limiter identity (e.g. "upload:<userId>").
//   - `window_start` marks when the current counting window began.
//   - `count` is the number of hits recorded inside that window.
//
// Each UPSERT atomically increments or resets the counter, so concurrent
// requests against the same key are safe without external locking.
//
// RLS: enabled with service-role-only policies. This table is never
// accessed by user-scoped Supabase clients — the app-level Drizzle client
// (which runs as the database superuser) is the only writer/reader.
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  count: integer('count').notNull().default(1),
});

export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
