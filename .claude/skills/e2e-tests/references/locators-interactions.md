# Locators, interactions and waits

The quality of E2E depends directly on the quality of the locators. Fragile locator = flaky test.

## Locator hierarchy (decreasing preference)

1. **`getByRole`** — semantic, aligned with screen readers. `page.getByRole('button', { name: /salvar/i })`.
2. **`getByLabel`** — for inputs. `page.getByLabel(/cpf/i)`.
3. **`getByPlaceholder`** — when there is no visible label.
4. **`getByText`** — for stable textual content.
5. **`getByTestId`** — `data-testid="lista-pacientes"`. Use only where role/label do not suffice (generic containers, virtualized lists). **Always stable** — a `data-testid` that changes with a refactor is worse than CSS.
6. **`page.locator('css=...')`** — last resort. If you got here, consider whether the UI has an accessibility problem.

```ts
// Good
await page.getByRole('button', { name: /agendar consulta/i }).click();
await page.getByLabel(/horário/i).fill('14:00');

// Bad
await page.click('.btn.btn-primary > span:nth-child(2)');
await page.locator('input[name="time"]').fill('14:00');
```

## Auto-wait (web-first assertions)

Playwright locators **wait automatically** for the element to become actionable. Assertions on `expect(locator)` retry until `expect.timeout`:

```ts
await page.getByRole('button', { name: /salvar/i }).click();
await expect(page.getByText(/salvo com sucesso/i)).toBeVisible();
```

Do not wrap in `try/catch` or `setTimeout` — you are fighting the framework.

## When you need an explicit wait

For specific events (network call, navigation, custom event), use the right primitive:

```ts
// Wait for URL change
await page.waitForURL('**/agenda');

// Wait for a specific API response
const responsePromise = page.waitForResponse(
  (r) => r.url().includes('/api/agendamentos') && r.request().method() === 'POST'
);
await page.getByRole('button', { name: /confirmar/i }).click();
const response = await responsePromise;
expect(response.status()).toBe(201);

// Wait for computed state (with polling)
await expect.poll(async () => {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name.startsWith('sb-'));
}).toBeDefined();
```

`waitForTimeout` is available but **forbidden** in production suite code. Local debug only.

## Form patterns

```ts
test('registers a patient', async ({ page }) => {
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

For shadcn/ui components (Combobox, Date Picker, Calendar), open → pick by text:

```ts
await page.getByRole('combobox', { name: /paciente/i }).click();
await page.getByRole('option', { name: 'Maria Silva' }).click();
```

## Tables and lists

Filter by row by content, then click the button inside:

```ts
const linhaMaria = page.getByRole('row').filter({ hasText: 'Maria Silva' });
await linhaMaria.getByRole('button', { name: /editar/i }).click();
```

Do not use indices (`nth(2)`) — breaks when the order changes.

## Toasts and ephemeral messages

```ts
const toast = page.getByRole('status').filter({ hasText: /agendamento criado/i });
await expect(toast).toBeVisible();
await expect(toast).toBeHidden({ timeout: 8_000 }); // wait for it to disappear, if relevant
```

## Common assertions

| Intent | Assertion |
|---|---|
| Visible | `await expect(loc).toBeVisible()` |
| Text | `await expect(loc).toHaveText(/.../i)` |
| Input value | `await expect(input).toHaveValue('Maria')` |
| Button enabled/disabled | `await expect(btn).toBeEnabled()` |
| URL | `await expect(page).toHaveURL(/\/agenda$/)` |
| Title | `await expect(page).toHaveTitle(/HubrityP/)` |
| Attribute | `await expect(loc).toHaveAttribute('aria-invalid', 'true')` |
| List count | `await expect(page.getByRole('listitem')).toHaveCount(3)` |

## Soft assertions (use sparingly)

```ts
await expect.soft(page.getByText('A')).toBeVisible();
await expect.soft(page.getByText('B')).toBeVisible();
// The test continues even if one fails; reports all at the end.
```

Useful in a smoke test validating multiple elements on a landing. Do not use in a critical flow — if A failed, B probably did too, and you want to stop.

## Antipatterns

- `await page.waitForTimeout(2000)` — replace with `expect(...).toBeVisible()`.
- `await page.locator(...).first()` when `getByRole` with a name would do.
- Chaining many `nth-child` — illegible and fragile code.
- Re-implementing app logic in the test (computing the same CPF, deriving the same date) — use the same app helpers via import.
- `.evaluate(() => window.localStorage.setItem(...))` to "log in" — use `storageState`.
