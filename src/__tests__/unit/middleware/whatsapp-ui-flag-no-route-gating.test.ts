import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Section 5.5 — verify the WhatsApp UI feature flag is purely cosmetic: it must
 * NOT gate, block, or redirect any route. The freeze lives entirely in the UI
 * layer (sidebar item + settings cards). Direct navigation to
 * `/caixa-de-entrada` (or any other route) must keep working exactly as before
 * the flag existed — the middleware must not reference the flag at all.
 *
 * This is a source-level guard rather than a behavioural test: coupling the
 * middleware's route gating to the cosmetic flag would be the regression we are
 * protecting against, and the cheapest unambiguous signal is the flag's
 * absence from the middleware source.
 */
describe('middleware — WhatsApp UI flag does not gate routes', () => {
  const middlewareSource = readFileSync(
    fileURLToPath(new URL('../../../middleware.ts', import.meta.url)),
    'utf8',
  );

  it('does not reference the WhatsApp UI flag anywhere in middleware', () => {
    expect(middlewareSource).not.toContain('NEXT_PUBLIC_WHATSAPP_UI_ENABLED');
  });

  it('keeps the inbox route gating decoupled from the cosmetic flag', () => {
    // The inbox path may appear (it is a normal gated app route), but never in
    // combination with the feature flag. Guard against a future regression that
    // couples route gating to the UI-only flag.
    const flagReferences = (middlewareSource.match(/NEXT_PUBLIC_WHATSAPP_UI_ENABLED/g) ?? [])
      .length;
    expect(flagReferences).toBe(0);
  });
});
