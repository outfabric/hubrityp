# public-homepage Specification

## Purpose

Defines the public marketing homepage at `/` (inside the `(public)` layout): its 10 ordered sections (Hero, Prova social, Problema, Solução timeline, Funcionalidades, Destaque IA, Confiança, Preços resumo, FAQ, CTA final), their exact copy/content angles, and the MVP-only + design-system compliance constraints. Created by syncing change `public-homepage`.

## Requirements

### Requirement: Homepage renders all 10 sections in order

The system SHALL render the homepage body at `/` (inside the `(public)` layout) with these 10 sections in this order: 1) Hero, 2) Prova social, 3) Problema, 4) Solução (timeline), 5) Funcionalidades, 6) Destaque IA, 7) Confiança (CFP/LGPD), 8) Preços (resumo), 9) FAQ, 10) CTA final. The page MUST have exactly one `<h1>` and a correct heading hierarchy.

#### Scenario: All sections render at desktop and mobile

- **WHEN** the homepage is rendered at 1440px and at 375px
- **THEN** all 10 sections render in order without layout break, with exactly one `<h1>`

### Requirement: Homepage sections match their canonical Figma frames per breakpoint

Each redesigned homepage section SHALL match its canonical Figma subframe — token
for token (color, typography, spacing, radius, shadow), in structure, in element
order, and in copy — at the two supported breakpoints (desktop 1440, mobile 375;
there is no tablet reference frame). The canonical node ids in file
`HoLOEqq9PXlo6IwLkz3FQ9` are: Hero `108:2` / `133:14`; Prova social `113:2` /
`135:2`; Problema `114:2` / `135:9`; Solução `116:2` / `135:42`; Confiança
`123:2` / `137:2`; Preços resumo `124:2` / `137:47` (desktop / mobile). The
sections NOT covered by a provided frame — Funcionalidades, Destaque IA, and CTA
final — are OUT OF SCOPE and MUST be left unchanged. The Hero screenshot-carousel's
SLIDE CONTENT (which screenshots and captions it cycles) is also out of scope and
unchanged; however, the carousel's POSITION and LAYOUT within the hero (its
placement relative to the copy block, container width, alignment) ARE in scope and
must match the Hero frame. No DS prohibition may be introduced to achieve a match (no
gradient, colored shadow, blur/glow, font-weight ≥ 700, or > 3 functional colors
per section); if the Figma appears to require a prohibited primitive, it is
flagged, not implemented.

#### Scenario: Each in-scope section is verified against its Figma frame at both widths

- **WHEN** a section's implementation is reviewed at its real Figma width (1440 for desktop frames, 375 for mobile frames)
- **THEN** a runtime screenshot confronted with the section's Figma frame plus a token-by-token comparison (computed CSS vs the section's `get_variable_defs` values) shows no unresolved discrepancy, and the section uses only DS tokens (no hardcoded off-token color/spacing/type)

#### Scenario: Out-of-scope sections are untouched

- **WHEN** the homepage renders after this change
- **THEN** Funcionalidades, Destaque IA, CTA final, and the Hero screenshot-carousel still render with their pre-change content and order, and the page still has exactly one `<h1>`

### Requirement: Hero section

The hero SHALL occupy the above-the-fold area as a **single centered column**: a
copy block centered at the top, with the screenshot carousel placed **below** it
(NOT beside it). The copy block contains, in order: a contextual badge "Feito para
psicólogos autônomos" (dot + `Label/caption`, `brand` accent, `radius-full` pill);
a headline; a subheadline; a primary CTA "Começar grátis — 14 dias" → `/signup`
and a secondary CTA "Ver funcionalidades" → `#funcionalidades` (both 48px tall);
and the microcopy line — all horizontally centered at both breakpoints (per
`108:2` / `133:14`). Below the copy block, the screenshot carousel renders
full-content-width and centered (desktop ≈1160px within the 1440 frame; mobile
343px within 375), its first slide remaining the LCP candidate (`priority`). The
carousel's slide content (see `screenshot-carousel`) is unchanged; only its
position/layout is aligned here.

