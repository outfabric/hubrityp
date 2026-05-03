import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

// CI guard for the spec invariant:
//   "transitionStatus helper is the single writer of `status`. Direct UPDATE
//    statements against `status` outside the helper MUST be rejected at code
//    review (and a unit test SHALL grep the codebase to enforce this)."
//
// Strategy: walk `src/` and assert that the regex `/\.status\s*=(?![=>])/`
// does not appear in any production file. The negative lookahead `(?![=>])`
// rules out comparisons (`.status === 'active'`) and arrow expressions (an
// unlikely edge), keeping the regex true to "no direct status assignment".
//
// Allowed locations (excluded from the walk):
//   - `src/modules/account-lifecycle/lib/state-machine.ts` — defines the
//     transition table, but does it via map keys (`pending_verification:
//     { ... }`), not `.status =`. Excluded as a belt-and-braces measure
//     in case a future refactor introduces an internal assignment.
//   - `src/modules/account-lifecycle/server/transition.ts` — the Drizzle
//     UPDATE here uses `.set({ status: next })`, which does NOT match the
//     regex (object literal property, not member-expression assignment).
//     Excluded for the same reason.
//   - Any `*.test.ts(x)` file — tests legitimately assert `.status` values
//     (e.g. `expect(updated.status).toBe(...)` does not match the regex,
//     but `db.update(...).set({ status: ... })` in factories or fixtures
//     could appear in test code paths). Excluded wholesale.
//   - All paths under `src/__tests__/**` — same reason.
//
// **Schema files** (e.g. `src/shared/db/schema/auth/psychologist-profiles.ts`)
// declare the column with `status: text('status').notNull()`. That is an
// object-literal property syntax (`status:`), not assignment (`status =`),
// so the regex does NOT match. They are NOT excluded; the regex is precise
// enough on its own.

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SRC_DIR = join(PROJECT_ROOT, 'src');

const EXCLUDED_FILES = new Set<string>([
  join(SRC_DIR, 'modules', 'account-lifecycle', 'lib', 'state-machine.ts'),
  join(SRC_DIR, 'modules', 'account-lifecycle', 'server', 'transition.ts'),
]);

const EXCLUDED_DIRS = new Set<string>([join(SRC_DIR, '__tests__')]);

// Pattern: `.status` followed by optional whitespace and a SINGLE `=`,
// where the next character is NOT `=` (which would make it `==` or `===`,
// i.e. a comparison) and NOT `>` (arrow function).
const FORBIDDEN_PATTERN = /\.status\s*=(?![=>])/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (EXCLUDED_DIRS.has(fullPath)) continue;
    if (EXCLUDED_FILES.has(fullPath)) continue;

    let st;
    try {
      st = statSync(fullPath);
    } catch {
      // Symlink to a deleted target, race with another process — skip.
      continue;
    }

    if (st.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    // Only scan TS / TSX files. JSON, MD, lock files, generated artifacts,
    // and the like cannot meaningfully contain status writes.
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('account-lifecycle: direct `status` writes are forbidden outside the state-machine module', () => {
  it('finds no `.status =` assignments in `src/` (excluding state machine, transition helper, and tests)', () => {
    const files = walk(SRC_DIR);

    // Sanity check: the walk must find SOMETHING. If the exclusions are
    // accidentally too broad (e.g. SRC_DIR points at a non-existent path),
    // the suite would silently report success.
    expect(files.length).toBeGreaterThan(10);

    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      const lines = contents.split('\n');
      lines.forEach((text, idx) => {
        if (FORBIDDEN_PATTERN.test(text)) {
          // Render the path relative to the project root for a readable
          // failure message, but keep the absolute path off the snapshot
          // so the test does not break when run from a different worktree.
          const relPath = file.startsWith(PROJECT_ROOT + sep)
            ? file.slice(PROJECT_ROOT.length + 1)
            : file;
          offenders.push({ file: relPath, line: idx + 1, text: text.trim() });
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
