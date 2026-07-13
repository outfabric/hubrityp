import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `whatsapp_accounts` stores the BSP connection for each psychologist.
// Currently Twilio is the sole BSP — the `provider` column is pinned to
// 'twilio' via CHECK constraint in the migration. One account per
// psychologist is enforced by a UNIQUE constraint on `user_id`.
//
// `consent_given_at` records the moment the psychologist explicitly opted
// in to WhatsApp integration (LGPD lawful basis). `last_health_check_at`
// is updated by the periodic Inngest health-check job.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const whatsappAccounts = pgTable('whatsapp_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),

  // FK to `auth.users`. Cross-schema reference emitted manually in migration.
  // UNIQUE constraint enforces one account per psychologist.
  userId: uuid('user_id').notNull().unique(),

  // CHECK constraint in migration: provider IN ('twilio')
  provider: text('provider').notNull().default('twilio'),

  // Twilio sender SID (e.g., "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
  accountId: varchar('account_id', { length: 255 }).notNull(),

  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  displayName: varchar('display_name', { length: 120 }),

  // CHECK constraint in migration: status IN ('active', 'disconnected', 'error')
  status: text('status').notNull().default('active'),

  // LGPD lawful basis — the moment the psychologist consented to the integration
  consentGivenAt: timestamp('consent_given_at', { withTimezone: true }).notNull(),

  connectedAt: timestamp('connected_at', { withTimezone: true }).default(sql`now()`),
  lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;
export type NewWhatsappAccount = typeof whatsappAccounts.$inferInsert;

// `message_templates` stores WhatsApp message templates per psychologist.
// Each template has a `template_key` identifying its purpose (e.g.,
// 'lembrete_24h', 'link_video') and a `body` with the template text.
// The `variables` JSONB column lists placeholders extracted from `body`.
//
// `meta_template_id` maps to the Twilio Content SID once the template is
// registered. `meta_status` tracks the Meta/WhatsApp approval lifecycle.
// `is_default` marks templates that were seeded by the system (vs.
// customized by the psychologist).
//
// A composite UNIQUE on (user_id, template_key) ensures each psychologist
// has at most one template per key.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // CHECK constraint in migration: template_key IN ('lembrete_24h', 'lembrete_2h',
    // 'cancelamento_aviso', 'link_video', 'termo_consentimento')
    // ('confirmacao_recebida' was removed — the confirmation ack is a free-form
    //  message, not a template type. See migration 0043.)
    templateKey: varchar('template_key', { length: 50 }).notNull(),

    body: text('body').notNull(),

    // JSON array of variable names found in the template body
    variables: jsonb('variables')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Twilio Content SID — populated after template is registered with Twilio
    metaTemplateId: varchar('meta_template_id', { length: 255 }),

    // CHECK constraint in migration: meta_status IN ('approved', 'pending', 'rejected')
    metaStatus: text('meta_status').default('pending'),

    isDefault: boolean('is_default').default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Each psychologist can have at most one template per key.
    unique('message_templates_user_id_template_key_unique').on(table.userId, table.templateKey),
  ],
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;

// `reminder_settings` stores per-psychologist preferences for appointment
// reminders sent via WhatsApp. One row per psychologist (UNIQUE on `user_id`).
//
// `early_reminder_hours` / `final_reminder_hours` control when the first
// (e.g., 24h before) and final (e.g., 2h before) reminders fire. NULL
// means the respective reminder is disabled.
//
// `video_link_minutes` controls how many minutes before an online session
// the video link is sent (default 30).
//
// `send_during_night` controls whether reminders can fire between 22:00
// and 07:00 — defaults to FALSE to respect patient rest hours.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const reminderSettings = pgTable('reminder_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  // FK to `auth.users`. Cross-schema reference emitted manually in migration.
  // UNIQUE constraint enforces one settings row per psychologist.
  userId: uuid('user_id').notNull().unique(),

  earlyReminderHours: integer('early_reminder_hours'),
  finalReminderHours: integer('final_reminder_hours'),

  videoLinkMinutes: integer('video_link_minutes').notNull().default(30),
  sendDuringNight: boolean('send_during_night').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type ReminderSettings = typeof reminderSettings.$inferSelect;
export type NewReminderSettings = typeof reminderSettings.$inferInsert;