The headline and subheadline use **breakpoint-specific tokens and condensed copy
variants** exactly as drawn in Figma:

- Desktop (`108:2`): headline "De 10 ferramentas espalhadas a um só sistema
  clínico." in `Display/xl` (52/56, -0.5); subheadline "Agenda, prontuário,
  videochamada, lembretes automáticos no WhatsApp e uma IA que transcreve a
  sessão e escreve a evolução — tudo em conformidade com o CFP e a LGPD." in
  `Lead` (20/30); microcopy "Sem cartão de crédito. Cancele quando quiser.";
  CTAs side by side (primary 244×48, secondary 200×48).
- Mobile (`133:14`): headline "De 10 ferramentas a um só sistema clínico." in
  `Display/md` (32/40, -0.2); subheadline "Agenda, prontuário, vídeo, WhatsApp
  automático e uma IA que escreve a evolução — em conformidade com o CFP e a
  LGPD." in `Body/lg` (17/28); microcopy "Sem cartão. Cancele quando quiser.";
  CTAs full-width stacked (343×48 each), primary above secondary.

#### Scenario: Hero renders the desktop tokens and copy at 1440

- **WHEN** the hero renders at 1440px
- **THEN** the headline is the desktop string in `Display/xl`, the subheadline is the desktop string in `Lead`, both CTAs sit side by side with the desktop microcopy, and the badge pill renders with the `brand` accent

#### Scenario: Hero renders the condensed tokens and copy at 375

- **WHEN** the hero renders at 375px
- **THEN** the headline is the condensed mobile string in `Display/md`, the subheadline is the condensed mobile string in `Body/lg`, and the two CTAs are full-width stacked (primary above secondary) with the condensed microcopy

#### Scenario: Hero is a single centered column with the carousel below the copy

- **WHEN** the hero renders at 1440px and at 375px
- **THEN** the copy block (badge, headline, subheadline, CTAs, microcopy) is horizontally centered, and the screenshot carousel renders BELOW the copy block (not beside it), centered and full-content-width — matching the stacked layout of `108:2` / `133:14`, with no two-column (text-left / carousel-right) arrangement

#### Scenario: Hero CTAs navigate correctly and preserve UTMs

- **WHEN** the visitor activates "Começar grátis — 14 dias" (with UTM params present in the URL)
- **THEN** navigation targets `/signup` preserving the UTM parameters
- **WHEN** the visitor activates "Ver funcionalidades"
- **THEN** the viewport scrolls to `#funcionalidades`

### Requirement: Prova social section

The system SHALL render the market-data bar below the hero as **two stat blocks**,
each a large figure in `Display/md` (32/40, -0.2, `text-primary`) over a
supporting caption in `Body/base` (15/22, `text-secondary`): (1) figure "até
5h/semana", caption "gastas com burocracia que o sistema resolve em minutos"; (2)
figure "40–60%", caption "das sessões hoje já são online ou híbridas no Brasil".
On desktop (`113:2`) the two blocks sit side by side separated by a 1px
`border-strong` vertical divider on a `surface-muted` band; on mobile (`135:2`)
they stack vertically with no divider. It MUST NOT contain fabricated testimonials
or invented metrics.

#### Scenario: Two stat blocks render with figure + caption at both breakpoints

- **WHEN** the prova-social section renders
- **THEN** it shows exactly two stat blocks ("até 5h/semana" and "40–60%") each with its supporting caption, the figures in `Display/md` and captions in `Body/base`, laid out side-by-side with a divider at 1440 and stacked at 375, and contains no testimonial/quote/avatar of a named person

### Requirement: Problema (mirror) section

The system SHALL render the "Você ainda faz isso?" section (title in `Display/lg`
40/46 desktop) with a list of exactly 5 mirror items — each an icon chip
(`radius-xl`/`radius-full`, `surface-sunken`/`brand` accent) followed by a one-line
label — and a closing line of recognition "Não é falta de organização. É excesso
de ferramentas que nunca foram feitas para você." The item labels use the
breakpoint copy variants drawn in Figma:

