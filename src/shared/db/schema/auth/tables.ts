import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `profiles`, `auth_logs`, `auth_sessions` are the auth-domain tables
// introduced by the `auth-account-creation` change. Each one is a child of
// `auth.users` (the Supabase-managed identity table), which lives in the
// `auth` schema and is therefore NOT modeled as a Drizzle table here. The
// FK from `user_id` to `auth.users(id)` is emitted as raw SQL by the
// migration generator since we cannot use `references(() => authUsers.id)`
// without bringing the cross-schema definition into Drizzle's surface.
//
// RLS is enabled and the user-side policies live in
// `src/shared/db/schema/auth/policies.ts`. Direct INSERT into `profiles` is
// blocked for end-users — the SECURITY DEFINER trigger
// `public.handle_new_user()` is the only user-visible writer.
export const profiles = pgTable(
  'profiles',
  {
    // PK = FK. There is no separate `id` column. Cascading the delete makes
    // the duplicate-CRP rollback flow (`supabase.auth.admin.deleteUser`) clean
    // up the orphan profile automatically.
    userId: uuid('user_id').primaryKey(),
    // Mirror of `auth.users.email`. Kept in sync by the trigger so that
    // RLS-scoped queries (which only see `public.profiles`, not
    // `auth.users`) can read the email without a cross-schema join.
    email: text('email').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    crpNumber: varchar('crp_number', { length: 20 }).notNull(),
    crpUf: char('crp_uf', { length: 2 }).notNull(),
    crpValidatedAt: timestamp('crp_validated_at', { withTimezone: true }),
    // Admin who validated the CRP. Nullable until validation occurs. No FK
    // here because the admin domain is out of scope for this change.
    crpValidatedBy: uuid('crp_validated_by'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    // CHECK constraint enforced via raw SQL in the migration so the enum
    // stays in lockstep with the trigger functions and the auth Server
    // Actions. Drizzle's `text` type is the right shape; the CHECK is
    // emitted alongside table creation.
    status: text('status').notNull().default('pending_verification'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }).notNull(),
    sensitiveDataConsentAt: timestamp('sensitive_data_consent_at', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Server-side throttle for `resendVerificationEmail`. Stamped to `now()`
    // every time we successfully ask GoTrue to resend the signup email; the
    // Server Action refuses (with `rate_limited`) any call that arrives
    // within 60s of the previous one. Nullable because the column is
    // empty until the user actually requests a resend. The client-side
    // 60s cooldown remains for UX, but cannot be bypassed by a refresh
    // because the gate now lives in the database.
    lastResendAt: timestamp('last_resend_at', { withTimezone: true }),
    // --- Login hardening columns (section 1, change auth-login-hardening) ---
    // Tracks consecutive failed login attempts. Reset to 0 on successful login.
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    // Timestamp of the most recent failed login attempt. Nullable until first failure.
    lastFailedLoginAt: timestamp('last_failed_login_at', { withTimezone: true }),
    // When set and in the future, the account is temporarily locked out.
    lockoutUntil: timestamp('lockout_until', { withTimezone: true }),
    // How many times the account has been locked out in succession (escalates duration).
    consecutiveLockouts: integer('consecutive_lockouts').notNull().default(0),
    // When true, the user must reset their password before regaining access.
    requiresPasswordReset: boolean('requires_password_reset').notNull().default(false),
    // --- Onboarding + NPS columns (change onboarding-data-model) ---
    // Current step in the guided onboarding flow. Defaults to 'welcome' for
    // every new profile. The valid-value set is enforced by a CHECK constraint
    // emitted in the migration so the enum stays in lockstep with the
    // onboarding state machine.
    onboardingStep: text('onboarding_step').notNull().default('welcome'),
    // Stamped when the user finishes the onboarding flow. Nullable until done.
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    // Stamped when the user finishes the in-app product tour. Nullable until done.
    tourCompletedAt: timestamp('tour_completed_at', { withTimezone: true }),
    // Stamped on the first authenticated dashboard render. Nullable until then.
    firstAccessAt: timestamp('first_access_at', { withTimezone: true }),
    // Stamped when a cancelled account is reactivated. Nullable until then.
    reactivatedAt: timestamp('reactivated_at', { withTimezone: true }),
    // NPS rating (0-10). The 0..10 range is enforced by a CHECK constraint in
    // the migration. Nullable until the user responds to the NPS survey.
    npsScore: integer('nps_score'),
    // Free-text NPS feedback. May contain incidental PII — owner-scoped via RLS
    // and MUST NEVER be logged. Nullable until the user responds.
    npsFeedback: text('nps_feedback'),
    // Stamped when the user submits an NPS response. Nullable until then.
    npsRespondedAt: timestamp('nps_responded_at', { withTimezone: true }),
  },
  (table) => [
    // CRP is unique per UF (a psychologist registered in SP and another in
    // RJ may share a number). The Server Action maps unique-violation on
    // this constraint to the `duplicate_crp` user-visible error.
    unique('profiles_crp_number_crp_uf_unique').on(table.crpNumber, table.crpUf),
  ],
);

// Inferred row shape for `profiles`. Includes the auth-account-creation
// columns, the login-hardening columns (auth-login-hardening), and the
// onboarding/NPS columns (onboarding-data-model): `onboardingStep`,
// `onboardingCompletedAt`, `tourCompletedAt`, `firstAccessAt`,
// `reactivatedAt`, `npsScore`, `npsFeedback`, `npsRespondedAt`. Note that
// `npsFeedback` is free text that may contain incidental PII — never log it.
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

// `auth_logs` records every authentication-related event (signup, signin,
// signout, email-confirmation, password-reset, etc.). The service role is
// the only writer; end-users can only SELECT their own rows.
export const authLogs = pgTable(
  'auth_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable because failed signups never produced an `auth.users` row;
    // we still want to log the attempt. ON DELETE SET NULL preserves the
    // audit trail when a user is later deleted.
    userId: uuid('user_id'),
    event: text('event').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Compound index for audit queries: "all events for user X, most recent
    // first". The DESC ordering on `created_at` matches the predominant
    // query shape in the audit dashboard.
    index('auth_logs_user_event_created_at_idx').on(
      table.userId,
      table.event,
      table.createdAt.desc(),
    ),
  ],
);

export type AuthLog = typeof authLogs.$inferSelect;
export type NewAuthLog = typeof authLogs.$inferInsert;

// `auth_sessions` mirrors active Supabase sessions for the user-visible
// "active sessions" screen. The service role is the only writer; end-users
// can only SELECT their own rows.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('auth_sessions_user_created_at_idx').on(table.userId, table.createdAt.desc())],
);

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;

// `oauth_identities` stores linked OAuth provider accounts for each user.
// The table is write-protected at the RLS layer — only the service role can
// INSERT/UPDATE/DELETE. End-users can SELECT their own rows only.
export const oauthIdentities = pgTable(
  'oauth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to `auth.users`. The cross-schema reference is emitted manually in
    // the migration (same pattern as `profiles.user_id`).
    userId: uuid('user_id').notNull(),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('oauth_identities_provider_provider_user_id_unique').on(
      table.provider,
      table.providerUserId,
    ),
    index('oauth_identities_user_id_idx').on(table.userId),
  ],
);

export type OauthIdentity = typeof oauthIdentities.$inferSelect;
export type NewOauthIdentity = typeof oauthIdentities.$inferInsert;
