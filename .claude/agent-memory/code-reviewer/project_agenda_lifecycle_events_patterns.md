---
name: agenda-lifecycle-events-patterns
description: Inngest fire-and-forget event emission patterns for agenda session lifecycle actions; test conventions; LGPD event payload safety
metadata:
  type: project
---

# Agenda Session Lifecycle Events Patterns

Reviewed in `feature/agenda-session-events-lifecycle` (2026-05-29).

## Implementation pattern (8 Server Actions)

All 8 actions follow an identical fire-and-forget block placed **after** the DB transaction commits and **before** the `return { ok: true }`:

```ts
try {
  const payload = sessionXxxEventSchema.parse({ ... });
  await inngest.send({ name: 'agenda/session.xxx', data: payload });
} catch (inngestErr: unknown) {
  const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
  logger.error({ event: 'inngest_send_failed', eventName: 'agenda/session.xxx', sessionId, error: errMsg }, '...');
}
```

**Key invariants:**
- `try/catch` wraps only the Inngest path — never the DB transaction or the success return.
- The outer `catch (err)` does NOT re-wrap the inner one.
- Blocking slots (null `patientId`) intentionally fail Zod parse and are swallowed by design — the event schema requires a non-null `patientId`.
- `runMissingNoteReminder` uses a per-event `try/catch` in a loop so one failure does not block others.

## Inngest client

- `@/modules/agenda/inngest/client.ts` re-exports from `@/modules/whatsapp/inngest/client`.
- Single `Inngest({ id: 'hubrityp' })` instance; all modules share it.
- `encryptionMiddleware` is configured — protects step output (NOT event payloads sent via `inngest.send()`).

## Event payload safety (LGPD)

All agenda session event schemas contain only:
- UUIDs (sessionId, patientId, userId, oldSessionId, newSessionId)
- Timestamps
- Controlled enum values (cancelledBy, confirmedBy, reason, notice)
- Numbers (daysSinceDone) and booleans (chargeApplied)

No patient names, CPF, CRP, clinical content, or health data. Safe to send to Inngest Cloud without encryption.

**Known type looseness:** `reason` in `sessionCancelledEventSchema` is `z.string()` but callers always feed an enum value. Should be tightened to `z.enum([...])` in a follow-up.

## Log payloads

New `inngest_send_failed` log entries contain only: `event`, `eventName`, `sessionId` (UUID), `error` (error message string), plus `oldSessionId`/`newSessionId` for reschedule. No PII. Compliant with [[feedback_pii_in_logs]].

## `doneAt` approximation in missing-note-reminder

`missing-note-reminder.ts` maps `session.updatedAt` → `doneAt` because the sessions table has no dedicated `done_at` column. The query filters on `updated_at < 7daysAgo`, so `updatedAt` is the actual time the row was last changed to `done` status. This is documented as a stub pending the `evolutions` table.

## Test patterns

- Unit tests use `vi.hoisted()` to create mutable state accessible in `vi.mock()` factories (setExistingSession, setUpdateReturnRow setters).
- Integration tests mock `@/modules/agenda/inngest/client` at module level via `vi.mock()` + `vi.hoisted()`; all DB operations hit real Postgres via Testcontainers.
- Integration tests seed `auth.users` via `runAsService` (bypasses RLS for fixture setup).
- Cancellation notice tier tested at integration level (48h -> '24h+', 30min -> 'less_1h').
- public-confirm and public-decline covered only at unit level in this PR (no integration test for token-gated public paths).

## Stale JSDoc issue (flagged MEDIUM)

4 files still have "will be emitted once the Inngest client is configured" in their JSDoc after the feature landed:
- confirm-session.ts:43-45
- cancel-session.ts:55-57
- mark-session-done.ts:45-47
- mark-session-no-show.ts:44-46

complete-reschedule.ts was updated correctly. Pattern to use: "After the transaction commits, the `agenda/session.X` Inngest event is emitted fire-and-forget (failures are logged, never surfaced)."
