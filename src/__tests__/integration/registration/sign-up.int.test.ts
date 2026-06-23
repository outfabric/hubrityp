import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authLogs, profiles } from '@/shared/db/schema/auth/tables';
import { PENDING_EMAIL_COOKIE_NAME, readPendingEmail } from '@/shared/lib/cookies/pending-email';

import { runAsService } from '../setup/run-as-service';

import { signupInputFactory } from './factories/signup-input';

// `signUpImpl` is exercised against a fake Supabase Auth surface whose
// `auth.signUp` performs the real `auth.users` INSERT inside our
// integration container. That makes the SECURITY DEFINER trigger
// `handle_new_user()` fire on real Postgres — so the duplicate-CRP
// rollback, the trigger metadata-validation, and the unique-violation
// surface are all exercised end-to-end against the schema and policies
// from section 2.
//
// What is mocked vs real:
//   • `createServerClient`  (mocked) — wraps a fake `auth.signUp` that
//     INSERTs into `auth.users`; bypasses GoTrue (not running in the
//     test container) without bypassing the trigger or the DB.
//   • `@supabase/supabase-js`'s `createClient` (mocked) — admin client
//     used only by the `auth.admin.deleteUser` rollback path; the mock
//     issues a real DELETE on `auth.users`.
//   • `next/navigation` `redirect` — left UNMOCKED so the real
//     NEXT_REDIRECT marker is thrown on success and we can assert the
//     target via the digest.
//   • `next/headers` `headers` — left UNMOCKED; `signUpImpl` and
//     `logAuthEvent` already handle a missing request context
//     gracefully (try/catch fall-through to the localhost origin / null
//     IP), so we don't need a stub.
//   • The real `authLogs` table is queried directly via Drizzle to
//     assert the audit row landed for each branch.

// `auth.users` is the real Supabase-managed identity table; our test
// container provisions a minimal subset of its surface in
// `bootstrapAuthSchema`. Each mocked supabase helper INSERTs / DELETEs
// against it directly so the trigger and FK relationships fire.
type AuthUserRow = {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  raw_user_meta_data: unknown;
};

const supabaseAuthSignUpMock = vi.fn();
const supabaseAuthSignOutMock = vi.fn();
const supabaseAuthAdminDeleteUserMock = vi.fn();
const adminCreateClientMock = vi.fn();

// In-memory cookie store backing the mocked `next/headers` `cookies()`.
// The success path calls `setPendingEmailCookie(await cookies(), email)`,
// so the real (HMAC-signing) helper runs against this store and we can read
// back the persisted value to assert the cookie is present, hardened, and
// signature-valid via `readPendingEmail`. Failure branches never call
// `cookies().set`, so an absent entry proves "no cookie".
const cookieStore = new Map<string, { value: string; options?: Record<string, unknown> }>();

const cookiesMock = {
  set: (name: string, value: string, options?: Record<string, unknown>): void => {
    cookieStore.set(name, { value, options });
  },
  get: (name: string): { value: string } | undefined => {
    const entry = cookieStore.get(name);
    return entry ? { value: entry.value } : undefined;
  },
};

// `cookies` is mocked so the success-path `setPendingEmailCookie` writes to
// our capturable store; `headers` stays a real empty Headers so the
// origin/IP fall-throughs in `signUpImpl` / `logAuthEvent` behave as in the
// no-request-context case.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(cookiesMock),
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// `signOut` is invoked defensively by every failure branch of `signUpImpl`
// to guard against the Supabase email-obfuscation edge case where a
// session cookie is attached to the response despite the signup being
// rejected. The mock returns the typed `{ error: null }` envelope the SDK
// promises so the wrapper's `try/catch` does not trip.
vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: supabaseAuthSignUpMock,
      signOut: supabaseAuthSignOutMock,
    },
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]): unknown => adminCreateClientMock(...args) as unknown,
}));

