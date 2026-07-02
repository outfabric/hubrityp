## 1. Widen `ConsentRow` to accept rich labels

- [ ] 1.1 In `src/modules/registration/components/signup-form.tsx`, change the `ConsentRow` `label` prop type from `string` to `React.ReactNode` (import `ReactNode` from `react` or use `React.ReactNode`); no other prop changes.
- [ ] 1.2 Add a small local link helper/element for consent anchors: `<a target="_blank" rel="noopener noreferrer">` styled `text-brand-600 hover:text-brand-700 underline underline-offset-2`, inheriting the design-system `focus-visible` ring (do not override), with `onClick={(e) => e.stopPropagation()}` so a link click never toggles the checkbox. Optionally append a 14px `ExternalLink` (lucide) with `aria-hidden` after the anchor text.

## 2. Replace the three consent labels with informed-consent copy + links

- [ ] 2.1 `acceptedTerms`: render "Li e aceito os **Termos de Uso**" with the bold span as a link to `/termos-de-uso`.
- [ ] 2.2 `acceptedPrivacy`: render "Li e aceito a **Política de Privacidade**" with the bold span as a link to `/politica-de-privacidade`.
- [ ] 2.3 `acceptedSensitiveData`: render "Autorizo o tratamento dos meus **dados sensíveis conforme a LGPD**" with the bold span as a link to `/politica-de-privacidade#lgpd`.
- [ ] 2.4 Keep the `<Label htmlFor={inputId}>` association, testids (`signup-form-terms/privacy/sensitive-data`), hidden `<input {...register}>`, `setValue`, and `aria-describedby` error wiring byte-for-byte unchanged.

## 3. Unit test: links render correctly and reading is decoupled from accepting

- [ ] 3.1 In `src/__tests__/unit/modules/registration/`, add/extend the signup-form spec: assert each consent label renders an anchor with the correct `href` (`/termos-de-uso`, `/politica-de-privacidade`, `/politica-de-privacidade#lgpd`), plus `target="_blank"` and `rel` containing `noopener` and `noreferrer`.
- [ ] 3.2 Assert **read ≠ accept**: clicking a consent-label link while its checkbox is unchecked does not toggle the checkbox (checkbox stays unchecked); clicking the checkbox control still toggles the consent flag.
- [ ] 3.3 Regression: confirm the existing submit test still passes unchanged — all three checked → success; one unchecked → per-field consent error. Do NOT modify `signup-input-schema.test.ts` or `sign-up.int.test.ts`.

## 4. Accessibility verification

- [ ] 4.1 Validate link contrast against the card background: `brand-600` must meet WCAG AA (≥ 4.5:1); if borderline, switch to `brand-700`. Confirm underline keeps the link distinguishable without color (WCAG 1.4.1).
- [ ] 4.2 Manually verify keyboard: each link is tabbable, activates on Enter, focus ring is visible; Space on the checkbox toggles it; label text remains coherent for screen readers.