- Desktop (`114:2`, chips 40×40): "Manda lembrete de sessão pelo WhatsApp na mão,
  uma a uma"; "Registra a evolução no Word — ou no caderno"; "Gerencia a agenda no
  Google Agenda"; "Abre o Google Meet com um link que sempre expira"; "Controla os
  pacientes numa planilha de Excel".
- Mobile (`135:9`, chips 36×36): "Lembrete pelo WhatsApp, na mão"; "Evolução no
  Word ou no caderno"; "Agenda no Google Agenda"; "Google Meet com link que
  expira"; "Pacientes numa planilha de Excel".

#### Scenario: Mirror list has 5 items and a recognition closer at both breakpoints

- **WHEN** the problema section renders
- **THEN** it shows the title "Você ainda faz isso?", exactly 5 mirror items (desktop strings at 1440, condensed strings at 375), each with an icon chip, and the recognition closing line

### Requirement: Solução timeline section

The system SHALL render the value-cycle as 6 connected steps, each with a step
marker, a Lucide icon in a chip (`brand-700` glyph in a `brand-50` chip,
`radius-lg`), a step title, and a one-line explanation. Layout and labelling
follow the breakpoint frames:

- Desktop (`116:2`): a horizontal 6-column flow; each step carries an uppercase
  marker "PASSO 01" … "PASSO 06" in `Label/caption-upper` (12/16, ls 6); section
  title "Tudo que o consultório precisa, num só lugar que conversa consigo mesmo."
  (`Display/lg`) with subtitle "Cada módulo entrega para o próximo. Você faz uma
  vez; o sistema cuida do resto." (`Lead`); closing line "De ponta a ponta — sem
  sair do sistema." The 6 step titles/explanations: 1) "Paciente cadastrado" /
  "Cadastro completo, com termo de consentimento digital."; 2) "Sessão agendada" /
  "Marque na agenda — recorrência em 1 clique."; 3) "Lembrete no WhatsApp" /
  "Enviado sozinho. O paciente confirma com um toque."; 4) "Videochamada integrada"
  / "Sala criada na hora. Ninguém instala nada."; 5) "IA transcreve e escreve" /
  "A sessão termina e a evolução chega pronta."; 6) "Prontuário salvo" / "Você
  revisa, salva e o CFP está cumprido."
- Mobile (`135:42`): a vertical stack of 6 steps; each step title is inline-numbered
  "1." … "6." (no separate "PASSO" marker); section title condensed to "Tudo num só
  lugar que conversa consigo mesmo."; the desktop closing line "De ponta a ponta —
  sem sair do sistema." is NOT shown. Condensed step titles/explanations: 1)
  "Paciente cadastrado" / "com termo de consentimento digital."; 2) "Sessão
  agendada" / "recorrência em 1 clique."; 3) "Lembrete no WhatsApp" / "o paciente
  confirma num toque."; 4) "Videochamada integrada" / "ninguém instala nada."; 5)
  "IA escreve a evolução" / "você só revisa."; 6) "Prontuário salvo" / "CFP
  cumprido."

Step entrance uses a subtle scroll fade-in (see `homepage-performance`).

#### Scenario: Six steps render horizontally with PASSO markers and closer at 1440

- **WHEN** the solução section renders at 1440px
- **THEN** it shows 6 steps in a horizontal flow, each with a "PASSO 0N" marker, an icon chip, a title, and a one-line explanation, plus the closing line "De ponta a ponta — sem sair do sistema."

#### Scenario: Six steps render vertically with inline numbering and no closer at 375

- **WHEN** the solução section renders at 375px
- **THEN** it shows 6 steps stacked vertically with inline "N." numbered titles and condensed explanations, and the "De ponta a ponta" closing line is absent

### Requirement: Funcionalidades section (7 MVP cards)

