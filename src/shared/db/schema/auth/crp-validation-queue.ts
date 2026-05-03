import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// `crp_validation_queue` records every CRP submission awaiting manual review
// by an admin. It is intentionally **service-role only** — `authenticated`
// users never read or write this table. RLS is enabled and the only policy
// targets `service_role`. See `./policies.ts` for the source of truth.
//
// The `(status, submitted_at)` index keeps the admin queue scan cheap as the
// table grows (the operational query is "give me the oldest pending rows").
export const crpValidationQueue = pgTable(
  'crp_validation_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    crpNumber: text('crp_number').notNull(),
    crpUf: text('crp_uf').notNull(),
    status: text('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    rejectionReason: text('rejection_reason'),
  },
  (table) => ({
    statusCheck: check(
      'crp_validation_queue_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    queueScanIdx: index('crp_validation_queue_status_submitted_at_idx').on(
      table.status,
      table.submittedAt,
    ),
  }),
);

export type CrpValidationQueueRow = typeof crpValidationQueue.$inferSelect;
export type NewCrpValidationQueueRow = typeof crpValidationQueue.$inferInsert;
