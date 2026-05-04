// Shared types and constants for the @auth-real fixture.
//
// Lives in its own module (rather than inline in `global-setup.ts`) so the
// test, the teardown, and the setup all share the same type and the same
// file name. If the seed email or password ever changes, this is the single
// place to edit.

export const SEED_EMAIL = 'auth-real-seed@example.com';
// Plain string here — there is no security boundary: this is a throwaway
// password seeded into a local-only Supabase stack via the admin API.
// Production paths never see it.
export const SEED_PASSWORD = 'auth-real-password-12345';
// Mirrors `user_metadata.fullName` written by `global-setup.ts`. The dashboard
// greeting renders `profile.fullName`, so the spec asserts against this same
// value — keep them in sync if either changes.
export const SEED_FULL_NAME = 'Seed Real User';

export const CREDENTIALS_FILE_NAME = 'credentials.json';

export type AuthRealCredentials = {
  email: string;
  password: string;
  userId: string;
};
