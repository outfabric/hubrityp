## Why

On `/signup`, the three required LGPD consent checkboxes (Terms of Use, Privacy Policy, Sensitive Data Treatment) render **static text with no links** to the content the user must read before accepting. This is both a UX gap and a legal risk: under the LGPD (art. 8º) consent must be *informed*, and the sensitive-data consent (art. 11 — patients' health data, the core of the product) is the most critical of the three. Users currently have no in-context path to read what they are agreeing to.

## What Changes

- The anchor words in each consent label become real links to the already-published public legal pages, opening in a **new tab** so the in-progress signup form state (name, email, password, CRP) is preserved.
- `ConsentRow`'s `label` prop changes from `string` to `ReactNode` so a label can carry inline links. No other prop changes.
- The link is separated from the checkbox toggle so that **clicking a link opens the page without marking/unmarking the checkbox** (read ≠ accept) — the `<a>` must not sit inside the `<label>` element (or must `stopPropagation`). This preserves distinct keyboard and screen-reader semantics.
- Links are styled on-token (`text-brand-600` / `hover:text-brand-700`, `underline underline-offset-2`, `target="_blank" rel="noopener noreferrer"`) with an optional `ExternalLink` affordance, meeting WCAG AA (contrast ≥ 4.5:1, not distinguished by color alone).
- Link targets: Terms → `/termos-de-uso`, Privacy → `/politica-de-privacidade`, Sensitive Data → `/politica-de-privacidade#lgpd`.

This is a **presentation-only** change. No change to `signupInputSchema` (the three flags stay `z.literal(true)`), the `signUp` Server Action, FormData serialization, hidden inputs, `register`/`setValue`, testids, `aria-describedby` error wiring, middleware, or the database.

## Capabilities

### New Capabilities
<!-- None. The behavior extends an existing capability rather than introducing a new one. -->

### Modified Capabilities
- `account-registration`: the signup page requirement is extended so the three consent labels present the consent copy as *informed* consent — each with an inline link to its legal page opening in a new tab, and with link activation decoupled from checkbox toggling. The validation/acceptance behavior (all three flags required `true`) is unchanged.

## Impact

- **Code (single file):** `src/modules/registration/components/signup-form.tsx` — `SignupForm` consent rows and the local `ConsentRow` helper.
- **Link targets (referenced, not modified):** `/termos-de-uso` and `/politica-de-privacidade` (public routes, classified `'public'` in `middleware.ts`; the `#lgpd` anchor already exists).
- **Tests:** add/adjust a unit test asserting each label renders a link with the correct `href` + `target="_blank"` + `rel="noopener noreferrer"`; existing submit/validation and schema tests stay untouched and green.
- **Out of scope (flagged, not built):** the privacy policy has no dedicated sensitive-data section — only the generic `#lgpd` anchor. Adding a `#dados-sensiveis` section (purpose, legal basis, retention) and repointing the third checkbox to it is a content gap requiring legal validation; for now the third checkbox points to `#lgpd`.
- **Dependencies:** none added.
