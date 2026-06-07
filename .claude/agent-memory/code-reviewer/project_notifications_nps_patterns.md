---
name: notifications-nps-patterns
description: In-app notification bell + NPS day-7 survey: auth patterns, IDOR closure, LGPD logging, Realtime subscription, Inngest jobs, test isolation
metadata:
  type: project
---

# In-app notifications + NPS module patterns (2026-06-04)

## Notifications module

**Shape:** `src/modules/notifications/` has server/, lib/, components/ (3 client leaves: NotificationBell, NotificationBellBoundary, NotificationDropdown), hooks/ (useNotificationsRealtime), inngest/, index.ts. The CLAUDE.md tree comment was NOT updated — it still says "server-only" but the module now has full UI. Flag this stale comment if seen in a future diff.

**IDOR closure pattern:** `markNotificationRead` uses `WHERE id = :input.id AND user_id = session.uid AND read_at IS NULL`. No service-role bypass — the Drizzle `db` client bypasses RLS, so the explicit `user_id = session.uid` predicate IS the authorization guard. Test: integration test named "IDOR proof: user B marking user A's notification affects zero rows" uses `runAsUser` RLS enforcement to prove at the DB layer.

**RLS:** `notifications` table RLS was established in migration 0015 (SELECT + UPDATE policies). No new RLS needed in this diff.

**Realtime subscription:** `useNotificationsRealtime` uses `user_id=eq.<userId>` channel filter (defense in depth alongside RLS SELECT policy). The `userId` always comes from the server-session, never client input. The hook no-ops when `userId` is falsy — no stray unfiltered channels.

**`notify()` helper:** intentionally thin (no input validation beyond DB NOT NULL). Callers (Inngest jobs only) are responsible for correct payload. `actionUrl` is stored as `text` with no DB constraint — all current callers use hardcoded path-relative strings, but there is no same-origin guard at the `router.push()` call site in NotificationDropdown. Flag as MEDIUM if actionUrl surface grows.

**`email_critical` enforcement:** `updateNotificationPreferencesInputSchema` deliberately OMITS `emailCritical` (Zod strips it). The server coerces it to `true` on every UPSERT. Read path also returns `true` defensively. This is airtight.

**List cap:** `LIST_LIMIT = 50` in `list-notifications.ts`. The unread badge count (`get-unread-count.ts`) is independent and exact — cap only affects the dropdown list display.

## NPS module

**Submit path:** `submitNpsImpl` accepts `unknown`, runs through `dismissSchema` first, then `npsAnswerSchema`. Two shapes: answer (`{score, feedback?}`) and dismissal (`{dismiss: true}`). Both stamp `nps_responded_at IS NULL` guard — idempotent, exactly-once semantics.

**Inngest event payload:** `detractorSubmittedEventSchema = z.object({ userId: z.string().uuid(), score: z.number().int().min(0).max(6) })`. Email/name/feedback are NEVER in the event payload (LGPD data minimization). The downstream Inngest function resolves the email from the DB itself.

**Log LGPD compliance confirmed:** `nps_submitted` log carries `{ event, userId, score }` — feedback and email are absent. The `enqueueDetractorEmail` error log also only carries `{ event, eventName, userId, error }` — no PII.

**Eligibility:** `isEligibleForNps()` is a pure function with injected `now` for deterministic testing. Gate: `npsRespondedAt IS NULL` AND `elapsedMs >= 7 * 24 * 60 * 60 * 1000`. Server-computed only — no client storage consulted.

## E2E test isolation patterns

**Dedicated user per overlay:** `SEED_NPS_USER` (`0000...c5`) is a completely separate auth.users row used only by the NPS spec, preventing modal overlay from intercepting parallel workers. `tour_completed_at` is stamped in `global-setup.ts` to prevent Driver.js overlay from stealing clicks. This pattern mirrors `SEED_ONBOARDING_TOUR_USER` and `SEED_ONBOARDING_CHECKLIST_USER`.

**Negative-auth E2E:** `bell.spec.ts` anonymous describe block covers `/configuracoes/notificacoes` redirect. Middleware integration test `notificacoes-gating.int.test.ts` covers anonymous→redirect, active→pass, suspended→clear-and-redirect.

## Known open issues

- `notification-dropdown.tsx:134`: no same-origin guard on `actionUrl` before `router.push()`. All current callers write hardcoded paths; risk is latent only. Flagged MEDIUM in review-1.md.
- CLAUDE.md `notifications/` comment still says "server-only" — now inaccurate. Flagged MEDIUM in review-1.md.
