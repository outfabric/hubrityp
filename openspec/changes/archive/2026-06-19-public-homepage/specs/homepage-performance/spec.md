## ADDED Requirements

### Requirement: Homepage performance budget

The homepage SHALL meet a Lighthouse mobile (simulated 3G) Performance score ≥ 90, Largest Contentful Paint (LCP) < 2.5s, and Cumulative Layout Shift (CLS) < 0.1. The hero screenshot (probable LCP element) MUST be optimized (WebP, appropriately sized) and preloaded; all images MUST declare explicit dimensions or aspect-ratio to avoid layout shift. Images MUST be served via `next/image` with automatic optimization and lazy loading for below-the-fold assets.

#### Scenario: Hero LCP image is preloaded and sized

- **WHEN** the homepage renders
- **THEN** the hero/LCP image is served as an optimized WebP via `next/image` with explicit dimensions and a preload hint, and below-the-fold images use lazy loading

#### Scenario: No layout shift from images

- **WHEN** the page loads and images resolve
- **THEN** no image causes a layout shift (each declares width/height or aspect-ratio), keeping CLS < 0.1

### Requirement: Reduced-motion compliance

All homepage motion (solution-timeline scroll fade-in, carousel transitions, non-essential transitions) SHALL be disabled when `prefers-reduced-motion: reduce` is set. Content MUST remain fully visible and usable with motion disabled (fade-in must not leave elements permanently hidden).

#### Scenario: Reduced-motion disables scroll animations

- **WHEN** the user has `prefers-reduced-motion: reduce`
- **THEN** the solution-timeline steps render immediately at full opacity (no scroll fade-in), carousel transitions are instant, and no non-essential animation runs

#### Scenario: Fade-in never hides content permanently

- **WHEN** scroll animations are enabled but JavaScript fails to trigger them
- **THEN** the affected sections still render fully visible (no content stuck at opacity 0)

### Requirement: Responsive integrity from 320px to 1920px

The homepage SHALL remain functional and legible from 320px to 1920px viewports. Below 320px the layout MUST NOT break (text may ellipsis/wrap, screenshots scale down), and all 10 sections stack correctly on mobile.

#### Scenario: Usable at 320px and 1920px

- **WHEN** the homepage renders at 320px and at 1920px
- **THEN** content does not overflow horizontally, all sections remain readable, and interactive targets stay ≥ 44px on mobile
