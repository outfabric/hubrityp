## Why

Four settings areas are already implemented as routes under `/configuracoes/` (locais, whatsapp, lembretes, agenda) but are invisible to users: the sidebar hard-codes `href="/configuracoes/locais"`, there is no index page or layout at `/configuracoes`, and reaching any area besides "Locais" requires typing the URL manually. This change adds the navigation shell — an index page, breadcrumb, and internal tabs for Lembretes — so all existing settings features are discoverable from the UI.

## What Changes

- New index page at `/configuracoes` with interactive cards for each settings area (Locais de atendimento, WhatsApp, Lembretes, Agenda)
- New group layout `src/app/(app)/configuracoes/layout.tsx` with a persistent breadcrumb showing the user's position within settings
- Internal tabs (link-based) in Lembretes for its three sub-sections: Configuracao, Templates, Historico
- Sidebar item label corrected from `Configuracoes` to `Configurações` and `href` changed from `/configuracoes/locais` to `/configuracoes`
- Static data module `settings-areas.ts` defining area metadata (label, description, href, icon) as a Server Component data source
- New integrações index page at `/configuracoes/integracoes` with a single card (WhatsApp) for v1, designed to scale as future integrations are added (Asaas, Receita Saúde, Google Calendar, e-CAC). Required so the "Integrações" segment in the breadcrumb has a real destination instead of 404

## Capabilities

### New Capabilities
- `settings-shell`: Settings navigation structure — index page with interactive card grid, breadcrumb navigation across all settings sub-routes, and tab-based sub-navigation within Lembretes. Covers layout, data-testid conventions, a11y, mobile responsiveness, and keyboard navigation

### Modified Capabilities
- `app-shell`: Sidebar "Configurações" item changes label (cedilha fix) and href (from `/configuracoes/locais` to `/configuracoes`)

## Impact

- **Routes added:** `src/app/(app)/configuracoes/page.tsx`, `src/app/(app)/configuracoes/layout.tsx`, `src/app/(app)/configuracoes/integracoes/page.tsx`
- **Components added:** `settings-index-card.tsx` (or co-located in page), `settings-breadcrumb.tsx`, `lembretes-tabs.tsx`
- **Data file:** `settings-areas.ts` (static array, no DB fetch)
- **Modified file:** `src/app/(app)/sidebar-nav.tsx` (label + href)
- **Dependencies:** No new npm packages — uses existing shadcn/ui `Card`, `Breadcrumb`, Lucide icons (`MapPin`, `MessageCircle`, `Bell`, `Calendar`, `Settings`, `ChevronRight`), and `next/link`
- **DB / RLS / Server Actions:** None — purely UI/navigation
- **E2E tests:** New `src/__tests__/e2e/seeded/configuracoes-navigation.spec.ts`