beforeEach(() => {
  supabaseAuthSignUpMock.mockReset();
  supabaseAuthSignOutMock.mockReset();
  supabaseAuthAdminDeleteUserMock.mockReset();
  adminCreateClientMock.mockReset();
  supabaseAuthSignOutMock.mockResolvedValue({ error: null });
  cookieStore.clear();

  // Default admin-client shim: `auth.admin.deleteUser` performs a real
  // DELETE on `auth.users`. The cascade FK on `profiles.user_id` will
  // remove any orphan profile if it exists.
  adminCreateClientMock.mockReturnValue({
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          await runAsService(async (db) => {
            await db.execute(dsql`DELETE FROM auth.users WHERE id = ${id}`);
          });
          supabaseAuthAdminDeleteUserMock(id);
          return { data: { user: { id } }, error: null };
        },
      },
    },
  });

  // Default `auth.signUp` shim: insert a real row into `auth.users` so
  // the trigger materializes `profiles`. Tests override this to stage
  // failure scenarios.
  //
  // postgres-js errors carry the SQLSTATE in `err.code` and the
  // constraint name (when applicable) in `err.constraint_name`. The
  // wrapped `.message` shows the original SQL only — we read the
  // structured fields instead so the mock matches the shape Supabase
  // Auth's REST surface emits.
  supabaseAuthSignUpMock.mockImplementation(
    async ({ email, options }: { email: string; options: { data: Record<string, unknown> } }) => {
      const id = randomUUID();
      try {
        await runAsService(async (db) => {
          await db.execute(
            dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${id}, ${email}, ${JSON.stringify(
              options.data,
            )}::jsonb)`,
          );
        });
        return { data: { user: { id, email } }, error: null };
      } catch (err) {
        // postgres-js wraps DB errors: the outer Error carries `query`
        // + `params` + `cause`, where `cause` is the original
        // PostgresError with `.code`, `.constraint_name`, etc.
        const errRecord = err as Record<string, unknown>;
        const cause = (errRecord.cause as Record<string, unknown> | undefined) ?? errRecord;
        const code = (cause.code as string | undefined) ?? '';
        const constraint =
          (cause.constraint_name as string | undefined) ??
          (cause.constraint as string | undefined) ??
          '';
        const causeMessage =
          cause instanceof Error ? cause.message : ((cause.message as string | undefined) ?? '');
        const message = causeMessage || (err instanceof Error ? err.message : String(err));
        const detail = (cause.detail as string | undefined) ?? '';
        const combined = `${message} ${detail} ${constraint}`;

        // 23505 = unique_violation. CRP-uniqueness raises this from
        // inside the SECURITY DEFINER trigger transaction.
        if (code === '23505' && /profiles_crp_number_crp_uf_unique/.test(combined)) {
          return {
            data: { user: null },
            error: {
              code: '23505',
              message: `${message} -- constraint: ${constraint || 'profiles_crp_number_crp_uf_unique'}`,
              name: 'AuthApiError',
            },
          };
        }
        // Email-uniqueness on auth.users (if a unique index existed in
        // the test container — the bootstrapped surface today doesn't
        // add one, but we keep the branch for completeness).
        if (code === '23505' && /users_email|auth_users_email/.test(combined)) {
          return {
            data: { user: null },
            error: {
              code: 'user_already_exists',
              message: 'User already exists',
              name: 'AuthApiError',
            },
          };
        }

        // Fall-through: surface as an unknown auth error.
        return {
          data: { user: null },
          error: { code, message, name: 'AuthApiError' },
        };
      }
    },
  );
});

afterEach(async () => {
  vi.resetModules();
  // Test isolation: wipe the auth.users + audit rows we created.
  // `profiles` cascades from `auth.users`, so deleting users is enough.
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
    await db.execute(dsql`DELETE FROM auth_logs`);
  });
});

describe('signUpImpl Server Action (integration)', () => {
  describe('happy path', () => {
    it('inserts auth.users + materializes profiles via the trigger and writes signup_success log', async () => {
      const payload = signupInputFactory.build();
      const formData = signupInputFactory.toFormData(payload);

      const { signUpImpl } = await import('@/modules/registration/server/sign-up');

      let caught: unknown = null;
      try {
        await signUpImpl(formData);
      } catch (err) {
        caught = err;
      }

      // Successful signups end with `redirect('/verifique-email')`, which
      // throws a NEXT_REDIRECT marker. Asserting the digest pins both the
      // success branch AND the public redirect target (NOT the
      // session-gated `/onboarding/pending`, which an anonymous post-signup
      // request cannot reach).
      const digest = (caught as { digest?: string } | null)?.digest ?? '';
      expect(digest.startsWith('NEXT_REDIRECT')).toBe(true);
      expect(digest).toContain('/verifique-email');
      expect(digest).not.toContain('/onboarding/pending');

      // The success path set a signed, hardened `pending-email` cookie
      // BEFORE redirecting. We assert it is present, security-hardened, and
      // signature-valid (its value round-trips through `readPendingEmail`
      // to exactly the submitted email — proving the HMAC is correct).
      const cookieEntry = cookieStore.get(PENDING_EMAIL_COOKIE_NAME);
      expect(cookieEntry).toBeDefined();
      expect(cookieEntry!.options).toMatchObject({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1_800,
      });
      expect(readPendingEmail(cookiesMock)).toBe(payload.email);

      // The `auth.users` row exists with the metadata our action stamped.
      const inserted = await runAsService(async (db) => {
        const rows = await db.execute<AuthUserRow>(
          dsql`SELECT id, email, email_confirmed_at, raw_user_meta_data FROM auth.users WHERE email = ${String(
            payload.email,
          )}`,
        );
        return rows;
      });
      expect(inserted).toHaveLength(1);
      const userRow = inserted[0]!;
      expect(userRow.email_confirmed_at).toBeNull();
      const meta = userRow.raw_user_meta_data as Record<string, unknown>;
      expect(meta.crpNumber).toBe(payload.crpNumber);
      expect(meta.crpUf).toBe(payload.crpUf);

      // The trigger materialized the `profiles` row with the spec's
      // initial status and mirrored the CRP fields.
      const [profile] = await runAsService(async (db) =>
        db.select().from(profiles).where(eq(profiles.userId, userRow.id)),
      );
      expect(profile).toBeDefined();
      expect(profile!.status).toBe('pending_verification');
      expect(profile!.crpNumber).toBe(payload.crpNumber);
      expect(profile!.crpUf).toBe(payload.crpUf);
      expect(profile!.email).toBe(payload.email);
      expect(profile!.fullName).toBe(payload.fullName);

      // Audit log row recorded the success with metadata that mirrors
      // the CRP fields (no PII).
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.userId, userRow.id)),
      );
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0]!;
      expect(audit.event).toBe('signup_success');
      const auditMeta = audit.metadata as Record<string, unknown>;
      expect(auditMeta.crpNumber).toBe(payload.crpNumber);
      expect(auditMeta.crpUf).toBe(payload.crpUf);
    });
  });

  describe('invalid input', () => {
    it('returns invalid_input with field errors and never touches the database', async () => {
      // Drop the `acceptedTerms` consent so the schema fails. The action
      // MUST short-circuit before any DB or Supabase Auth call.
      const payload = signupInputFactory.build({ acceptedTerms: undefined });
      const formData = signupInputFactory.toFormData(payload);

      const { signUpImpl } = await import('@/modules/registration/server/sign-up');
      const result = await signUpImpl(formData);

      expect(result).toEqual({
        ok: false,
        error: 'invalid_input',
        fieldErrors: expect.objectContaining({ acceptedTerms: expect.any(Array) }),
      });
      expect(supabaseAuthSignUpMock).not.toHaveBeenCalled();

      // Failure branches MUST NOT set the pending-email cookie — only the
      // success path may. A forged/stray cookie on a failed signup would
      // let the public confirmation page send mail for an address the user
      // never actually registered.
      expect(cookieStore.get(PENDING_EMAIL_COOKIE_NAME)).toBeUndefined();

      // No row landed for this email in either table.
      const rows = await runAsService(async (db) =>
        db.execute<AuthUserRow>(
          dsql`SELECT id FROM auth.users WHERE email = ${String(payload.email)}`,
        ),
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('duplicate email', () => {
    it('returns duplicate_email and writes a signup_failure_duplicate_email audit row', async () => {
      // Stage `auth.signUp` to return the typed Supabase duplicate-email
      // error WITHOUT inserting a row, mirroring how GoTrue rejects a
      // re-registration attempt.
      supabaseAuthSignUpMock.mockResolvedValueOnce({
        data: { user: null },
        error: {
          code: 'user_already_exists',
          message: 'User already registered',
          name: 'AuthApiError',
        },
      });

      const payload = signupInputFactory.build({ email: 'taken@test.local' });
      const formData = signupInputFactory.toFormData(payload);

      const { signUpImpl } = await import('@/modules/registration/server/sign-up');
      const result = await signUpImpl(formData);

      expect(result).toEqual({ ok: false, error: 'duplicate_email' });

      // The duplicate-email branch MUST NOT set the pending-email cookie.
      expect(cookieStore.get(PENDING_EMAIL_COOKIE_NAME)).toBeUndefined();

      // Defensive cleanup: the duplicate-email branch MUST call
      // `auth.signOut` so a session cookie attached by Supabase under
      // email-obfuscation cannot leak to a stranger. This is the
      // load-bearing assertion of the HIGH-2 fix — if a future refactor
      // drops the `signOut`, this test catches it.
      expect(supabaseAuthSignOutMock).toHaveBeenCalledTimes(1);

      // Audit row records the failure. `userId` is null (no auth.users
      // was created) — the row is still useful for probing detection.
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.event, 'signup_failure_duplicate_email')),
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.userId).toBeNull();
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      // emailHash is hex sha256 — 64 chars — and the raw email NEVER
      // appears in the metadata payload. We assert both.
      expect(typeof meta.emailHash).toBe('string');
      expect((meta.emailHash as string).length).toBe(64);
      expect(JSON.stringify(meta)).not.toContain('taken@test.local');
    });
  });

  describe('duplicate CRP', () => {
    it('rolls back the auth.users insert and writes signup_failure_duplicate_crp', async () => {
      const sharedCrp = signupInputFactory.uniqueCrpNumber('06');

      // First signup succeeds (real INSERT into auth.users + profiles).
      const firstPayload = signupInputFactory.build({ crpNumber: sharedCrp, crpUf: 'SP' });
      const firstFormData = signupInputFactory.toFormData(firstPayload);

      const { signUpImpl } = await import('@/modules/registration/server/sign-up');
      try {
        await signUpImpl(firstFormData);
      } catch {
        // expected NEXT_REDIRECT
      }

      const usersBefore = await runAsService(async (db) =>
        db.execute<AuthUserRow>(dsql`SELECT id FROM auth.users`),
      );
      expect(usersBefore).toHaveLength(1);

      // Reset the captured cookie so we isolate the SECOND signup's
      // behavior: the first (successful) signup legitimately set the
      // pending-email cookie; we now prove the failing branch leaves none.
      cookieStore.clear();

      // Second signup with the SAME CRP should be rejected by the
      // unique-violation on `(crp_number, crp_uf)` raised inside the
      // trigger transaction. `signUpImpl` MUST map this to
      // `duplicate_crp` and the rollback MUST leave `auth.users`
      // unchanged (no orphan row).
      const secondPayload = signupInputFactory.build({ crpNumber: sharedCrp, crpUf: 'SP' });
      const secondFormData = signupInputFactory.toFormData(secondPayload);

      const result = await signUpImpl(secondFormData);
      expect(result).toEqual({ ok: false, error: 'duplicate_crp' });

      // The duplicate-CRP branch MUST NOT set the pending-email cookie.
      expect(cookieStore.get(PENDING_EMAIL_COOKIE_NAME)).toBeUndefined();

      // No orphan: auth.users still holds exactly the row from the
      // first (successful) signup. The trigger-raised exception rolls
      // back the entire signup transaction at the database layer; the
      // best-effort `admin.deleteUser` would also clean up if Supabase
      // had left a partial row.
      const usersAfter = await runAsService(async (db) =>
        db.execute<AuthUserRow>(dsql`SELECT id, email FROM auth.users`),
      );
      expect(usersAfter).toHaveLength(1);
      expect(usersAfter[0]!.email).toBe(firstPayload.email);

      // Audit row recorded the duplicate-CRP attempt.
      const auditRows = await runAsService(async (db) =>
        db.select().from(authLogs).where(eq(authLogs.event, 'signup_failure_duplicate_crp')),
      );
      expect(auditRows).toHaveLength(1);
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.crpNumber).toBe(sharedCrp);
      expect(meta.crpUf).toBe('SP');
    });
  });

  describe('unknown supabase error', () => {
    it('returns unknown and sets no pending-email cookie', async () => {
      // Stage an unrecognized Supabase Auth error (neither duplicate-email
      // nor duplicate-CRP) so `signUpImpl` falls through to the `unknown`
      // branch without inserting a row.
      supabaseAuthSignUpMock.mockResolvedValueOnce({
        data: { user: null },
        error: {
          code: 'unexpected_failure',
          message: 'Internal Server Error',
          name: 'AuthApiError',
        },
      });

      const payload = signupInputFactory.build();
      const formData = signupInputFactory.toFormData(payload);

      const { signUpImpl } = await import('@/modules/registration/server/sign-up');
      const result = await signUpImpl(formData);

      expect(result).toEqual({ ok: false, error: 'unknown' });

      // The unknown branch MUST NOT set the pending-email cookie.
      expect(cookieStore.get(PENDING_EMAIL_COOKIE_NAME)).toBeUndefined();
    });
  });

  describe('trigger metadata-missing', () => {
    it('aborts the auth.users insert when raw_user_meta_data is missing required fields', async () => {
      // Bypass `signUpImpl` entirely — call the same path Supabase Auth
      // would use when an admin creates a user without the metadata
      // stamping our Server Action does. The trigger MUST raise an
      // exception that rolls back the entire transaction.
      const id = randomUUID();
      const email = signupInputFactory.uniqueEmail();

      let caught: unknown = null;
      try {
        await runAsService(async (db) => {
          await db.execute(
            // Empty metadata: no fullName/crpNumber/crpUf/...
            dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${id}, ${email}, '{}'::jsonb)`,
          );
        });
      } catch (err) {
        caught = err;
      }

      // postgres-js may format the error in slightly different shapes
      // across versions; the behavioural contract is what matters —
      // the trigger raised AND the entire transaction rolled back.
      // We pin "rolled back" by asserting the state below; the throw
      // here is the signal that the trigger's `RAISE EXCEPTION` fired.
      expect(caught).toBeInstanceOf(Error);

      // No partial row remained: neither auth.users nor profiles holds
      // the would-be user. The transaction-level rollback is what
      // protects production against a half-bound signup.
      const userRows = await runAsService(async (db) =>
        db.execute<AuthUserRow>(dsql`SELECT id FROM auth.users WHERE id = ${id}`),
      );
      expect(userRows).toHaveLength(0);

      const profileRows = await runAsService(async (db) =>
        db.select().from(profiles).where(eq(profiles.userId, id)),
      );
      expect(profileRows).toHaveLength(0);
    });
  });
});