The system SHALL render a `#funcionalidades` grid of 7 MVP feature cards (Agenda, Pacientes, WhatsApp Automático, Prontuário, Telepsicologia, IA Clínica, Dashboard Operacional) in a 3×2 + 1 layout on desktop (1 column on mobile), where the Dashboard card MAY span 2 columns. Each card has a Lucide icon, a short title (`Heading/h3`), a benefit-focused 2–3 line description, and an associated real-system screenshot thumbnail that opens in a modal/lightbox. Copy MUST match the PRD card table and present only MVP features.

#### Scenario: Seven cards render with correct content

- **WHEN** the funcionalidades grid renders
- **THEN** it shows exactly 7 cards with the listed titles, each with an icon, description, and a clickable screenshot thumbnail; the section has id `funcionalidades`

#### Scenario: Thumbnail opens an accessible lightbox

- **WHEN** the user activates a feature card thumbnail (click or keyboard)
- **THEN** an accessible modal/lightbox opens showing the larger screenshot, is dismissible via Escape and a close button, and restores focus to the trigger on close

### Requirement: Destaque IA section

The system SHALL render the AI-highlight section on a solid `brand/50` surface (no gradient/glow/blur) containing: a quantified title ("10 minutos de registro → 1 minuto. Em 30 sessões por semana, você recupera até 5 horas."); an explanatory subtitle; a side-by-side antes/depois comparison (antes: empty evolution editor with label "15 min escrevendo após cada sessão"; depois: AI-filled evolution screenshot with label "1 min revisando e salvando"); a list of 4 trust/safety items (consentimento obrigatório; áudio descartado em 24h; processamento via API sem armazenamento pelo provedor; revisão humana antes de salvar); and a CTA "Comece grátis e experimente na primeira sessão" → `/signup`.

#### Scenario: AI highlight uses a solid surface and shows antes/depois + 4 trust items

- **WHEN** the destaque-IA section renders
- **THEN** the surface is solid `brand/50` (no gradient/blur), the antes/depois pair renders with the two labels, the 4 trust items render, and the CTA links to `/signup`

### Requirement: Confiança section with exact regulatory text

The system SHALL render the trust section with an uppercase eyebrow "CONFORMIDADE
& SEGURANÇA" (`Label/caption-upper`, `brand-700`) above the title "Construído para
o jeito que psicólogos brasileiros precisam trabalhar." (`Display/md`), a panel of
exactly 8 checkmarked guarantees (checkmark glyph in `brand-700`, panel on
`surface` with `radius-2xl`, `border`, `Shadow/Light/xs`), and the closing line
"Você foca no paciente. A burocracia regulatória é problema nosso." The 8
guarantees MUST carry the EXACT resolution numbers and years; on desktop (`123:2`)
they render as a 2-column grid, on mobile (`137:2`) as a single column with the
condensed crypto line:

1. "Prontuário conforme a Resolução CFP nº 001/2009"
2. "Documentos no padrão da Resolução CFP nº 06/2019"
3. "Telepsicologia conforme a Resolução CFP nº 09/2024"
4. "Gravação somente com consentimento (Res. CFP nº 13/2022)"
5. "Dados em servidores no Brasil — São Paulo (LGPD)"
6. "Criptografia AES-256 em repouso e TLS 1.3 em trânsito" (mobile condensed:
   "Criptografia AES-256 e TLS 1.3")
7. "Guarda de prontuário por 20 anos (Lei 13.787/2018)"
8. "Somente psicólogos com CRP ativo podem criar conta" (mobile condensed:
   "Somente psicólogos com CRP ativo criam conta")

Checkmarks use `brand-700` (no extra semantic green).

#### Scenario: Exactly 8 guarantees with correct resolution codes and eyebrow

- **WHEN** the confiança section renders
- **THEN** it shows the "CONFORMIDADE & SEGURANÇA" eyebrow and lists exactly 8 checkmarked guarantees containing the literal strings "001/2009", "06/2019", "09/2024", "13/2022", "AES-256", "TLS 1.3", "13.787/2018", and "CRP ativo", in a 2-column panel at 1440 and a single column at 375