// `whatsapp_messages` is the message log for every WhatsApp message sent
// or received by the system on behalf of a psychologist. Each row ties
// to a `user_id` (mandatory) and optionally to a `patient_id` and/or
// `session_id` for full traceability.
//
// `direction` is either 'outbound' (system → patient) or 'inbound'
// (patient → system). `status` tracks the BSP delivery lifecycle.
//
// `bsp_message_id` has a partial UNIQUE index (WHERE NOT NULL) because
// inbound messages may not have a BSP-assigned ID at insert time.
// `idempotency_key` has a partial UNIQUE index (WHERE status != 'failed'
// AND NOT NULL) to allow retries of failed sends with the same key.
//
// Indexes support the most common query patterns:
// - (user_id, created_at DESC) for the message log timeline
// - (session_id) for "all messages related to this session"
// - (patient_id, created_at DESC) for patient conversation history
//
// RLS policies: owner-scoped via `user_id = auth.uid()` for SELECT,
// INSERT, UPDATE. No DELETE — messages are an audit trail.
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients`. Nullable — some messages are not tied to a patient.
    patientId: uuid('patient_id'),

    // FK to `sessions`. Nullable — some messages are not tied to a session.
    sessionId: uuid('session_id'),

    // CHECK constraint in migration: direction IN ('outbound', 'inbound')
    direction: text('direction').notNull(),

    toPhone: varchar('to_phone', { length: 20 }),
    fromPhone: varchar('from_phone', { length: 20 }),

    body: text('body'),
    templateKey: varchar('template_key', { length: 50 }),

    // BSP-assigned message ID (e.g., Twilio Message SID)
    bspMessageId: varchar('bsp_message_id', { length: 255 }),

    // Client-generated idempotency key for deduplication
    idempotencyKey: varchar('idempotency_key', { length: 64 }),

    // CHECK constraint in migration:
    // status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'unable_to_send')
    status: text('status'),

    errorReason: text('error_reason'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),

    // Inbox: when the psychologist marked this message as read in the inbox UI
    readAtByPsychologist: timestamp('read_at_by_psychologist', { withTimezone: true }),

    // Inbox: when the psychologist resolved/closed this conversation thread item
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    // Risk detection: whether this message contains risk-related keywords
    riskFlag: boolean('risk_flag').notNull().default(false),

    // Risk detection: array of risk keywords detected in the message body
    riskKeywords: jsonb('risk_keywords').$type<string[]>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Message log timeline: "all messages for this user, newest first"
    index('whatsapp_messages_user_id_created_at_idx').on(table.userId, table.createdAt),
    // Session lookup: "all messages for this session"
    index('whatsapp_messages_session_id_idx').on(table.sessionId),
    // Patient conversation history: "all messages for this patient, newest first"
    index('whatsapp_messages_patient_id_created_at_idx').on(table.patientId, table.createdAt),
    // Thread queries: "all messages for this user+patient, newest first"
    index('whatsapp_messages_user_patient_created_at_idx').on(
      table.userId,
      table.patientId,
      table.createdAt,
    ),
  ],
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;

// `whatsapp_conversations` is a materialized aggregate table that stores
// one row per (psychologist, patient) pair. It is maintained by the Inngest
// `inbox-message-ingest` function via upsert on every inbound message.
//
// This table powers the inbox list UI — showing the latest message preview,
// unread count, and risk flag for each patient conversation.
//
// UNIQUE(user_id, patient_id) ensures one conversation per psychologist-patient
// pair.
//
// Indexes:
// - (user_id, last_message_at DESC) for the inbox list sorted by recency
// - (user_id, has_risk) for filtering conversations with risk flags
//
// FK constraints to auth.users, patients, and whatsapp_messages are added
// manually in the migration (cross-schema / cross-table references).
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // FK to `whatsapp_messages`. Emitted manually in migration.
    lastMessageId: uuid('last_message_id').notNull(),

    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),

    lastMessagePreview: varchar('last_message_preview', { length: 80 }).notNull(),

    unreadCount: integer('unread_count').notNull().default(0),

    hasRisk: boolean('has_risk').notNull().default(false),

    updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
  },
  (table) => [
    // One conversation per psychologist-patient pair
    unique('whatsapp_conversations_user_id_patient_id_unique').on(table.userId, table.patientId),
    // Inbox list: "all conversations for this user, newest first"
    index('whatsapp_conversations_user_id_last_message_at_idx').on(
      table.userId,
      table.lastMessageAt,
    ),
    // Risk filter: "all conversations with risk flags for this user"
    index('whatsapp_conversations_user_id_has_risk_idx').on(table.userId, table.hasRisk),
  ],
);

export type WhatsappConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsappConversation = typeof whatsappConversations.$inferInsert;
