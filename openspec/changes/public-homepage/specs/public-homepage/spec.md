## ADDED Requirements

### Requirement: Homepage renders all 10 sections in order

The system SHALL render the homepage body at `/` (inside the `(public)` layout) with these 10 sections in this order: 1) Hero, 2) Prova social, 3) Problema, 4) Solução (timeline), 5) Funcionalidades, 6) Destaque IA, 7) Confiança (CFP/LGPD), 8) Preços (resumo), 9) FAQ, 10) CTA final. The page MUST have exactly one `<h1>` and a correct heading hierarchy.

#### Scenario: All sections render at desktop and mobile

- **WHEN** the homepage is rendered at 1440px and at 375px
- **THEN** all 10 sections render in order without layout break, with exactly one `<h1>`

### Requirement: Hero section

The hero SHALL occupy the above-the-fold area and contain: a contextual badge "Feito para psicólogos autônomos" (`brand/50`+`brand/700`); a `Display/xl` headline communicating "many tools → one clinical system"; a `Lead` subheadline that concretely lists MVP features (agenda, prontuário, videochamada, WhatsApp automatizado, IA que transcreve e escreve a evolução) and mentions CFP + LGPD compliance; a primary CTA "Começar grátis — 14 dias" → `/signup`; a secondary CTA "Ver funcionalidades" → `#funcionalidades`; microcopy "Sem cartão de crédito. Cancele quando quiser."; and the screenshot carousel (see `screenshot-carousel`).

#### Scenario: Hero passes the 5-second test content

- **WHEN** the hero renders
- **THEN** it shows the "Feito para psicólogos autônomos" badge, a headline conveying tool-consolidation, a subheadline naming the MVP features and CFP/LGPD, and both CTAs with the no-credit-card microcopy

#### Scenario: Hero CTAs navigate correctly and preserve UTMs

- **WHEN** the visitor activates "Começar grátis — 14 dias" (with UTM params present in the URL)
- **THEN** navigation targets `/signup` preserving the UTM parameters
- **WHEN** the visitor activates "Ver funcionalidades"
- **THEN** the viewport scrolls to `#funcionalidades`

### Requirement: Prova social section

The system SHALL render a market-data bar below the hero (`bg/surface-muted`) presenting the burocracy pain stat ("Psicólogos gastam até 5 horas por semana com burocracia que o sistema resolve em minutos.") and the complementary stat ("40–60% das sessões hoje são online ou híbridas"). It MUST NOT contain fabricated testimonials or invented metrics.

#### Scenario: Market stats render without fabricated testimonials

- **WHEN** the prova-social section renders
- **THEN** it shows the two market stats and contains no testimonial/quote/avatar of a named person

### Requirement: Problema (mirror) section

The system SHALL render the "Você ainda faz isso?" section with a list of exactly 5 short mirror items (WhatsApp manual reminders; evolução no Word/caderno; agenda no Google Agenda; Google Meet com link que expira; pacientes em planilha Excel) and a closing line of recognition (not judgment), e.g. "Não é falta de organização. É excesso de ferramentas que nunca foram feitas para você."

#### Scenario: Mirror list has 5 items and a recognition closer

- **WHEN** the problema section renders
- **THEN** it shows the provocative title, exactly 5 mirror items, and the recognition closing line

### Requirement: Solução timeline section

The system SHALL render the value-cycle as 6 connected steps (horizontal timeline desktop / vertical mobile): 1) Paciente cadastrado, 2) Sessão agendada, 3) Lembrete WhatsApp + confirmação 1-clique, 4) Videochamada integrada, 5) Sessão finalizada → IA transcreve e gera evolução, 6) Prontuário salvo, CFP cumprido — each with a Lucide icon (`brand/700` in a `brand/50` chip) and a one-line explanation, closing with "De ponta a ponta — sem sair do sistema." Step entrance uses a subtle scroll fade-in (see `homepage-performance`).

#### Scenario: Six connected steps render with icons and closer

- **WHEN** the solução section renders
- **THEN** it shows 6 ordered steps each with an icon + one-line explanation and the closing line, laid out horizontally ≥ desktop breakpoint and vertically on mobile

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

The system SHALL render the trust section titled "Construído para o jeito que psicólogos brasileiros precisam trabalhar." with a checklist of exactly 8 guarantees using the EXACT resolution numbers and years: (1) Resolução CFP nº 001/2009; (2) Resolução CFP nº 06/2019; (3) Resolução CFP nº 09/2024; (4) Res. CFP nº 13/2022; (5) Dados em servidores no Brasil — São Paulo (LGPD); (6) Criptografia AES-256 em repouso, TLS 1.3 em trânsito; (7) Guarda de prontuário por 20 anos (Lei 13.787/2018); (8) Somente psicólogos com CRP ativo podem criar conta. Closing line: "Você foca no paciente. A burocracia regulatória é problema nosso." Checkmarks use `brand/700` (no extra semantic green).

#### Scenario: Exactly 8 guarantees with correct resolution codes

- **WHEN** the confiança section renders
- **THEN** it lists exactly 8 checkmarked guarantees containing the literal strings "001/2009", "06/2019", "09/2024", "13/2022", "AES-256", "TLS 1.3", "13.787/2018", and "CRP ativo"

### Requirement: Preços resumo section

The system SHALL render a pricing summary titled "Simples. Sem surpresa." with 2 plan cards (monthly only, no annual toggle) sourced from `subscription-plans-config`: Essencial R$ 60/mês and Avançado R$ 90/mês with a "Mais popular" badge on Avançado; microcopy "14 dias grátis para testar tudo. Sem cartão de crédito. Cancele quando quiser."; and a "Ver planos completos →" link to `/precos`.

#### Scenario: Two plan cards reflect central config

- **WHEN** the preços-resumo section renders
- **THEN** it shows Essencial (R$ 60) and Avançado (R$ 90, "Mais popular") with values from the central config and a link to `/precos`, with no annual toggle

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
