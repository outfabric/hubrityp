// Playwright global teardown.
//
// We intentionally do NOT stop the Testcontainers Postgres here: bootPostgres
// uses `.withReuse()` so the container survives between local runs (saves
// ~10s of boot time on every iteration). On CI the runner is destroyed at
// the end of the job, which removes the container along with everything
// else.
//
// To force a clean slate locally: `docker rm -f $(docker ps -a -q --filter
// label=org.testcontainers=true)`.
export default async function globalTeardown() {
  // no-op
}