### Requirement: Preços resumo section

The system SHALL render a pricing summary with an uppercase eyebrow "PLANOS"
(`Label/caption-upper`, `brand-700`) above the title "Simples. Sem surpresa."
(`Display/lg`), 2 plan cards (monthly only, no annual toggle) sourced from
`subscription-plans-config`, and the microcopy. Each card (`surface`,
`radius-2xl`, `border`) contains: plan name (`Heading/h3`), price + "/mês", a
one-line tagline, a checkmarked feature list (`brand-600` checks), and a primary
"Começar grátis" CTA. The Avançado card carries a "Mais popular" badge.

- Essencial — R$ 60/mês. Tagline desktop "Para começar com o essencial do
  consultório." / mobile "O núcleo clínico do consultório." Features: "Agenda,
  pacientes e prontuário"; "Telepsicologia integrada"; "Documentos CFP e escalas
  clínicas" (mobile "Documentos CFP e escalas"); "Dashboard operacional".
- Avançado — R$ 90/mês, "Mais popular". Tagline "Tudo do Essencial + automação e
  IA." Features: "Tudo do Essencial"; "Lembretes automáticos no WhatsApp" (mobile
  "Lembretes no WhatsApp"); "Transcrição e nota com IA".
- Microcopy desktop "14 dias grátis para testar tudo. Sem cartão de crédito.
  Cancele quando quiser." / mobile "14 dias grátis. Sem cartão. Cancele quando
  quiser."
- Desktop (`124:2`) renders the two cards side by side; mobile (`137:47`) stacks
  them vertically. The "Ver planos completos →" link to `/precos` renders below the
  microcopy on BOTH breakpoints (the mobile frame omits it, but the link is kept on
  mobile by decision — the conversion path to `/precos` is preserved).

#### Scenario: Two plan cards reflect central config with per-card CTA

- **WHEN** the preços-resumo section renders
- **THEN** it shows the "PLANOS" eyebrow, Essencial (R$ 60) and Avançado (R$ 90, "Mais popular") with values from the central config, each card with its feature list and a "Começar grátis" CTA, and no annual toggle

#### Scenario: The full-pricing link renders on both breakpoints

- **WHEN** the preços-resumo section renders at 1440px and at 375px
- **THEN** a "Ver planos completos →" link to `/precos` renders below the microcopy at both widths

### Requirement: CTA final section

The system SHALL render a closing CTA section on a solid `brand/700` surface with `text/inverse`: title "Comece hoje. Sem compromisso."; primary CTA "Criar conta grátis — 14 dias" → `/signup`; microcopy "Configuração em 5 minutos. Sua primeira sessão registrada com IA ainda hoje." No gradient.

#### Scenario: Final CTA renders on solid brand surface

- **WHEN** the CTA-final section renders
- **THEN** the surface is solid `brand/700` with inverse text (no gradient), the title and microcopy render, and the CTA links to `/signup` (preserving UTMs)

### Requirement: MVP-only and DS-compliance constraints for homepage copy

The homepage SHALL present only MVP features as available (no PIX/cobrança, Receita Saúde, recibos de reembolso in hero, feature cards, or pricing). It MUST comply with DS prohibitions: no gradients, colored shadows, glassmorphism/blur/glow, > 3 functional colors per section, font-weights ≥ 700, or emojis in UI (the WhatsApp screenshot is an image asset, not UI text). Copy/content MUST live in a content constants module, not inline magic strings.

#### Scenario: No post-MVP feature appears as available

- **WHEN** the full homepage renders
- **THEN** no section presents PIX/cobrança, Receita Saúde, or recibos de reembolso as an available feature

#### Scenario: No prohibited visual primitives are used

- **WHEN** the homepage styles are inspected
- **THEN** no `linear-gradient`/`radial-gradient` backgrounds, `backdrop-filter` blur, or font-weight ≥ 700 are applied to homepage sections
