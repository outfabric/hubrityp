import { expect, test } from '@playwright/test';

// Anonymous smoke test tagged @health. Demonstrates the full pipeline:
// Testcontainers boot → migrations → app build → app serve → browser
// navigate → assertion. Authenticated suites land in wave 3.
test.describe('@health smoke', () => {
  test('home page returns 200 and renders the HubrityP heading', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'HubrityP' })).toBeVisible();
  });
});
