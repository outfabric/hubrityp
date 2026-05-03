# CI, artifacts e debugging

## Artifacts úteis no fail

A config recomendada já gera:

- **trace** (`trace: 'on-first-retry'`) — gravação completa de DOM, network, console, screenshots por step. Abre no [trace viewer](https://playwright.dev/docs/trace-viewer):

  ```bash
  npx playwright show-trace test-results/.../trace.zip
  ```

- **screenshot** (`screenshot: 'only-on-failure'`) — PNG do estado final.
- **video** (`video: 'retain-on-failure'`) — `.webm` da execução.
- **report HTML** — `playwright-report/` (suíte seeded) e `playwright-report-real/` (suíte real).

Outputs:

| Suíte | `outputDir` (results) | Report folder |
|---|---|---|
| seeded | `test-results/` | `playwright-report/` |
| real | `test-results-real/` | `playwright-report-real/` |

## Subindo artifacts no GitHub Actions

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

Para a suíte real, use os paths `playwright-report-real/` e `test-results-real/`.

## Sharding (paralelismo entre máquinas)

Para suites grandes, distribua entre runners:

```yaml
strategy:
  matrix:
    shard: [1/3, 2/3, 3/3]
steps:
  - run: npx playwright test --config playwright.seeded.config.ts --shard=${{ matrix.shard }}
```

`workers: 2` já paraleliza dentro de uma máquina; sharding adiciona paralelismo entre máquinas. Só vale quando a suite passa de ~10min em uma máquina.

## Retries

`retries: 2` no CI mascara flakiness pontual mas **não corrige raiz**. Marque flakies com tag e investigue:

```ts
test('agenda consulta @flaky', async ({ page }) => { /* ... */ });
```

Filtre nos relatórios. Se um teste passa só com retry mais de 5x em 100 runs, ele está mentindo — refatore ou remova.

## Modo debug local

```bash
# UI mode: explora interativo, time-travel
npx playwright test --config playwright.seeded.config.ts --ui

# Inspector: pausa em cada step, sugere locator
PWDEBUG=1 npx playwright test --config playwright.seeded.config.ts src/__tests__/e2e/seeded/agendamento.spec.ts

# Headed (vê o navegador, sem inspector)
npx playwright test --config playwright.seeded.config.ts --headed --workers=1

# Um único teste por nome
npx playwright test --config playwright.seeded.config.ts -g "agenda consulta"

# Filtrar por tag de domínio
npx playwright test --config playwright.seeded.config.ts --grep "@agenda"
```

## `test.fixme` / `test.skip` / `test.fail`

```ts
test.skip('feature em desenvolvimento', async ({ page }) => { /* ... */ });

test.fixme(({ browserName }) => browserName === 'webkit', 'bug do Safari, ver #123');

test.fail('docs dizem que falha aqui — quando passar, remover .fail', async () => {
  await expect(...).toBe(...);
});
```

`test.fail` é útil em TDD: você documenta a expectativa atual ainda quebrada; quando o app passa a passar, o teste **falha por inversão** e força você a remover o `.fail`.

## Sentinelas de qualidade da suite

Métricas para acompanhar mensalmente:

- **Tempo total no CI**: alvo <8min para 15 testes (suíte seeded).
- **Taxa de retry**: <2% dos testes precisam de retry para passar.
- **Falsos positivos** (teste passa mas feature está quebrada): zero tolerância — investigue cada caso reportado.
- **Tempo médio por teste**: <30s. Se subir, geralmente é login pela UI ou esperas escondidas.

## CI cache

Cache do `~/.cache/ms-playwright` (browsers) e `node_modules` acelera dramatically:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/ms-playwright
      node_modules
    key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}
```

## Quando o teste falha no CI mas passa local

Checklist:

1. Timezone diferente? `timezoneId: 'America/Sao_Paulo'` na config.
2. Locale diferente? `locale: 'pt-BR'`.
3. Viewport diferente? Padrão `Desktop Chrome` é 1280x720 — confirme se o teste depende.
4. Concorrência de DB no CI (`workers: 2`)? Reduza para `1` para confirmar.
5. Container Postgres em estado diferente? Adicione `await truncateAllExceptSeed()` no início do teste e veja se resolve — se sim, isolamento estava furado.
6. Animações: `await page.waitForLoadState('networkidle')` antes de asserções visuais.

Trace + video do CI normalmente respondem em 30s — sempre olhe esses primeiro antes de chutar.
