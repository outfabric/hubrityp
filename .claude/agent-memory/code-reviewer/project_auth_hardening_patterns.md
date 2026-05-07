---
name: Auth hardening architecture patterns
description: Lockout state machine, anti-enumeration, cookie sidecar, and middleware decision table patterns established in the auth-login-hardening-and-recovery change
type: project
---

The auth-login-hardening change (2026-05-05) established several security patterns:

- **Lockout state machine**: Atomic SQL UPDATE in `modules/auth/server/lockout.ts` computes all state transitions (counter, lockout_until, consecutive_lockouts, requires_password_reset) in a single statement. Row-level locking prevents TOCTOU races. Threshold: 5 failures in 15min window -> 30min lockout. 3 consecutive lockouts -> requires_password_reset.
- **Anti-enumeration**: `dummyDelay()` (50-150ms random, `node:crypto.randomInt`) applied on login/forgot-password when no profile exists. Forgot-password always returns `{ ok: true }`. Email hashed via truncated SHA-256 for audit logs.
- **Cookie sidecar**: `hp_keep_logged_in` cookie (httpOnly, secure, sameSite:lax) controls whether Supabase session cookies get `maxAge: 86400` (24h). Read in `shared/supabase/server.ts`.
- **Middleware decision table**: `classifyPath()` -> `decide()` -> `decideWithProfile()` decomposition. `clear-and-pass` / `clear-and-redirect` variants for suspended/cancelled accounts that must clear cookies before redirect to break loops.
- **Mail via Resend**: `shared/lib/mail/resend.ts` wraps the HTTP API. Graceful degradation when `RESEND_API_KEY` is absent (logs warning, returns `{ ok: true, skipped: true }`).

**Why:** These patterns are now the baseline for any future auth surface. New endpoints that accept passwords MUST check lockout state before verification (the link-account flow was caught missing this in review-1).

**How to apply:** When reviewing future changes that touch auth, verify lockout pre-checks, anti-enumeration delays, and PII-free logging are maintained.
