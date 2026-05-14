## Context

HubrityP has four settings areas implemented as Next.js pages under `src/app/(app)/configuracoes/`:

| Area | Route | Exists since |
|---|---|---|
| Locais de atendimento | `/configuracoes/locais` | agenda-locations change |
| WhatsApp | `/configuracoes/integracoes/whatsapp` | whatsapp-foundation change |
| Lembretes | `/configuracoes/lembretes` (+ `/templates`, `/templates/[templateKey]`, `/historico`) | whatsapp-reminders + inbox changes |
| Agenda | `/configuracoes/agenda` | agenda-settings change |

The sidebar (`sidebar-nav.tsx`) has a single "Configuracoes" item with `href="/configuracoes/locais"`. No layout or index page exists at `/configuracoes`. Users can only reach settings areas other than Locais by typing URLs manually.

Each existing page renders its own `<h1>` and content inside `<div className="mx-auto max-w-[1200px]">`. There is no shared settings chrome. The template-edit page (`/configuracoes/lembretes/templates/[templateKey]`) already renders a manual breadcrumb, but it is self-contained and not shared with other routes.

## Goals / Non-Goals

**Goals:**
- Users can navigate to all 4 settings areas from a discoverable index page
- Users can orient themselves within settings via a persistent breadcrumb
- Users can switch between Lembretes sub-sections (Configuracao, Templates, Historico) via tabs without returning to the index
- Sidebar item label uses the correct Portuguese cedilha ("Configurações") and links to the index
- Deep-links, browser back/forward, and refresh all work correctly
- Mobile-first responsive layout following DS Salvia
- Full keyboard navigability and WCAG 2.1 AA compliance

**Non-Goals:**
- Reorganizing internal logic of any settings page (Server Actions, data fetching, RLS)
- Role-gating or permission checks on settings cards (all visible to all authenticated psychologists)
- Search, command palette, or global settings discovery beyond the index
- Dark mode changes beyond what the token system inherits automatically
- Changes to the template-edit breadcrumb (it already works and will be superseded by the shared layout breadcrumb)

## Decisions

### 1. Navigation pattern: index with interactive cards

**Chosen:** A Server Component at `/configuracoes/page.tsx` rendering 4 interactive cards (`Card interactive` from DS) in a responsive grid (1 col mobile, 2 cols md, 3 cols lg). Each card links to its area via `next/link`. No sub-sidebar, no horizontal tabs at the index level.

**Rationale:**
- The DS defines `Card interactive` with hover state (border-strong, cursor pointer) — it is the prescribed component for a clickable navigation surface
- Sub-sidebar would create overlay-in-overlay on mobile (the app already has a sidebar), violating the DS principle of "consistencia radical"
- Horizontal tabs do not scale past ~6 items and create confusion when Lembretes itself has internal tabs
- Cards convey metadata (icon, label, description) that tabs and sidebar items cannot

**Trade-off:** One extra click compared to a sub-sidebar or tabs always visible. Acceptable because psychologists configure settings infrequently — the common path is "enter, adjust one area, leave."

### 2. Tabs only for Lembretes sub-sections

**Chosen:** `Tabs underline` (DS) within the Lembretes area for its 3 sub-sections: Configuracao (`/configuracoes/lembretes`), Templates (`/configuracoes/lembretes/templates`), Historico (`/configuracoes/lembretes/historico`). Other settings areas have no internal tabs.

**Rationale:**
- Lembretes has 3 facets of the same concept (configuration, templates, history). They share context and the user mentally groups them. Tabs express this "facets of one thing" relationship
- Locais, WhatsApp, and Agenda are self-contained pages — adding tabs would be artificial grouping
- DS prescribes `Tabs underline` with tab idle text secondary, active text primary + border-bottom 2px brand-500

**Implementation:** Tabs are `<Link>` elements styled to match the DS tab pattern, not state-controlled React components. This preserves deep-linking, refresh, and browser back/forward. The active tab is determined by `pathname` matching.

### 3. Group layout for breadcrumb persistence

**Chosen:** A `layout.tsx` at `src/app/(app)/configuracoes/layout.tsx` that renders the breadcrumb above `{children}`. The layout does NOT duplicate the app shell (header, sidebar) — it nests inside `src/app/(app)/layout.tsx`.

**Rationale:**
- Next.js App Router layouts persist across navigations within their subtree. Placing the breadcrumb here means it renders on every settings route without duplication
- The breadcrumb component reads `pathname` and maps URL segments to human-readable labels using a static lookup
- The index page (`/configuracoes`) shows only the breadcrumb root ("Configurações" as non-linked current page)

**Breadcrumb segment mapping (static, no DB):**

| Segment | Label |
|---|---|
| `configuracoes` | Configurações |
| `locais` | Locais de atendimento |
| `integracoes` | Integrações |
| `whatsapp` | WhatsApp |
| `lembretes` | Lembretes |
| `templates` | Templates |
| `historico` | Histórico |
| `agenda` | Agenda |

Dynamic segments like `[templateKey]` are resolved by the page itself (it already has the template label). The breadcrumb component renders known segments and omits unknown ones, so the template-edit page's existing breadcrumb can be replaced by the layout breadcrumb once dynamic segment resolution is implemented. For this change, `[templateKey]` renders as the raw key in the shared breadcrumb — the existing page-level breadcrumb in `templates/[templateKey]/page.tsx` will be removed since the layout breadcrumb supersedes it.

### 4. Sidebar item: href to `/configuracoes`, label with cedilha

**Chosen:** Change the sidebar's "Configuracoes" entry to `{ label: 'Configurações', href: '/configuracoes' }`. The existing `pathname.startsWith(item.href)` logic continues to mark the item active on all sub-routes.

