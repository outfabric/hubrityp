import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// 6.9 — Sentinel test: canonical auth log events
//
// Greps the source for all string literals passed to `logAuthEvent` as the
// `event` field and validates that they match the canonical set documented
// in the `AuthLogEvent` type union. This ensures no undocumented event
// string is introduced without updating the type.
// ---------------------------------------------------------------------------

// The canonical events defined in the AuthLogEvent union. This list MUST
// be kept in sync with `src/modules/registration/server/log-auth-event.ts`.
const CANONICAL_EVENTS = new Set([
  'signup_success',
  'signup_failure_duplicate_email',
  'signup_failure_duplicate_crp',
  'email_verified',
  'login_success',
  'login_failure',
  'lockout_started',
  'lockout_consecutive_threshold_reached',
  'logout',
  'password_reset_requested',
  'password_reset_completed',
]);

/**
 * Recursively scan `dir` for `.ts`/`.tsx` files that call `logAuthEvent`
 * and extract the `event:` string literals from those call blocks.
 *
 * Strategy: for each file that imports `logAuthEvent`, find all occurrences
 * of `logAuthEvent({` and extract the `event:` string from the block
 * between that opening and the matching `})`. This distinguishes
 * `logAuthEvent({event: 'foo'})` from `logger.warn({event: 'bar'})`.
 */
function findLogAuthEventCalls(): string[] {
  const srcDir = resolve(__dirname, '../../../');
  const events: string[] = [];

  function scanDir(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        // Skip the type definition file itself
        if (entry.name === 'log-auth-event.ts') continue;

        const content = readFileSync(fullPath, 'utf8');
        if (!content.includes('logAuthEvent')) continue;

        // Find all `logAuthEvent({` blocks and extract event strings.
        // We use a regex that matches `logAuthEvent({\n ... event: 'foo'`
        // within a reasonable span (up to 200 chars after the open paren).
        const blockMatches = content.matchAll(
          /logAuthEvent\(\{[\s\S]*?event:\s*['"]([a-z_]+)['"][\s\S]*?\}\)/g,
        );
        for (const match of blockMatches) {
          if (match[1]) events.push(match[1]);
        }
      }
    }
  }

  scanDir(srcDir);
  return events;
}

describe('auth_logs canonical events (sentinel)', () => {
  it('AuthLogEvent type in log-auth-event.ts contains all canonical events', () => {
    const typeSource = readFileSync(
      resolve(__dirname, '../../../modules/registration/server/log-auth-event.ts'),
      'utf8',
    );

    for (const event of CANONICAL_EVENTS) {
      expect(typeSource).toContain(`'${event}'`);
    }
  });

  it('every event string passed to logAuthEvent() in source is in the canonical set', () => {
    const foundEvents = findLogAuthEventCalls();

    // Sanity: we should find at least the events we know exist
    expect(foundEvents.length).toBeGreaterThan(0);

    // Every found event should be in the canonical set
    const nonCanonical = foundEvents.filter((e) => !CANONICAL_EVENTS.has(e));
    expect(nonCanonical).toEqual([]);
  });

  it('every canonical event is used at least once in source', () => {
    const foundEvents = new Set(findLogAuthEventCalls());

    for (const event of CANONICAL_EVENTS) {
      expect(
        foundEvents.has(event),
        `canonical event '${event}' is not used in any logAuthEvent() call site`,
      ).toBe(true);
    }
  });
});
