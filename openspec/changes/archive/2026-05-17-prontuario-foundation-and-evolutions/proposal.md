## Why

The prontuario eletrônico is the most regulated module in the product (CFP 001/2009, Lei 13.787/2018, LGPD art. 11). Psychologists currently scatter session records across paper, Word, and Google Drive — none of which provide auditable access, versioning, or regulatory retention. This foundational change bootstraps the data layer (evolutions, versioning, audit log), the core CRUD with 30-day immutability enforcement, and the prontuario shell page so that subsequent changes (hipoteses, plano, escalas, documentos, anexos, exportacao) can build on a tested, secure base. Additionally, this change performs a long-overdue middleware defensive sweep, gating four route prefixes (`/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes`) that currently fall through to `'public'` in `classifyPath()` despite living inside the `(app)` route group.

## What Changes

- New domain schema `src/shared/db/schema/medical-records/` with tables `evolutions`, `evolution_versions`, and a reusable `audit_log` (designed for PRD 11 adoption later)
- RLS enabled on all three tables; NO DELETE policies (20-year retention mandate)
- New module `src/modules/medical-records/` (lib, server, components, barrel)
- Prontuario shell page with Tabs at `/pacientes/[id]/prontuario` — only "Evolucoes" tab functional; others show "Em breve" empty state
- Evolution CRUD: create, update (with 30-day window enforcement and addendum versioning), list, detail, version history
- Template system for evolutions: TCC, psicanalise, sistemica, ABA, livre, custom
- Tiptap editor with auto-save reusing the existing `useAutoSave` hook from `src/modules/patients/lib/use-auto-save.ts`
- Audit log write on every prontuario/evolution read (action: `prontuario.read`, `evolution.read`)
- Inngest cron job `prontuario/remind-missing-evolution` — daily scan for sessions `done` >7 days without linked evolution
- **Middleware defensive sweep:** `classifyPath()` extended to classify `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes` as `'app'` (gated), closing a class of unauthenticated-access bugs

## Capabilities

### New Capabilities
- `medical-records-foundation`: Schema domain bootstrap (tables, RLS, indexes), module structure, prontuario shell page with disabled-tab placeholders
- `evolutions`: Evolution CRUD with template system, Tiptap editor, auto-save, 30-day immutability with addendum versioning, version history panel
- `audit-log`: Generic audit_log table (reusable by PRD 11), server-side write path on prontuario reads, RLS (user SELECT own rows only, no DELETE)
- `middleware-gating`: Defensive sweep adding `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes` to the `'app'` path class in `classifyPath()`

### Modified Capabilities
- (none — no existing spec requirements change; anamnesis tab behavior is unchanged)

## Impact

- **Database:** 3 new tables + migration with RLS + indexes (Drizzle + manual RLS appendix)
- **Drizzle schema:** New `src/shared/db/schema/medical-records/` domain folder; `schema/index.ts` re-export updated
- **Middleware (`src/middleware.ts`):** `classifyPath()` gains four new prefixes; existing behavior for `/dashboard` unchanged
- **Module:** `src/modules/medical-records/` — new barrel with lib (Zod schemas, template validators, immutability helpers), server (6 actions + audit writer), components (EvolutionEditor, TemplateSelector, VersionHistoryPanel, AutoSaveIndicator)
- **Routes:** 4 new pages under `src/app/(app)/pacientes/[id]/prontuario/`
- **Inngest:** New cron function `prontuario/remind-missing-evolution`
- **Dependencies:** No new npm packages (Tiptap already installed; `useAutoSave` already exists)
- **Regulatory:** LGPD art. 11 (sensitive health data), Lei 13.787/2018 (20-year retention, no deletion), CFP 001/2009 (mandatory session records), RN-05.02 (30-day immutability)
- **Security:** RLS on every table, audit log on reads, no DELETE policies, middleware sweep closes unauthenticated route access
