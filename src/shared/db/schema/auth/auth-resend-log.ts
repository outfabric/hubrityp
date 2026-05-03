import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

// `auth_resend_log` records every verification-email resend issued by
// `resendVerificationEmail`. The Server Action consults this table to
// enforce the spec's "no more than 3 resends in 5 minutes per user" rule
// using a sliding-window query (`COUNT(*) WHERE sent_at > now() - interval
// '5 minutes'`). Persisting the log in Postgres — instead of an in-memory
// `Map` — keeps the rate limiter cluster-safe across the multiple Vercel
// lambda instances that may serve a single user's requests.
//
// The table is intentionally service-role only; the Server Action runs with
// the service-role admin client so it can both insert log rows and read
// across all users without RLS in the way. RLS is enabled with a single
// policy targeting `service_role` for the same legibility reason as
// `crp_validation_queue` (see `policies.ts`). `service_role` already
// bypasses RLS, but the explicit policy keeps the access model visible at
// review time and satisfies the policy-coverage integration test.
//
// The `(user_id, sent_at desc)` index keeps the rate-limit query cheap as
// the table grows: the Server Action's hot path is "give me the count of
// rows for this user within the last 5 minutes".
export const authResendLog = pgTable(
  'auth_resend_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Composite index optimised for the rate-limit query. Postgres returns
    // entries in `(user_id, sent_at DESC)` order so the planner can stop
    // scanning once it sees a row outside the 5-minute window.
    userSentAtIdx: index('auth_resend_log_user_id_sent_at_idx').on(
      table.userId,
      table.sentAt.desc(),
    ),
  }),
);

export type AuthResendLogRow = typeof authResendLog.$inferSelect;
export type NewAuthResendLogRow = typeof authResendLog.$inferInsert;
