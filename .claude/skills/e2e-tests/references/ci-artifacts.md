# CI, artifacts and debugging

## Useful artifacts on failure

The recommended config already generates:

- **trace** (`trace: 'on-first-retry'`) — full recording of DOM, network, console, screenshots per step. Open in the [trace viewer](https://playwright.dev/docs/trace-viewer):

  ```bash
  npx playwright show-trace test-results/.../trace.zip
  ```

- **screenshot** (`screenshot: 'only-on-failure'`) — PNG of the final state.
- **video** (`video: 'retain-on-failure'`) — `.webm` of the run.
- **HTML report** — `playwright-report/` (seeded suite) and `playwright-report-real/` (real suite).

Outputs:

| Suite | `outputDir` (results) | Report folder |
|---|---|---|
| seeded | `test-results/` | `playwright-report/` |
| real | `test-results-real/` | `playwright-report-real/` |

## Uploading artifacts on GitHub Actions

```yaml
# .github/workflows/e2e.yml
- name: Run Playwright (seeded)
  run: npm run test:e2e:seeded

- name: Upload seeded report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report-seeded
    path: playwright-report/
    retention-days: 14

- name: Upload seeded traces
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-traces-seeded
    path: test-results/
    retention-days: 14
```

For the real suite, use paths `playwright-report-real/` and `test-results-real/`.

## Sharding (parallelism across machines)

For large suites, distribute across runners:

```yaml
strategy:
  matrix:
    shard: [1/3, 2/3, 3/3]
steps:
  - run: npx playwright test --config playwright.seeded.config.ts --shard=${{ matrix.shard }}
```

`workers: 2` already parallelizes inside a single machine; sharding adds parallelism across machines. Only worth it when the suite passes ~10min on a single machine.

## Retries

`retries: 2` in CI masks occasional flakiness but **does not fix the root cause**. Tag flakies and investigate:

```ts
test('schedule consultation @flaky', async ({ page }) => { /* ... */ });
```

Filter in reports. If a test passes only after retry more than 5x in 100 runs, it is lying — refactor or remove.

## Local debug mode

```bash
# UI mode: interactive exploration, time-travel
npx playwright test --config playwright.seeded.config.ts --ui

# Inspector: pauses on each step, suggests a locator
PWDEBUG=1 npx playwright test --config playwright.seeded.config.ts src/__tests__/e2e/seeded/agendamento.spec.ts

# Headed (see the browser, no inspector)
npx playwright test --config playwright.seeded.config.ts --headed --workers=1

# A single test by name
npx playwright test --config playwright.seeded.config.ts -g "schedule consultation"

# Filter by domain tag
npx playwright test --config playwright.seeded.config.ts --grep "@agenda"
```

## `test.fixme` / `test.skip` / `test.fail`

```ts
test.skip('feature under development', async ({ page }) => { /* ... */ });

test.fixme(({ browserName }) => browserName === 'webkit', 'Safari bug, see #123');

test.fail('docs say this fails here — once it passes, remove .fail', async () => {
  await expect(...).toBe(...);
});
```

`test.fail` is useful in TDD: you document the current broken expectation; once the app starts passing, the test **fails by inversion** and forces you to remove `.fail`.

## Suite quality sentinels

Metrics to track monthly:

- **Total time in CI**: target <8min for 15 tests (seeded suite).
- **Retry rate**: <2% of tests need a retry to pass.
- **False positives** (test passes but the feature is broken): zero tolerance — investigate every reported case.
- **Average time per test**: <30s. If it rises, it is usually UI login or hidden waits.

## CI cache

Caching `~/.cache/ms-playwright` (browsers) and `node_modules` speeds things up dramatically:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/ms-playwright
      node_modules
    key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}
```

## When the test fails in CI but passes locally

Checklist:

1. Different timezone? `timezoneId: 'America/Sao_Paulo'` in the config.
2. Different locale? `locale: 'pt-BR'`.
3. Different viewport? Default `Desktop Chrome` is 1280x720 — confirm if the test depends on it.
4. DB concurrency in CI (`workers: 2`)? Drop to `1` to confirm.
5. Postgres container in a different state? Add `await truncateAllExceptSeed()` at the start of the test and see if it resolves — if it does, isolation was leaking.
6. Animations: `await page.waitForLoadState('networkidle')` before visual assertions.

Trace + video from CI usually answer it in 30s — always look at those first before guessing.
