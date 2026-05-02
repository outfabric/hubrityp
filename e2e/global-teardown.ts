// Playwright global teardown.
//
// We deliberately do NOT stop the Testcontainers Postgres or the mock
// GoTrue here. Both are owned by the webServer wrapper process
// (`e2e/start-server.ts`); Playwright reaps that process at end-of-run,
// which closes the mock socket. The Postgres container survives via
// `.withReuse()` so subsequent local runs skip the ~10s boot.
//
// To force a clean slate locally:
//   docker rm -f $(docker ps -a -q --filter label=org.testcontainers=true)
export default async function globalTeardown() {
  // no-op
}