**Rationale:**
- The index is the canonical entry point. Deep-linking to `/configuracoes/locais` from the sidebar assumes Locais is the "default" area, which is an arbitrary choice
- The cedilha fix ("Configurações" not "Configuracoes") follows the DS glossary ("Configurações" is in the fixed glossary)
- `pathname.startsWith('/configuracoes')` matches `/configuracoes`, `/configuracoes/locais`, `/configuracoes/lembretes/templates`, etc., so active state continues working

### 5. Cards use static data, no fetch

**Chosen:** A constant array in a co-located file `settings-areas.ts` exporting `{ label, description, href, icon }` for each area. The index page imports this array and maps to Card components. No Server Action, no DB query.

**Rationale:**
- Settings areas are fixed at build time — they do not vary per user, per session, or per feature flag in the current design
- Static data means the index page renders instantly with no loading state, no Suspense boundary, no error state
- If future features add role-gating, the array can be filtered without changing the rendering pattern

### 6. Existing page adjustments

**Chosen:** Existing settings pages (`locais/page.tsx`, `agenda/page.tsx`, `lembretes/page.tsx`, `integracoes/whatsapp/page.tsx`, `lembretes/historico/page.tsx`, `lembretes/templates/page.tsx`) keep their current `<h1>` elements. The layout breadcrumb provides hierarchical context above them. The `<h1>` is the page title, the breadcrumb is the wayfinding — they serve different purposes.

The manual breadcrumb in `templates/[templateKey]/page.tsx` is removed since the shared layout breadcrumb covers the same trail. The `<h1>` remains.

### 7a. Integrações index page (resolves prior open question)

**Chosen:** Create `src/app/(app)/configuracoes/integracoes/page.tsx` as an index page listing available integrations as `Card interactive` (DS), in the same pattern as the main settings index. For v1, the page displays a single card: WhatsApp. The page exists so that the breadcrumb segment "Integrações" links to a real destination (instead of 404 or being skipped).

**Rationale:**
- The breadcrumb on `/configuracoes/integracoes/whatsapp` already renders "Integrações" as a linked intermediate segment per Decision 3. Without this page, the link would 404.
- Hiding the segment instead would create inconsistency: `Configurações > WhatsApp` (one route) vs. `Configurações > Lembretes > Templates` (another) — same depth in the URL, different breadcrumb depth.
- Disabling the link (rendering "Integrações" as plain text mid-trail) is non-standard for breadcrumbs and would require a dedicated DS pattern we do not have.
- A real index page costs little (1 page, 1 card today) and scales naturally: future integrations (Asaas billing, Receita Saúde, Google Calendar, e-CAC) become additional cards on the same page without structural change.

**Implementation:**
- Server Component, no fetch, static data.
- Reuses the same `Card interactive` styling and grid layout as the main index (1 col mobile, 2 cols md, 3 cols lg) — even with 1 card, the responsive grid is in place for future cards.
- Card data is co-located in `src/app/(app)/configuracoes/integracoes/integrations.ts` (analogous to `settings-areas.ts`), exporting a `INTEGRATIONS` constant. v1 entry: WhatsApp / "Conecte sua conta para enviar lembretes e mensagens." / `MessageCircle` / href `/configuracoes/integracoes/whatsapp`.
- The main settings index card "WhatsApp" (Decision 7) continues to link directly to `/configuracoes/integracoes/whatsapp` — it is a shortcut. Users can also reach the same page via `Configurações > Integrações > WhatsApp`. This redundancy is intentional: the main index optimizes for the common case (jumping directly to the only integration today); the integrations sub-index optimizes for discovery and future scale.
- Page title `<h1>` "Integrações" (28px/600).
- `data-testid="integrations-index-page"` on container, `data-testid="integration-card-whatsapp"` on the card.

### 7. Microcopy (verbatim from the decided direction)

| Area | Card label | Card description | Icon |
|---|---|---|---|
| Locais | Locais de atendimento | Endereços e modalidades onde você atende presencial ou online. | `MapPin` |
| WhatsApp | WhatsApp | Conecte sua conta do WhatsApp para enviar lembretes e mensagens. | `MessageCircle` |
| Lembretes | Lembretes | Personalize quando e como avisar pacientes sobre suas sessões. | `Bell` |
| Agenda | Agenda | Horários de trabalho, duração padrão e regras de agendamento. | `Calendar` |

## Risks / Trade-offs

- **[Extra click to reach settings area]** — Users who previously bookmarked `/configuracoes/locais` still land directly on Locais. Only the sidebar entry changes. Psychologists configure settings rarely, so one extra click from sidebar is acceptable
- **[Breadcrumb for dynamic segments]** — `[templateKey]` appears as raw key (e.g., `lembrete_24h`) in the shared breadcrumb, not the human-readable label. This is cosmetically imperfect but functional. A future enhancement can pass the label via `generateMetadata` or a parallel segment param. For this change, we remove the page-level breadcrumb in `templates/[templateKey]/page.tsx` and accept the raw key display
- **[Lembretes tabs only benefit one area]** — If future settings areas gain sub-sections, tabs may need to be generalized. YAGNI — we add tabs only where needed today (Lembretes) and extract a shared pattern when a third occurrence appears
- **[No loading state on index page]** — Because data is static, the index has no Suspense/loading. If future cards need dynamic data (e.g., "WhatsApp: connected" badge), a Suspense boundary will need to be added. Not needed now

## Open Questions

None remaining. The prior open question about the breadcrumb `integracoes` segment (whether to skip it, accept 404, or create an index) was resolved in favor of creating a real index page — see Decision 7a.
