import { sql } from 'drizzle-orm';
import {
  boolean,
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
    // 'confirmacao_recebida', 'cancelamento_aviso', 'link_video', 'termo_consentimento')
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
    unique('message_templates_user_id_template_key_unique').on(
      table.userId,
      table.templateKey,
    ),
  ],
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
