import '@testing-library/jest-dom/vitest';

// Unit tests run with NODE_ENV=test (set by Vitest) so the logger stays
// silent. They also need a baseline of valid env vars in case something
// pulls `src/shared/env/index.ts` during a test (the schema fails fast otherwise).
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-service-key';
