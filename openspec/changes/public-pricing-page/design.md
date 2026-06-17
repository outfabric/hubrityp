## Context

This change renders the `/precos` page body inside the `(public)` shell from `public-site-foundation`, consuming the central `subscription-plans-config`. Visual source of truth: Figma `Public · Pricing` (`128:2`) + `docs/design-system/public-pages-handoff.md` §6. Billing is monthly only (RF-14.28/RN-14.05). The page must satisfy CDC (clear price display) and DS prohibitions (no gradients/blur; contrast via solid `brand/*` surfaces).

It depends on `public-site-foundation` (mandatory) and can reuse two components from `public-homepage` (the `<details>` FAQ accordion and the `cta-final`) if that change merges first; otherwise it re-implements the same shared pattern.

## Goals / Non-Goals

**Goals:**
- A faithful `/precos` page: 2 config-driven plan cards, an expandable 9-row comparison table, a billing FAQ, and a final CTA.
- Single source of truth for plan data (no hardcoded prices), with the Essencial⊂Avançado invariant enforced by the config + tests.
- Graceful empty-plans fallback and allowlisted `?plano=` slugs.

**Non-Goals:**
- The shell, plans config, SEO infra (→ `public-site-foundation`).
- The homepage and its pricing summary (→ `public-homepage`).
- Real payment/checkout, PIX, or invoice generation (post-MVP; only mentioned descriptively).

## Decisions

### D1 — Reuse the central plans config and shared components
Plan cards, comparison table, and pricing summary all read from `subscription-plans-config`. The comparison table is derived from the same feature matrix the config exposes, so the homepage summary and `/precos` can never disagree. The FAQ uses the homepage `<details>` accordion component (shared) and the final CTA reuses `cta-final`. Rationale: DRY across the two pricing surfaces; the invariant is tested once at the config level.

### D2 — Comparison table is data-driven and a11y-correct
Render the table from the feature matrix (rows) × plans (columns) as a real `<table>` with `<th scope>` headers; ✓/— are accessible (visually a `brand/700` check / `border/strong` dash, with an accessible label like "incluído"/"não incluído" for screen readers, not a bare icon). The Avançado column is tinted `brand/50`. On mobile, collapse into stacked per-plan blocks (CSS), keeping semantics. Rationale: WCAG table semantics + no horizontal overflow at 375px.

### D3 — `?plano=` slug is allowlisted
The CTA builds `/signup?plano=<slug>` only from the config's known slugs (`essencial`/`avancado`). The slug is never taken from free-form input on this page, avoiding an open parameter that downstream signup could mishandle.

### D4 — Empty-plans fallback
If the validated config yields zero plans (deploy/config error), render the contact fallback (support email) instead of empty cards, reusing the foundation's empty-plans helper. Rationale: the PRD edge case forbids publishing pricing without at least one priced plan.

### D5 — Nota fiscal copy framed accurately
The "Todas as cobranças geram nota fiscal automaticamente." line is presented as dependent on the payment provider (Asaas) and the billing feature, which is post-MVP — so it lives in the billing FAQ as forward-looking copy, not as an available plan feature. This keeps the MVP-only rule intact.

## Risks / Trade-offs

- **[Pricing drift between homepage summary and /precos]** → Both read the single config; an invariant unit test asserts the matrix; changing a price in config updates both.
- **[Comparison table a11y / mobile overflow]** → Real table semantics + SR labels for ✓/—; mobile stacked layout tested at 375px.
- **[Open `?plano=` parameter]** → Slug allowlisted from config; test asserts only known slugs are emitted.
- **[Shipping pricing with no plans]** → Empty-plans fallback + test.
- **[Implying post-MVP billing exists]** → Nota fiscal framed as provider-dependent/forward-looking; MVP-only guard test.

## Open Questions

- If `public-homepage` is not merged before this change, decide whether to extract the FAQ + CTA components into the foundation module first (preferred) or duplicate temporarily. Recommended order: foundation → homepage → pricing so both components already exist.
- Exact 9 comparison rows wording: take the labels verbatim from RF-14.27 and keep them in the central config so the table is generated, not hand-written.
