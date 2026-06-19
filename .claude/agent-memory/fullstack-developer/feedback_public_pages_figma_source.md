---
name: public-pages-figma-source-of-truth
description: For public-site work, the live Figma is the ONLY visual source of truth; docs/design-system/public-pages-handoff.md is obsolete
metadata:
  type: feedback
---

For the public marketing site (chrome + homepage + pricing + legal + 404), the
live Figma files are the single visual source of truth.

**Why:** the public-site-foundation change (archived 2026-06-18) was built from
the *text* handoff `docs/design-system/public-pages-handoff.md` + token names in
`rules.md`, not from the live Figma frames. The Figma evolved after the handoff
was written (its node ids are stale — e.g. pricing is now `83:4`/`128:2`, not the
handoff's `128:2`-on-another-page), and the handoff also encoded intentional
deviations. Result: the shipped header/footer drifted from the design. On
2026-06-19 the user declared the handoff doc **obsolete — disregard it** and
treat Figma as the only truth.

**How to apply:** when implementing or fixing any public page, pull the live
frame from Figma (see [[figma-sources]]) and match it; do not trust the handoff
doc. Caveat the user accepted: when a Figma value fails WCAG AA contrast, flag
the item rather than silently keeping the old accessible value — replicate Figma
but never silently regress accessibility. Also flag values that look like design
placeholders before applying (e.g. a `@gmail.com` contact address) and copy
changes that drop LGPD/data-residency signals from the footer. Part of the fix
should retire/redirect the handoff doc so the next dev doesn't repeat the trap.
