// Shared seed metadata between Playwright phases.
//
// `global-setup.ts` writes this file; `auth.setup.ts` reads it; tests load
// the storageState produced by `auth.setup.ts`. We intentionally use a JSON
// file (rather than `globalThis` / module-level state) because Playwright
// runs `globalSetup`, the `setup` project, and individual test files in
// separate processes — module state does not survive the boundaries.
//
// The file lives under `e2e/.auth/` (gitignored alongside `state.json`) so a
// stale value can never leak into a commit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SEED_STATE_PATH = path.resolve(HERE, '.auth/seed-state.json');
export const STORAGE_STATE_PATH = path.resolve(HERE, '.auth/state.json');

export type SeedState = {
  // Stable UUID seeded into `auth.users` by `global-setup.ts`. Tests can
  // assert that the dashboard greeting matches `email`, so changes here
  // need to ripple to `auth.spec.ts`.
  userId: string;
  email: string;
  // The bearer token the mock GoTrue accepts. Everything above the cookie
  // must encode this value or the mock returns 401 and the dashboard render
  // collapses to `null`.
  accessToken: string;
  refreshToken: string;
  // Mock GoTrue origin (e.g. `http://127.0.0.1:43219`). Captured here so the
  // setup project can pass it to `createServerClient` without re-reading
  // `process.env` (which is set in the parent process — workers inherit a
  // snapshot, but writing it into the seed state keeps the contract local).
  supabaseUrl: string;
  // Connection string for the Testcontainers Postgres started by the
  // webServer wrapper. `globalSetup` uses this to seed the auth.users row;
  // tests that need direct DB access can also pick it up from here.
  databaseUrl: string;
};

export async function writeSeedState(state: SeedState): Promise<void> {
  await mkdir(path.dirname(SEED_STATE_PATH), { recursive: true });
  await writeFile(SEED_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export async function readSeedState(): Promise<SeedState> {
  const raw = await readFile(SEED_STATE_PATH, 'utf8');
  return JSON.parse(raw) as SeedState;
}
