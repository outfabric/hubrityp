## Context

The signup form (`src/modules/registration/components/signup-form.tsx`) renders three LGPD
consent checkboxes through a local `ConsentRow` helper. Today `ConsentRow` takes
`label: string` and renders it inside a `<Label htmlFor={inputId}>` next to a Radix
`<Checkbox>`. The label text is static — no link to the legal content the user is consenting to.

Relevant constraints of the current structure:

- The checkbox is a **Radix primitive**, not a native `<input>`. `ConsentRow` registers a
  hidden `<input type="hidden" {...register}>` for the field `name`, bridges Radix's
  `onCheckedChange` to RHF via `setValue`, and toggles via the `<Label htmlFor>` association.
- The `setValue` cast to `true` and the `aria-describedby` error wiring are load-bearing and
  must not change — the schema keeps the three flags as `z.literal(true)`.
- Link targets already exist and are public: `/termos-de-uso`,
  `/politica-de-privacidade` (with `#lgpd` anchor). No routing/middleware work.

This is a presentation-only change. See `proposal.md` for the LGPD motivation (informed
consent, art. 8º/11).

## Goals / Non-Goals

**Goals:**
- Make each consent label carry an inline link to its legal page, opening in a **new tab** so
  the in-progress form state survives.
- Guarantee **read ≠ accept**: activating a link (mouse or keyboard) must never toggle the
  checkbox; the checkbox/box still toggles on its own.
- Keep the change on-token (brand link styling, WCAG AA) and within a single component file.

**Non-Goals:**
- No change to `signupInputSchema`, the `signUp` Server Action, FormData/`'on'` serialization,
  hidden inputs, `register`/`setValue`, testids, or the `aria-describedby` error wiring.
- No new privacy-policy content. The third checkbox points at the generic `#lgpd` anchor; a
  dedicated `#dados-sensiveis` section is a separate, legally-reviewed change (out of scope).
- No middleware/route/DB work.

## Decisions

### D1 — `ConsentRow.label`: `string` → `React.ReactNode`
Widening the prop lets a label carry inline JSX (text + `<a>`) without introducing a bespoke
`links`/`renderLabel` prop. **Alternative considered:** a structured `{ text, linkHref,
linkLabel }` prop — rejected as over-engineered for three fixed, hand-written labels (YAGNI),
and it would force the sensitive-data phrasing (link mid-sentence) into an awkward template.

### D2 — Decouple link activation from checkbox toggle (the critical decision)
**Chosen: keep the link inside the label text but neutralize the toggle on the `<a>` itself**
(handoff Option B), rather than pulling all text out of `<Label>` (Option A).

Rationale:
- **Preserves current affordance.** Option A demotes `<Label>` to a minimal click target and
  moves the descriptive text to an `aria-describedby` sibling — which *removes* the existing
  "click anywhere on the text toggles the box" behavior. Option B keeps it.
- **Lowest regression surface.** The checkbox `id`/`htmlFor`, testids, and `aria-describedby`
  error wiring stay byte-for-byte; only the label *content* changes.
- **The HTML label spec already helps us.** A click whose target is an *interactive content
  descendant* of a `<label>` (an `<a href>`) does **not** trigger the label's activation
  behavior — so the box should not toggle on a link click even without extra code. Because the
  control here is a Radix button (not a native input) and we want this guarantee to be explicit
  and test-backed rather than relying on browser nuance, we add a defensive
  `onClick={(e) => e.stopPropagation()}` on the `<a>` (defense-in-depth, not the sole barrier).
- **Keyboard holds naturally.** The `<a>` is separately tab-focusable; Enter follows the link,
  Space toggles the checkbox only when focus is on the box. No key handler needed.

**Alternative (Option A) considered and rejected** for the affordance-loss and higher
structural churn above. It remains a valid fallback if a future layout makes the inline link
visually cramped.

### D3 — Link element: `<a target="_blank" rel="noopener noreferrer">`, not `next/link`
Targets are static public pages opened in a new tab. A plain `<a>` avoids unnecessary prefetch
and is the simplest correct element. `rel="noopener noreferrer"` is mandatory with
`target="_blank"` to prevent reverse-tabnabbing. **Alternative:** `next/link` — the footer uses
it, but for same-tab in-app navigation; it adds prefetch we don't want here. Either renders the
same anchor, so the unit test (asserting `href`/`target`/`rel`) is agnostic to the choice.

### D4 — On-token styling + affordance
`text-brand-600 hover:text-brand-700 underline underline-offset-2`; inherit the design-system
`focus-visible` ring (do not override). Underline ensures the link is distinguishable **without
relying on color** (WCAG 1.4.1). Optional `ExternalLink` icon (lucide, 14px, `aria-hidden`)
after the anchor text to signal the new-tab jump. Contrast must validate **≥ 4.5:1** on the card
background; if `brand-600` is borderline, fall back to `brand-700`.

### D5 — Copy (phrases coherent without the link, for screen readers)
- Terms: "Li e aceito os **Termos de Uso**" → `/termos-de-uso`
- Privacy: "Li e aceito a **Política de Privacidade**" → `/politica-de-privacidade`
- Sensitive: "Autorizo o tratamento dos meus **dados sensíveis conforme a LGPD**" →
  `/politica-de-privacidade#lgpd`

Only the bold span becomes the `<a>`; the accessible name of each link is the bold text.

## Risks / Trade-offs

- **[Link click still toggles the box]** → primary guard is the HTML interactive-descendant
  rule; defensive `stopPropagation` on the `<a>` backs it up; a unit/interaction test asserts
  a link click does not flip the checkbox state.
- **[Contrast regression at `brand-600`]** → validate against the card background; escalate to
  `brand-700` if it fails AA. Underline keeps the link perceivable even at borderline contrast.
- **[Reverse tabnabbing via `target="_blank"`]** → `rel="noopener noreferrer"` required on
  every anchor; enforced by the unit test.
- **[Third checkbox points at a generic anchor]** → accepted for this delivery; recorded as an
  out-of-scope content gap needing legal review (dedicated `#dados-sensiveis` section).
- **[Screen-reader coherence]** → labels read sensibly without the link; existing
  `aria-describedby` error association is untouched.

## Migration Plan

Single-file frontend edit; no data or schema migration. Deploy is a standard Vercel rollout.
**Rollback:** revert the component change — the schema, action, and wire format are unchanged,
so there is no state or contract to unwind.

## Open Questions

- None blocking. The `#dados-sensiveis` privacy-policy section is deferred by design (legal
  review), not an open question for this change.
