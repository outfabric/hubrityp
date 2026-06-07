---
name: default-off-flag-breaks-full-view-ui-suites
description: A default-OFF UI feature flag silently breaks pre-existing "full enabled-view" RTL suites that assert every card is a navigable link
metadata:
  type: project
---

When a feature flag defaults to OFF and freezes UI entry points (e.g. WhatsApp/Lembretes settings cards rendered as non-navigable `<Card>` with no `<Link>` wrapper), any pre-existing RTL suite that statically imports the page and asserts `card.closest('a')` has an `href` will FAIL once the freeze lands — the card is no longer wrapped in an anchor, so `closest('a')` is `null` and `toHaveAttribute` throws `received value must be an HTMLElement`.

**Why:** the flag is read from `clientEnv` at render time; the unit test env leaves `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` unset → default `false` → frozen cards. The "full view" suite implicitly assumed the enabled view.

**How to apply:** the fix that keeps both intents is to split coverage — keep a `*-whatsapp-freeze.test.tsx` driving both flag states, and force the flag ON in the original full-view suite via `vi.stubEnv('NEXT_PUBLIC_WHATSAPP_UI_ENABLED', 'true')` + `vi.resetModules()` + dynamic `await import(...)` of the page (top-level static import is too early to see the stub), with `vi.unstubAllEnvs()` in `afterEach`. This mirrors the pattern the freeze suites already use. Seen in the `disable-whatsapp-reminders-ui` change, Section 5. Related: [[client-runtime-import-from-server-barrel]].
