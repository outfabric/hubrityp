// Vitest stub for the `server-only` package. The real module always throws,
// which is the desired behavior under Next.js bundling but breaks tests that
// import server modules directly. Aliased via `vitest.config.ts` and
// `vitest.integration.config.ts` to this file under `src/__tests__/stubs/`.
export {};
