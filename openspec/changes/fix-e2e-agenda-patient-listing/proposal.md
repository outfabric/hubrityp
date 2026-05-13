## Why

4 testes E2E de agenda (`session-cancel`, `session-edit-lock`, `session-mark-done`, `session-no-show`) falham deterministicamente e 3 testes de `patient-listing` são flaky no CI (GitHub Actions run #110). Os testes de agenda falham porque mutam sessões seeded compartilhadas sem reset entre retries, causando transições de status inválidas. Os testes de patient-listing sofrem race condition com o Suspense boundary do Next.js — assertions rodam antes do conteúdo streamado chegar ao DOM.

## What Changes

- **Agenda tests**: Adicionar `beforeEach` que reseta o status das sessões seeded ao estado original (via SQL direto no Testcontainers) antes de cada teste, garantindo idempotência mesmo em retries
- **Agenda tests**: Avaliar uso de `test.describe.serial()` para os testes que mutam estado compartilhado, evitando colisões entre workers paralelos
- **Patient-listing tests**: Adicionar wait explícito no `beforeEach` para aguardar resolução do Suspense (`patient-list` OR `patient-list-empty` visível) antes de rodar assertions
- **Patient-listing tests**: Substituir padrão `.isVisible().catch(() => false)` por `expect().toBeVisible()` com timeout nativo do Playwright
- **Patient-listing tests**: Corrigir teste "empty state" (L39) que testa condição impossível — seed sempre tem 2 pacientes ativos

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `e2e-test-stack`: Adicionar requisito de reset de estado entre retries para testes que mutam dados seeded; adicionar requisito de wait explícito pós-navegação em páginas com Suspense

## Impact

- `src/__tests__/e2e/seeded/agenda/session-cancel.spec.ts`
- `src/__tests__/e2e/seeded/agenda/session-edit-lock.spec.ts`
- `src/__tests__/e2e/seeded/agenda/session-mark-done.spec.ts`
- `src/__tests__/e2e/seeded/agenda/session-no-show.spec.ts`
- `src/__tests__/e2e/seeded/patients/patient-listing.spec.ts`
- `src/__tests__/e2e/seeded/setup/global-setup.ts` (possível refactor para expor helper de reset)
- Nenhuma mudança em código de produção — apenas testes
