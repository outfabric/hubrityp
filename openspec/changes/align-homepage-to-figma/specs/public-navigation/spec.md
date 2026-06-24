# public-navigation (delta)

Aligns the public footer to its canonical Figma frames `126:7` (desktop 1440) and
`138:36` (mobile 375) in file `HoLOEqq9PXlo6IwLkz3FQ9`. Only the footer requirement
changes; the header requirements are unaffected by this change. Token values are
the DS variables read via `get_variable_defs` (note: on the footer's dark surface
the DS tokens resolve to dark-context values).

## MODIFIED Requirements

### Requirement: Public footer

The system SHALL render a footer on every public page on a dark surface
(`background #1c1917`), containing: the Hubrity brand lockup (the tricolor symbol
with a light "hubrity" wordmark) and the tagline "O sistema único para o
consultório de psicólogos autônomos no Brasil." (`Body/sm` 13/20,
`text-secondary #d6d3d1`); a "Produto" column (Funcionalidades anchor, Preços); a
"Legal" column (Política de Privacidade, Termos de Uso); a "Contato" column
(support email `hubrity.platform@gmail.com`); and a copyright line "© 2026
Hubrity. Feito para psicólogos autônomos brasileiros." Column headings use the
uppercase `Label/caption-upper` (12/16, ls 6) in `text-tertiary #a8a29e`; links and
the tagline use `text-secondary #d6d3d1`; rule/divider uses `border #3a3633`. The
layout is responsive per the breakpoint frames:

- Desktop (`126:7`, height 285): the brand block sits on the left and the three
  link columns are clustered to the right, on one row, with the copyright on its
  own line below a divider.
- The brand lockup MUST be **flush-left** within the brand block — its left edge
  aligned with the tagline below it. The lockup's rendered box MUST hug the mark's
  intrinsic width (it MUST NOT stretch to the brand block's column width and center
  the mark, which visually shifts the logo to the right of the tagline).
- Mobile (`138:36`, height 540): the brand block, the three columns (Produto,
  Legal, Contato), and the copyright stack vertically in that order, separated by
  the divider above the copyright.

The footer component MUST be reusable by the authenticated app.

#### Scenario: Footer legal links resolve to functional pages

- **WHEN** the footer renders
- **THEN** "Política de Privacidade" links to `/politica-de-privacidade`, "Termos de Uso" links to `/termos-de-uso`, and the support email `hubrity.platform@gmail.com` is rendered as a `mailto:` link

#### Scenario: Footer Legal column omits the standalone LGPD link

- **WHEN** the footer Legal column renders
- **THEN** it contains exactly two links — Política de Privacidade and Termos de Uso — and no separate "LGPD" link

#### Scenario: Footer brand lockup uses the dark-surface tone

- **WHEN** the footer renders on its dark surface
- **THEN** the brand symbol keeps its tricolor fills and the "hubrity" wordmark renders light, not an all-white lockup

#### Scenario: Footer brand lockup is flush-left, not stretched/centered

- **WHEN** the footer renders
- **THEN** the brand lockup's left edge aligns with the tagline's left edge, and the lockup's rendered width equals the mark's intrinsic width (the `<svg>` box does not stretch to the brand-block column width), so the logo is not horizontally shifted to the right of the tagline

#### Scenario: Footer tokens and layout match the Figma frames per breakpoint

- **WHEN** the footer renders at 1440px and at 375px
- **THEN** the surface is `#1c1917`, column headings are `Label/caption-upper` in `#a8a29e`, links/tagline are `#d6d3d1`, and the layout is brand-left / columns-right at 1440 and fully stacked at 375

#### Scenario: Footer is a contentinfo landmark

- **WHEN** the footer renders
- **THEN** it is exposed as a single `contentinfo` landmark with accessible column headings
