// Barrel re-exporting the `auth` domain's tables. `drizzle-kit` discovers
// schemas through the `**/tables.ts` glob in `drizzle.config.ts`, so adding a
// new table to this domain only requires a new module and a re-export here.
export * from './auth-resend-log';
export * from './crp-validation-queue';
export * from './psychologist-profiles';
