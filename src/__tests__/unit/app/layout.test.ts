import { describe, expect, it, vi } from 'vitest';

// `src/app/layout.tsx` calls `Inter(...)` at module-evaluation time and imports
// `sonner`, neither of which works outside the Next.js bundler. Stub them so we
// can import the module purely to assert its `metadata` export. The `globals.css`
// import is resolved to an empty module by Vitest, so it needs no stub.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--ds-font-sans', className: 'inter' }),
}));
vi.mock('sonner', () => ({ Toaster: () => null }));

describe('root layout metadata', () => {
  it('uses "Hubrity" as the document title', async () => {
    const { metadata } = await import('@/app/layout');
    expect(metadata.title).toBe('Hubrity');
  });

  it('carries no legacy HubrityP branding in the title', async () => {
    const { metadata } = await import('@/app/layout');
    expect(metadata.title).not.toContain('HubrityP');
  });
});
