import { expect, test } from '@playwright/test';

// Anonymous smoke tests tagged @health. Demonstrates the full pipeline:
// Testcontainers boot → migrations → app build → app serve → browser
// navigate → assertion. Two concerns covered here:
//   1. The home page renders end-to-end (basic plumbing smoke).
//   2. `/api/health` returns the documented payload shape — external
//      uptime probes parse this, so the contract is pinned in e2e
//      against the production-built Next.js server (not just unit/integration).
test.describe('@health smoke', () => {
  test('home page returns 200 and renders the Hubrity logo', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    // The Logo renders in both the header (banner) and footer (contentinfo),
    // so the role query is scoped to the banner landmark to stay unambiguous
    // under Playwright strict mode.
    const header = page.getByRole('banner');
    await expect(header.getByRole('img', { name: 'Hubrity' })).toBeVisible();
  });

  test('GET /api/health returns 200 with the documented payload shape', async ({ request }) => {
    // `request` does not carry storageState; the endpoint is public, so
    // this also pins "no auth required" from the spec.
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, db: 'reachable' });
    expect(typeof body.timestamp).toBe('string');
    // The timestamp must be a valid ISO-8601 string (round-trips through
    // `new Date(...).toISOString()` losslessly).
    const ts = body.timestamp as string;
    expect(new Date(ts).toISOString()).toBe(ts);

    // No PII / secrets in the response — only the documented keys.
    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'timestamp']);
  });
});
