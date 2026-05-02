# Locators, interações e esperas

A qualidade do E2E depende diretamente da qualidade dos locators. Locator frágil = teste flaky.

## Hierarquia de locators (preferência decrescente)

1. **`getByRole`** — semântico, alinhado a leitores de tela. `page.getByRole('button', { name: /salvar/i })`.
2. **`getByLabel`** — para inputs. `page.getByLabel(/cpf/i)`.
3. **`getByPlaceholder`** — quando não há label visível.
4. **`getByText`** — para conteúdo textual estável.
5. **`getByTestId`** — `data-testid="lista-pacientes"`. Use só onde role/label não bastam (containers genéricos, lista virtualizada). **Sempre estável** — `data-testid` que muda com refator é pior que CSS.
6. **`page.locator('css=...')`** — último recurso. Se chegou aqui, considere se a UI tem problema de acessibilidade.

```ts
// Bom
await page.getByRole('button', { name: /agendar consulta/i }).click();
await page.getByLabel(/horário/i).fill('14:00');

// Ruim
await page.click('.btn.btn-primary > span:nth-child(2)');
await page.locator('input[name="time"]').fill('14:00');
```

## Auto-wait (web-first assertions)

Locators do Playwright **esperam automaticamente** o elemento ficar acionável. Asserções em `expect(locator)` re-tentam até `expect.timeout`:

```ts
await page.getByRole('button', { name: /salvar/i }).click();
await expect(page.getByText(/salvo com sucesso/i)).toBeVisible();
```

Não envolva em `try/catch` ou `setTimeout` — você está lutando contra o framework.

## Quando precisa de espera explícita

Para eventos específicos (chamada de rede, navegação, evento custom), use a primitiva certa:

```ts
// Espera URL mudar
await page.waitForURL('**/agenda');

// Espera resposta de uma API específica
const responsePromise = page.waitForResponse(
  (r) => r.url().includes('/api/agendamentos') && r.request().method() === 'POST'
);
await page.getByRole('button', { name: /confirmar/i }).click();
const response = await responsePromise;
expect(response.status()).toBe(201);

// Espera estado computado (com polling)
await expect.poll(async () => {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name.startsWith('sb-'));
}).toBeDefined();
```

`waitForTimeout` está disponível mas **proibido** em código de produção da suite. Só em debug local.

## Padrões de formulário

```ts
test('cadastra paciente', async ({ page }) => {
  await page.goto('/pacientes/novo');

  await page.getByLabel(/nome/i).fill('Maria Silva');
  await page.getByLabel(/cpf/i).fill('529.982.247-25');
  await page.getByLabel(/data de nascimento/i).fill('1990-05-15');
  await page.getByRole('combobox', { name: /sexo/i }).selectOption('feminino');

  await page.getByRole('button', { name: /cadastrar/i }).click();

  await expect(page).toHaveURL(/\/pacientes\/[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'Maria Silva' })).toBeVisible();
});
```

Para componentes shadcn/ui (Combobox, Date Picker, Calendar), abra → escolha por texto:

```ts
await page.getByRole('combobox', { name: /paciente/i }).click();
await page.getByRole('option', { name: 'Maria Silva' }).click();
```

## Tabelas e listas

Filtre por linha pelo conteúdo, depois clique no botão dentro:

```ts
const linhaMaria = page.getByRole('row').filter({ hasText: 'Maria Silva' });
await linhaMaria.getByRole('button', { name: /editar/i }).click();
```

Não use índices (`nth(2)`) — quebra quando ordem muda.

## Toasts e mensagens efêmeras

```ts
const toast = page.getByRole('status').filter({ hasText: /agendamento criado/i });
await expect(toast).toBeVisible();
await expect(toast).toBeHidden({ timeout: 8_000 }); // espera sumir, se relevante
```

## Asserções comuns

| Intenção | Asserção |
|---|---|
| Visível | `await expect(loc).toBeVisible()` |
| Texto | `await expect(loc).toHaveText(/.../i)` |
| Valor de input | `await expect(input).toHaveValue('Maria')` |
| Botão habilitado/desabilitado | `await expect(btn).toBeEnabled()` |
| URL | `await expect(page).toHaveURL(/\/agenda$/)` |
| Título | `await expect(page).toHaveTitle(/HubrityP/)` |
| Atributo | `await expect(loc).toHaveAttribute('aria-invalid', 'true')` |
| Quantidade na lista | `await expect(page.getByRole('listitem')).toHaveCount(3)` |

## Soft assertions (usar com parcimônia)

```ts
await expect.soft(page.getByText('A')).toBeVisible();
await expect.soft(page.getByText('B')).toBeVisible();
// O teste continua mesmo se uma falhar; reporta todas no final.
```

Útil em smoke test que valida múltiplos elementos numa landing. Não use em fluxo crítico — se A falhou, B provavelmente também, e você quer parar.

## Antipadrões

- `await page.waitForTimeout(2000)` — substitua por `expect(...).toBeVisible()`.
- `await page.locator(...).first()` quando `getByRole` resolveria com nome.
- Encadear muitos `nth-child` — código ilegível e frágil.
- Re-implementar lógica do app no teste (calcular o mesmo CPF, derivar a mesma data) — use os mesmos helpers do app via import.
- `.evaluate(() => window.localStorage.setItem(...))` para "logar" — use `storageState`.
