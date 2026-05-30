import { expect, test } from '@playwright/test';

/**
 * @ai-transcription -- Settings negative-auth (section 5.2).
 *
 * An anonymous request to the AI-transcription settings surface
 * (`/configuracoes/transcricao-ia`) must be redirected to `/login` by the Edge
 * middleware before any Server Component runs (so no DB query / settings upsert
 * is made on behalf of an unauthenticated caller).
 *
 * This test intentionally carries NO storageState — it inherits the project's
 * empty default context, so the request hits middleware as a fully anonymous
 * user. Mirrors `review-anonymous-blocked.spec.ts`.
 *
 * Spec: openspec/changes/ai-transcription-settings-ui — "Anonymous access is
 * blocked".
 */
test.describe('@ai-transcription settings — anonymous access is blocked', () => {
  test('anonymous /configuracoes/transcricao-ia redirects to /login', async ({ page }) => {
    const response = await page.goto('/configuracoes/transcricao-ia');

    // Playwright follows redirects; the final response is the login page.
    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/configuracoes/transcricao-ia');

    // The login form must be rendered — never the settings surface.
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('transcription-settings-form')).toHaveCount(0);
  });
});
