## Why

Psychologists must record diagnostic hypotheses for each patient (RF-05.10) as part of the electronic medical record, with educational guardrails reinforcing that CID-10 usage in psychology is referential, not a medical diagnosis (RF-05.11, CFP ethical limit). The foundation change (`prontuario-foundation-and-evolutions`) ships the prontuario shell with a placeholder "Hipoteses" tab — this change replaces that placeholder with the full implementation: hypothesis CRUD, CID-10 autocomplete over ~12k codes, status tracking (investigating/confirmed/discarded), and mandatory audit logging. It is sequenced now because the shell page, audit_log table, and RLS patterns are already established by the foundation change.

## What Changes

- New `diagnostic_hypotheses` table in `src/shared/db/schema/medical-records/` with RLS (user_id-scoped SELECT/INSERT/UPDATE, no DELETE — retention mandate)
- Static CID-10 JSON file (`src/modules/medical-records/lib/cid10-data.json`) generated from Datasus CSV via `scripts/build-cid10-data.ts`, powering an in-memory fuzzy search utility
- Zod schemas for hypothesis create/update with "at least one of description OR cid10_code" refinement
- Server Actions: `createHypothesis`, `updateHypothesis`, `listHypothesesByPatient`, `updateHypothesisStatus` — each writes to `audit_log`
- Server Action `searchCid10` wrapping the static in-memory search
- `HypothesesTab` component replacing the "Em breve" placeholder inside the prontuario shell, with: educational warning banner (RF-05.11), hypothesis cards with status badges, add/edit Sheet form with CID-10 Command/Popover combobox and descriptive-mode textarea
- Unit tests for CID-10 search and Zod schemas, integration tests for CRUD + RLS isolation, E2E for the full tab flow

## Capabilities

### New Capabilities
- `diagnostic-hypotheses`: Hypothesis CRUD with status lifecycle, CID-10 autocomplete, educational banner, audit logging, RLS isolation, and the "Hipoteses Diagnosticas" tab UI

### Modified Capabilities
- (none — no existing spec requirements change; the prontuario shell tab simply transitions from placeholder to functional)

## Impact

- **Database:** 1 new table `diagnostic_hypotheses` + migration with RLS + CHECK constraints + index
- **Drizzle schema:** `src/shared/db/schema/medical-records/tables.ts` extended; `policies.ts` extended
- **Module:** `src/modules/medical-records/` gains: `lib/cid10-data.json`, `lib/cid10-search.ts`, `lib/schemas/hypothesis.ts`, `server/hypotheses.ts`, `server/cid10.ts`, `components/hypotheses-tab.tsx`, `components/hypothesis-form-sheet.tsx`, `components/hypothesis-card.tsx`
- **Build script:** `scripts/build-cid10-data.ts` (Node CLI, offline, reads `data/cid10-source.csv`)
- **Routes:** No new routes (tab content renders inside existing `/pacientes/[id]/prontuario` shell)
- **Dependencies:** No new npm packages (shadcn Command/Popover already available)
- **Regulatory:** LGPD art. 11 (sensitive health data), RN-05.04 (user_id isolation), RF-05.11 (educational banner), Lei 13.787/2018 (no deletion)
- **Security:** RLS on new table, audit_log on every read/write, no DELETE policy, server-side ownership enforcement
- **Dependency on:** `prontuario-foundation-and-evolutions` (must be merged first — provides audit_log table, prontuario shell, middleware gating)
