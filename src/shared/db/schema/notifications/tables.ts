import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// `notifications` stores in-app notifications for psychologists. Each row
// represents a single notification triggered by a background event (e.g.,
// patient confirmed/cancelled via WhatsApp, reminder delivery failed).
//
// The table is owner-scoped via RLS — every row is tied to a single `user_id`
// (the psychologist's `auth.users.id`). Background jobs (Inngest functions)
// write to this table using the service-role client, which bypasses RLS.
//
// The `type` column uses a short discriminator string (e.g.,
// 'session_confirmed', 'reminder_failed') to allow filtering and routing on
// the client side.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in the
    // migration (same pattern as patients.user_id, consent_terms.user_id).
    userId: uuid('user_id').notNull(),

    // Discriminator for notification kind — kept short for indexing.
    type: varchar('type', { length: 50 }).notNull(),

    // Human-readable title shown in the notification bell / list (PT-BR).
    title: varchar('title', { length: 200 }).notNull(),

    // Optional longer body with details.
    body: text('body'),

    // Optional deep-link URL (e.g., /app/agenda?session=<id>).
    actionUrl: text('action_url'),

    // Set when the psychologist marks the notification as read (null = unread).
    readAt: timestamp('read_at', { withTimezone: true }),

    // Immutable creation timestamp.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Primary query: "unread notifications for this psychologist, newest first".
    index('notifications_user_id_read_at_idx').on(table.userId, table.readAt),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
