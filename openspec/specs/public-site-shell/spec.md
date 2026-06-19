# public-site-shell Specification

## Purpose

Defines the structural shell of the public marketing site: the `(public)` route group with its shared Server-Component layout (header/main/footer landmarks), the accessibility skip link and landmark order, content-width/spacing conventions, and the public 404 page. Created by syncing change `public-site-foundation`.

## Requirements

### Requirement: Public route group and shared marketing layout

The system SHALL provide a `(public)` route group under `src/app/(public)/` with a shared `layout.tsx` that wraps every public marketing/legal page with the public header, a single `<main>` landmark, and the public footer. The layout MUST be a Server Component, MUST NOT import service-role clients, and MUST NOT render any authenticated app surface.

The folder name `(public)` is organizational only; auth gating is decided by `src/middleware.ts` (see `middleware-gating`). The current placeholder `src/app/page.tsx` is moved into the `(public)` group; the homepage body itself is delivered by the `public-homepage` change — this change provides the shell only.

#### Scenario: Public layout renders landmarks

- **WHEN** any page inside the `(public)` group is server-rendered
- **THEN** the response contains exactly one `<header>` (banner), one `<main>`, and one `<footer>` (contentinfo) landmark, in that document order

#### Scenario: Public layout never leaks authenticated data

- **WHEN** the public layout is rendered for an authenticated session
- **THEN** no patient data, clinical content, or service-role-scoped data is fetched or rendered; only the session presence (boolean) is used to switch the header CTAs

### Requirement: Accessibility skip link and landmark order

The public layout SHALL render a keyboard-focusable "Pular para o conteúdo" skip link as the first focusable element, targeting the `<main>` element (`#conteudo`). The skip link MUST be visually hidden until focused.

#### Scenario: Skip link is the first tab stop

- **WHEN** a keyboard user presses Tab on first load of a public page
- **THEN** the first focused element is the skip link, and activating it moves focus to `#conteudo`

### Requirement: Content-width and spacing conventions

The public layout SHALL expose a reusable container that constrains content to a max width of 1200px (general) with a narrower 720px variant for long-form reading (legal pages), with horizontal padding of `space/8` (32px) on desktop and `space/4` (16px) on mobile, using DS tokens only (no hardcoded hex/px outside tokens).

#### Scenario: Container applies max width and responsive padding

- **WHEN** the container renders at a viewport ≥ 1280px
- **THEN** content is centered at ≤ 1200px wide with 32px horizontal padding
- **WHEN** the container renders at a 375px viewport
- **THEN** horizontal padding is 16px and content does not overflow horizontally

### Requirement: Public 404 page

The system SHALL provide a public `not-found.tsx` for the `(public)` group that renders a DS-consistent 404 screen: a large "404" in `brand/600`, the headline "Não encontramos esta página.", a message ("O endereço pode ter mudado ou não existe mais. Vamos te levar de volta ao começo."), and two CTAs in left-to-right visual order — a secondary "Voltar para a homepage" → `/` followed by a primary "Criar conta grátis" → `/signup` — wrapped in the public header/footer.

#### Scenario: Unknown public URL renders the 404

- **WHEN** an anonymous client requests a non-existent path such as `/funcionalidades`
- **THEN** the response status is 404, the page renders the "404" numeral and the "Não encontramos esta página." headline, the "Voltar para a homepage" link to `/`, and the "Criar conta grátis" link to `/signup`

#### Scenario: 404 is reachable without authentication

- **WHEN** an anonymous client requests an unknown public path
- **THEN** the middleware does not redirect to `/login` and the 404 page renders directly
