import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';
import { logger } from '@/shared/lib/logger';

import { type AccountStatus } from '../lib/state-machine';

// Optional JWT mirror payload, supplied by the middleware which has direct
// access to the validated session JWT. The middleware extracts:
//   - `accountStatus` from `app_metadata.account_status` (mirrored by the
//     `psychologist_profiles_mirror_status` AFTER UPDATE trigger)
//   - `iat` (issued-at, in seconds since epoch — the JWT spec format)
// Other call sites (server-side routes, admin tools) can omit the mirror;
// the helper then always loads from the DB.
export type JwtAccountMirror = {
  accountStatus: AccountStatus | null;
  iat: number;
};

// Result returned to the middleware (and any other consumer). The
// `source` field is informational — useful in logs and tests to confirm
// which path served the answer. `drift` is `true` when the JWT mirror and
// the DB disagreed on either status or freshness; the helper logs the same
// signal at WARN level so Sentry can surface it.
export type AccountStatusResult = {
  status: AccountStatus | null;
  source: 'jwt' | 'db';
  drift: boolean;
};

// Read the account status for `userId`, preferring the JWT mirror when it is
// fresh and consistent with the database row.
//
// **Pragmatic implementation note**: in principle, a JWT whose `iat` is
// newer than `status_changed_at` could be trusted without a DB read. We
// always read `(status, status_changed_at)` from the DB anyway because:
//   1. It is a single PK lookup against an indexed column — cheap relative
//      to the rest of the request lifecycle.
//   2. The `set_app_metadata` trigger guarantees the JWT mirror and the DB
//      agree on the *next* token refresh, but a stale JWT issued before the
//      most recent transition would otherwise be served as fresh.
//   3. The drift signal (`status_mirror_drift` log) is the canary that the
//      mirror got out of sync with the row — without the DB read, we lose
//      observability into the very thing the JWT mirror is meant to
//      optimize.
// If a future profiling pass shows the DB hop is hot, we can revisit and
// gate it behind an `iat`-based short-circuit. Until then, accuracy beats
// the saved query.
export async function getAccountStatus(
  userId: string,
  jwtMirror?: JwtAccountMirror,
): Promise<AccountStatusResult> {
  const rows = await db
    .select({
      status: psychologistProfiles.status,
      statusChangedAt: psychologistProfiles.statusChangedAt,
    })
    .from(psychologistProfiles)
    .where(eq(psychologistProfiles.userId, userId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    // No profile row yet (signup did not finish, or the user was hard-deleted
    // by the GDPR/LGPD job). The middleware treats `null` as "no profile,
    // bounce to login" rather than crashing.
    return { status: null, source: 'db', drift: false };
  }

  const dbStatus = row.status as AccountStatus;

  // No JWT mirror available — server-side caller, admin tool, or test
  // running outside the middleware. Always serve the DB value.
  if (!jwtMirror) {
    return { status: dbStatus, source: 'db', drift: false };
  }

  // Compare the JWT mirror against the DB row. Two ways to drift:
  //   - The JWT was issued BEFORE the most recent status change
  //     (`iat * 1000 < status_changed_at_epoch_ms`).
  //   - The JWT carried a status string that disagrees with the DB column,
  //     even though `iat` claims it was issued after the change. This means
  //     the trigger fired but the user's session was not refreshed, OR the
  //     trigger never ran (a bug we want a log line on).
  const iatMs = jwtMirror.iat * 1000;
  const statusChangedAtMs = row.statusChangedAt.getTime();
  const stale = iatMs < statusChangedAtMs;
  const disagree = jwtMirror.accountStatus !== dbStatus;
  const drift = stale || disagree;

  if (drift) {
    // LGPD-safe: we only log identifiers and status strings, no PII. The
    // logger redaction list includes `email`, `cpf`, `password`, etc. — the
    // fields here are deliberately outside that list.
    logger.warn(
      {
        event: 'status_mirror_drift',
        userId,
        jwtStatus: jwtMirror.accountStatus,
        dbStatus,
        jwtIatMs: iatMs,
        statusChangedAtMs,
        stale,
        disagree,
      },
      'JWT account_status mirror is out of sync with psychologist_profiles',
    );
    return { status: dbStatus, source: 'db', drift: true };
  }

  // Mirror is fresh and consistent. We could have served it without the DB
  // read; we report `source: 'jwt'` because that is the answer the consumer
  // would have received from a perfect mirror.
  return { status: dbStatus, source: 'jwt', drift: false };
}
