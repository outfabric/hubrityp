import { expect, test } from '@playwright/test';

/**
 * @ai-transcription -- Negative-auth (section 11.1).
 *
 * An anonymous request to the AI-transcription review surface
 * (`/dashboard/transcricoes`) must be redirected to `/login` by the Edge
 * middleware before any Server Component runs (so no DB query is made).
 *
 * This test intentionally carries NO storageState — it inherits the project's
 * empty default context, so the request hits middleware as a fully anonymous
 * user. Mirrors the canonical pattern in `auth.spec.ts`.
 *
 * Spec: specs/ai-transcription-review-ui/spec.md
 *   Scenario "Anonymous access is blocked".
 */
test.describe('@ai-transcription review — anonymous access is blocked', () => {
  test('anonymous /dashboard/transcricoes redirects to /login', async ({ page }) => {
    const response = await page.goto('/dashboard/transcricoes');

    // Playwright follows redirects; the final response is the login page.
    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/dashboard/transcricoes');

    // The login form must be rendered — never the review surface.
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('transcription-review-form')).toHaveCount(0);
  });

  test('anonymous review subpath redirects to /login', async ({ page }) => {
    // A concrete-looking id on the deep review path. Middleware gates the whole
    // `/dashboard` prefix, so this never reaches the page (no DB lookup).
    const reviewPath = '/dashboard/transcricoes/abc-123/revisar';
    const response = await page.goto(reviewPath);

    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe(reviewPath);

    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('transcription-review-form')).toHaveCount(0);
  });
});
