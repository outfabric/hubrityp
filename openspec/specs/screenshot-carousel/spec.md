# screenshot-carousel Specification

## Purpose

Defines the reusable accessible screenshot carousel used in the homepage hero: navigation (arrows, dots, keyboard, swipe), the ordered hero screenshot set, image/performance handling, and the no-JS degradation behavior. Created by syncing change `public-homepage`.

## Requirements

### Requirement: Reusable accessible screenshot carousel

The system SHALL provide a reusable carousel component (used in the hero, reusable elsewhere) that displays 4–6 real-system screenshots in a product-window frame, each with a one-line caption, navigable by lateral arrows (≥ 44px, circular) on desktop and by touch swipe on mobile, with position dots below (active dot = `brand/600` pill). Auto-play MUST be disabled by default (advances only on user interaction). The carousel MUST be keyboard-operable (arrow keys move slides; controls are focusable with visible focus) and expose appropriate ARIA (e.g. roregion/group with labels, current-slide indication).

#### Scenario: Arrows and dots navigate slides

- **WHEN** the user activates the next arrow or a position dot
- **THEN** the carousel advances to the corresponding slide, updates the active dot, and updates the caption; it never auto-advances on its own

#### Scenario: Keyboard and swipe navigation

- **WHEN** a keyboard user focuses the carousel and presses ArrowRight/ArrowLeft (or a touch user swipes)
- **THEN** the slide changes accordingly with a visible focus state maintained on the controls

### Requirement: Carousel hero screenshot set

The hero carousel SHALL show, in order: 1) Dashboard operacional ("Hoje" + "Pendências"), 2) Agenda semanal com status de confirmação, 3) Evolução gerada pela IA no prontuário, 4) Lista de pacientes com filtros e tags, 5) Sala de videochamada. Screenshots are sourced from `public/screenshots/*.webp` (real files: `hoje-pendencias.webp`/`painel.webp`, `agenda.webp`, `evolucao.webp`, `pacientes.webp`, `telepsicologia.webp`). Each slide has a one-line descriptive caption.

#### Scenario: Hero carousel renders the ordered screenshot set

- **WHEN** the hero carousel renders
- **THEN** it shows the 5 ordered screenshots with their captions, each as an optimized image

### Requirement: Carousel performance and image handling

Carousel images SHALL be served via `next/image` in WebP (< 200 KB each) with explicit `width`/`height` (or aspect-ratio) to keep CLS < 0.1, with `loading="lazy"` for slides outside the initial viewport. Screenshots MUST use fictitious-but-plausible data only (no real patient data).

#### Scenario: Images have explicit dimensions and lazy loading

- **WHEN** carousel slides render
- **THEN** each image declares explicit dimensions (no layout shift) and off-screen slides use lazy loading

#### Scenario: Screenshots contain no real patient data

- **WHEN** any screenshot asset is reviewed
- **THEN** all displayed names/dates/clinical content are fabricated (no real patient data)

### Requirement: No-JS degradation

With JavaScript disabled, the carousel SHALL degrade to a single static first screenshot (no broken controls), keeping the hero usable.

#### Scenario: Carousel degrades to first image without JS

- **WHEN** JavaScript is disabled
- **THEN** the carousel renders the first screenshot statically with its caption and no non-functional interactive controls block the layout
