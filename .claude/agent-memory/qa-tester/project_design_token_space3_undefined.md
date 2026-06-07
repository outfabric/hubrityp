---
name: design-token-space3-undefined
description: globals.css design tokens are named --ds-space-* / --color-* ; bare --space-3 is undefined and silently breaks CSS via invalid var()
metadata:
  type: project
---

In `src/app/globals.css`, the spacing scale tokens are named `--ds-space-N` (e.g. `--ds-space-3` = `.75rem`, `--ds-space-4` = `1rem`). There is NO `--space-N` token. Color tokens are `--color-brand-700` etc. (defined, aliasing `--ds-brand-*`).

**Why this matters for QA:** a rule using `var(--space-3)` (no `ds-` prefix) is invalid-at-computed-value because the var is undefined → the whole property resolves to its initial value (`auto` for top/left/right). This fails *silently* — no console error, the rest of the rule applies. The QA-4 "Pular tour" tour-button fix did exactly this: `top/right: var(--space-3)` collapsed the absolutely-positioned close button to its static top-left position, overlapping the popover title, even though `position:absolute!important; left:auto!important` were correctly applied.

**How to apply:** When verifying any CSS positioning/spacing fix, don't trust that the rule "is in the served chunk" — check the *resolved* value. Use `getComputedStyle(el).getPropertyValue('--token')` to confirm a referenced custom property is actually defined (empty string = undefined). For geometry, measure bounding boxes (`isTopRight`, `overlapsTitle`), not just computed `left`/`right`, because `left:auto` legitimately reports a resolved px value. Related: [[playwright-cli-invocation]], [[onboarding-checklist-and-tour-qa]].
