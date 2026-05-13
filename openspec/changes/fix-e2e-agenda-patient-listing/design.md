## Context

4 testes E2E de agenda falham e 3 de patient-listing são flaky no CI (run #110). A infra de testes usa Testcontainers Postgres + mock GoTrue + Playwright com `fullyParallel: true` e `retries: 2` no CI.

**Estado atual dos testes de agenda:**
- `global-setup.ts` roda UMA vez por suite e seed 4 sessões com status determinísticos
- Os testes `session-cancel`, `session-mark-done`, `session-no-show` mutam o status da sessão
- Após mutação, se o teste falha (ex.: toast timeout), o retry encontra a sessão no estado mutado → transição inválida
- `session-edit-lock` é read-only mas usa locator ambíguo — se `session-mark-done` rodou em paralelo, João Santos tem 2 chips "done" e o `doneChip.click()` falha por strict mode

**Estado atual dos testes de patient-listing:**
- `beforeEach` faz apenas `page.goto('/pacientes')` sem esperar resolução do Suspense
- Testes usam `.isVisible().catch(() => false)` que mascara timing issues
- Teste "empty state" (L39) testa condição impossível — seed sempre tem 2 pacientes ativos

## Goals / Non-Goals

**Goals:**
- Testes de agenda idempotentes: cada execução (incluindo retries) começa com estado limpo
- Testes de patient-listing determinísticos: assertions só rodam após Suspense resolver
- Zero mudanças em código de produção

**Non-Goals:**
- Refatorar a infra de seeding (Testcontainers, mock GoTrue) — funciona corretamente
- Adicionar novos cenários de teste — apenas corrigir os existentes
- Mudar a estratégia de paralelismo do Playwright (`fullyParallel: true` deve continuar)

## Decisions

### D1: Reset de sessão via `test.beforeEach` com SQL direto

Cada arquivo de teste de agenda terá um `beforeEach` que reseta a(s) sessão(ões) que usa ao estado original via SQL direto (`postgres.js`), lendo `databaseUrl` do `seed-state.json`.

**Alternativas consideradas:**
- `test.describe.serial()`: eliminaria colisão entre testes no mesmo describe, mas não resolve o problema de retry (retry roda o mesmo teste, não o describe inteiro). Também não resolve colisão entre arquivos diferentes rodando em paralelo.
- Criar sessões com IDs únicos por tentativa: muito complexo, exigiria mudar IDs dinâmicos nos locators.

**Decisão:** SQL direto no `beforeEach` é simples, rápido (~5ms), e garante idempotência. Criar um helper `resetSession(sessionId, fields)` reutilizável.

### D2: Helper `resetSession` compartilhado em fixture Playwright

Criar um fixture Playwright customizado que expõe uma função `resetSession` via `test.extend()`. O fixture lê `databaseUrl` uma vez, abre a conexão no `beforeAll` equivalente, e expõe `resetSession(id, overrides)`.

**Implementação:** Criar `src/__tests__/e2e/seeded/setup/db-fixture.ts` que:
1. Exporta `test` e `expect` customizados com fixture `db` (conexão postgres)
2. Cada test file importa `{ test, expect }` desse fixture em vez de `@playwright/test`
3. O `beforeEach` de cada test chama `db.resetSession(...)` com os campos originais

### D3: Filtro por horário no `session-edit-lock`

Adicionar `.filter({ hasText: '20:00' })` ao locator de `session-edit-lock.spec.ts` para disambiguar dos chips de João Santos que podem estar "done" após `session-mark-done` rodar em paralelo.

### D4: Wait explícito pós-Suspense em patient-listing

Alterar o `beforeEach` de `patient-listing.spec.ts` para esperar a resolução do Suspense antes de retornar:

```typescript
await page.goto('/pacientes');
await expect(
  page.getByTestId('patient-list').or(page.getByTestId('patient-list-empty'))
).toBeVisible();
```

Isso garante que o DOM está pronto antes de qualquer assertion.

### D5: Reescrever teste "empty state" para cenário determinístico

O teste L39 ("empty state renders when no patients exist") será reescrito para:
1. Buscar um termo que não existe (`xyznonexistent`) → forçar estado "nenhum resultado"
2. Verificar a mensagem de empty state de busca

Ou, alternativamente, remover o teste e substituir por um que verifica o cenário real (com pacientes seeded).

**Decisão:** Reescrever para verificar que a lista renderiza com os pacientes seeded (cenário determinístico) em vez de testar condição de "nenhum paciente" que nunca acontece com o seed atual.

### D6: Eliminar padrão `.isVisible().catch(() => false)`

Substituir todas as ocorrências de `.isVisible().catch(() => false)` por assertions nativas do Playwright (`expect().toBeVisible()`), que já incluem auto-wait e retry. Os blocos `if (hasList)` que pulam assertions condicionalmente devem ser convertidos em assertions diretas, pois com o wait do D4, o estado é sempre determinístico (pacientes seeded existem → `patient-list` sempre visível).

## Risks / Trade-offs

- **Conexão SQL no test runtime**: O fixture `db` abre uma conexão Postgres dentro do worker do Playwright. Risco: se o DB não estiver pronto, o fixture falha. Mitigação: `global-setup` já valida que o DB está operacional antes dos testes rodarem; o fixture apenas reutiliza a mesma URL.

- **Overhead do `beforeEach` SQL**: Cada reset é 1-2 queries simples (~5ms). Com 4 testes, isso adiciona ~20ms ao total. Negligível.

- **Reescrever testes de patient-listing**: Os testes existentes foram escritos para ser "defensivos" (lidar com ambos os estados). A reescrita assume que o seed é determinístico. Se alguém mudar o seed sem atualizar os testes, eles quebram — mas isso é intencional (fail loud > fail silent).
