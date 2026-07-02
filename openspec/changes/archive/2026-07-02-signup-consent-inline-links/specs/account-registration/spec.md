## ADDED Requirements

### Requirement: Consent labels present informed-consent links to the legal pages

The `/signup` consent rows SHALL render each of the three LGPD consent labels as *informed*
consent: the anchor words of every label MUST be a link to the corresponding public legal page,
opening in a new browser tab so the in-progress form state is preserved. The three flags remain
required (`z.literal(true)`); this requirement governs presentation only and MUST NOT alter the
validation, submission, testids, or error wiring defined by the existing signup requirements.

The label-to-link mapping SHALL be:

| Consent field | Anchor text (link) | `href` |
|---|---|---|
| `acceptedTerms` | Termos de Uso | `/termos-de-uso` |
| `acceptedPrivacy` | Política de Privacidade | `/politica-de-privacidade` |
| `acceptedSensitiveData` | dados sensíveis conforme a LGPD | `/politica-de-privacidade#lgpd` |

Each label's sentence MUST remain coherent when the link text is read as plain text (screen
reader friendliness), e.g. "Li e aceito os **Termos de Uso**".

#### Scenario: Each consent label renders a link to its legal page

- **WHEN** the signup form is rendered and the three consent rows are inspected
- **THEN** the `acceptedTerms` label contains an anchor with `href="/termos-de-uso"`, the `acceptedPrivacy` label contains an anchor with `href="/politica-de-privacidade"`, and the `acceptedSensitiveData` label contains an anchor with `href="/politica-de-privacidade#lgpd"`

#### Scenario: Consent links open in a new tab without reverse-tabnabbing

- **WHEN** any of the three consent-label anchors is inspected
- **THEN** the anchor has `target="_blank"` and `rel` containing `noopener` and `noreferrer`

#### Scenario: Activating a consent link does not toggle the checkbox

- **WHEN** the user clicks (or activates via keyboard) the link inside a consent label while that checkbox is unchecked
- **THEN** the linked legal page opens and the checkbox remains unchecked (reading is decoupled from accepting)

#### Scenario: Clicking the checkbox still toggles consent

- **WHEN** the user clicks the checkbox control of a consent row
- **THEN** the corresponding consent flag toggles and RHF validation runs as before, unchanged from the pre-existing behavior

#### Scenario: Consent links are distinguishable without relying on color

- **WHEN** a consent-label link is rendered
- **THEN** it carries an underline (not color alone) and inherits the design-system focus-visible ring, and its brand link color meets WCAG AA contrast (≥ 4.5:1) against the card background

#### Scenario: Consent testids and acceptance validation are unchanged

- **WHEN** the signup form is submitted with all three consents checked, and separately with any one left unchecked
- **THEN** the checkboxes still expose `data-testid="signup-form-terms"`, `signup-form-privacy`, `signup-form-sensitive-data`; the all-checked submit succeeds and the one-unchecked submit surfaces the existing per-field consent error — identical to behavior before this change
