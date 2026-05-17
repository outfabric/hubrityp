## Context

This is change #2 of the PRD 05 decomposition. The foundation change (`prontuario-foundation-and-evolutions`) has already established:
- The `medical-records` schema domain at `src/shared/db/schema/medical-records/`
- The generic `audit_log` table with service-role write path
- The prontuario shell page at `/pacientes/[id]/prontuario` with Tabs (Hipoteses tab shows "Em breve" placeholder)
- Middleware gating for `/pacientes` prefix
- The `logProntuarioAccess` server function for audit writes

This change adds the `diagnostic_hypotheses` table to the same schema domain, implements hypothesis CRUD with CID-10 autocomplete, and replaces the placeholder tab with the functional UI.

**Constraints:**
- Lei 13.787/2018: no deletion (retention mandate) — "discard" is a status change, not a DELETE
- LGPD art. 11: hypotheses are sensitive health data (clinical orientation)
- RN-05.04: strict user_id isolation — psychologist A cannot see psychologist B's hypotheses
- RF-05.11: educational banner about the ethical limit on diagnosis in psychology
- CID-10 dataset: ~12k codes from Datasus (public domain, CC-BY-4.0 compatible)
- No new npm dependencies required (shadcn Command/Popover and cmdk already available)

## Goals / Non-Goals

**Goals:**
- Add `diagnostic_hypotheses` table with RLS, CHECK constraint, and index
- Static CID-10 JSON file with build script + in-memory fuzzy search utility
- Zod schemas with the "at least one of" refinement
- Server Actions for hypothesis CRUD + status transitions + CID-10 search
- Audit log integration for every read/write operation
- "Hipoteses Diagnosticas" tab UI replacing the placeholder in the prontuario shell
- Unit, integration, and E2E test coverage

**Non-Goals:**
- AI-suggested hypotheses (PRD 10, future)
- Sharing hypotheses with other professionals (encaminhamento v2)
- Importing/syncing CID-10 codes from an API (static file is sufficient)
- CID-10 as a runtime DB table (unnecessary write complexity for read-only reference data)
- Custom CID-10 entries by the psychologist (must use the official catalog or free-text description)

## Decisions

### 1. CID-10 as static JSON (not a DB table)

The CID-10 catalog is a read-only reference dataset (~12k codes). It never changes during runtime (updates are annual, from Datasus). Storing it in the database would require:
- A migration per annual update
- RLS on a public reference table (complexity for no gain)
- A network round-trip on every search keystroke

Instead, we generate `cid10-data.json` at build time from the Datasus CSV and load it into memory on the server. The search function runs entirely in-process with zero DB queries.

**Alternative considered:** Store codes in `cid10_codes` DB table with full-text search.
**Rejected because:** Adds migration complexity, RLS overhead on read-only public data, and network latency per keystroke. Static JSON loaded once in the Node.js process is faster (sub-ms search) and simpler.

**File size impact:** ~1.5 MB JSON (~12k entries with code + description). Committed to git (not gitignored) so CI and deployments don't need the build step. The `.json` file compresses well (~300 KB gzipped in the bundle). Regeneration via `scripts/build-cid10-data.ts` is run manually when Datasus publishes an update.

### 2. user_id column directly on diagnostic_hypotheses (not JOIN-scoped)

Unlike `evolution_versions` which uses JOIN-scoped RLS through `evolutions.user_id`, the `diagnostic_hypotheses` table has a direct `user_id` column. This is an improvement over the PRD's original model (which lacked `user_id`).

**Rationale:** Hypotheses are top-level entities linked to a patient, not subordinate to another user-scoped table. Direct `user_id` enables simple `auth.uid() = user_id` RLS policies without subqueries, improving both clarity and performance.

**Alternative considered:** RLS via `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`.
**Rejected because:** While valid (same pattern as anamnesis), the direct `user_id` approach is simpler, faster (no subquery), and explicitly recommended in the locked decisions.

### 3. Status as text with CHECK constraint (not a PostgreSQL ENUM)

Status values ('investigating', 'confirmed', 'discarded') are stored as `text` with a CHECK constraint rather than a PostgreSQL ENUM type.

**Rationale:** Adding values to a PG ENUM requires `ALTER TYPE ... ADD VALUE` which cannot run inside a transaction. Text + CHECK is simpler to evolve (just alter the CHECK) and is the same pattern used elsewhere in the codebase.

**Alternative considered:** PostgreSQL ENUM `hypothesis_status`.
**Rejected because:** ENUM modification pain. Text + CHECK + Zod validation at the app boundary provides equivalent safety with better ergonomics.

### 4. Soft-delete via status='discarded' (not hard DELETE)

When a psychologist "discards" a hypothesis, the system sets `status='discarded'` rather than deleting the row. The RLS layer has no DELETE policy, making hard deletion impossible even if attempted.

**Rationale:** Lei 13.787/2018 mandates retention of clinical records. A hypothesis — even a discarded one — is part of the clinical reasoning trail and must be preserved for the 20-year retention period.

### 5. Audit log writes via existing `logProntuarioAccess` pattern

The foundation change established the `logProntuarioAccess` function that writes to `audit_log` using service-role. This change reuses the same pattern with hypothesis-specific actions.

**Actions logged:**
- `hypothesis.create` — on creation
- `hypothesis.update` — on field update
- `hypothesis.status-change` — on status transition (metadata: `{old_status, new_status}`)
- `hypothesis.read` — on list access (resource_id = patient_id)

### 6. CID-10 search exposed as Server Action (not Route Handler)

The search is exposed as a Server Action rather than an API Route Handler because:
- It is only called from within the app (the Sheet form component)
- Server Actions provide built-in CSRF protection
- No external consumer needs this endpoint
- The authenticated session is validated server-side before returning results

Client-side debounce (250ms) prevents excessive calls. The server function itself is fast (sub-ms in-memory search), so rate limiting is not critical.

### 7. Sheet (right-side drawer) for add/edit form

The add/edit hypothesis form uses a Sheet (right-side, max-width 480px) rather than a modal or dedicated page because:
- The psychologist needs to see the existing hypotheses list while adding a new one (context preservation)
- The form is short (~4 fields) and doesn't warrant a full page
- Follows the Salvia design system guidance: "Use Drawer for details without losing context"

## Table DDL

```typescript
// Addition to src/shared/db/schema/medical-records/tables.ts

export const diagnosticHypotheses = pgTable('diagnostic_hypotheses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),           // FK auth.users — direct for RLS simplicity
  patientId: uuid('patient_id').notNull(),     // FK patients(id)
  description: text('description'),            // free-text hypothesis
  cid10Code: varchar('cid10_code', { length: 10 }),       // e.g. 'F32.0'
  cid10Description: text('cid10_description'),             // official description
  status: text('status').notNull().default('investigating'), // CHECK constraint in migration
  notes: text('notes'),                        // optional observation / discard reason
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index('idx_diagnostic_hypotheses_patient_status_created')
    .on(table.patientId, table.status, table.createdAt),
]);
```

## RLS Policies (SQL appended to migration)

```sql
ALTER TABLE diagnostic_hypotheses ENABLE ROW LEVEL SECURITY;

-- SELECT: owner only
CREATE POLICY "owner can select diagnostic_hypotheses" ON diagnostic_hypotheses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- INSERT: owner only (user_id must match caller)
CREATE POLICY "owner can insert diagnostic_hypotheses" ON diagnostic_hypotheses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- UPDATE: owner only
CREATE POLICY "owner can update diagnostic_hypotheses" ON diagnostic_hypotheses
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No DELETE policy — retention mandate (Lei 13.787/2018)

-- CHECK constraint: at least one descriptor
ALTER TABLE diagnostic_hypotheses
  ADD CONSTRAINT chk_hypothesis_has_descriptor
  CHECK (description IS NOT NULL OR cid10_code IS NOT NULL);

-- CHECK constraint: valid status
ALTER TABLE diagnostic_hypotheses
  ADD CONSTRAINT chk_hypothesis_status
  CHECK (status IN ('investigating', 'confirmed', 'discarded'));
```

## CID-10 Data Pipeline

```
data/cid10-source.csv (committed, ~800 KB)
        │
        ▼  scripts/build-cid10-data.ts
        │  (reads CSV, normalizes, outputs JSON)
        ▼
src/modules/medical-records/lib/cid10-data.json (committed, ~1.5 MB)
        │
        ▼  imported by cid10-search.ts at module load
        │  (cached in Node.js module system)
        ▼
searchCid10(query, limit) → Cid10Result[]
```

**`scripts/build-cid10-data.ts`**:
- Source: Datasus CID-10 tabular CSV (CODIGO;DESCRICAO format)
- License: Public domain / CC-BY-4.0 (Brazilian government open data)
- Output format: `Array<{ code: string; description: string }>`
- Strips BOM, normalizes encoding to UTF-8
- Documents source URL in script header comment

**`cid10-search.ts`**:
- Loads JSON once at module import (lazy singleton)
- Builds a normalized lookup array (lowercased, accent-stripped descriptions)
- `searchCid10(query, limit = 20)`:
  1. Normalize query (lowercase, strip accents)
  2. Filter: code.startsWith(normalizedQuery) OR normalizedDescription.includes(normalizedQuery)
  3. Sort: exact code prefix matches first, then alphabetical
  4. Slice to limit

## Server Action Signatures

```typescript
// createHypothesis
input: { patientId: string; description?: string; cid10Code?: string; cid10Description?: string; notes?: string }
output: { ok: true; id: string } | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' }

// updateHypothesis
input: { hypothesisId: string; description?: string; cid10Code?: string; cid10Description?: string; status?: HypothesisStatus; notes?: string }
output: { ok: true } | { ok: false; code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' }

// updateHypothesisStatus
input: { hypothesisId: string; status: HypothesisStatus; notes?: string }
output: { ok: true } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_STATUS' }

// listHypothesesByPatient
input: { patientId: string; includeDiscarded?: boolean }
output: { hypotheses: HypothesisSummary[] }

// searchCid10
input: { query: string; limit?: number }
output: { results: Cid10Result[] }
```

## UI Component Tree

```
ProntuarioTabs (existing, from foundation change)
  └─ Tab "Hipoteses Diagnosticas" (replaces EmptyTabPlaceholder)
       └─ HypothesesTab
            ├─ Header row
            │    ├─ h3 "Hipoteses diagnosticas"
            │    └─ Button primary [Plus icon] "Adicionar hipotese"
            ├─ Alert (info variant)
            │    └─ [Info icon] "Hipotese diagnostica em psicologia..."
            ├─ HypothesesList
            │    └─ HypothesisCard[] (Card, radius xl, shadow xs, padding space-6)
            │         ├─ Top row: description/CID-10 (mono for code) + Badge (status)
            │         ├─ Meta row: created date, last update (body-sm, text-tertiary)
            │         └─ DropdownMenu [MoreHorizontal]
            │              ├─ "Editar" [Pencil]
            ��              ├─ "Confirmar" [Check] (if status != confirmed)
            │              └─ "Descartar" [X] (if status != discarded)
            └─ EmptyState (when no hypotheses)
                 ├─ ClipboardList icon (text-tertiary)
                 ├─ h4 "Nenhuma hipotese registrada"
                 ├─ p "Adicione a primeira hipotese ao comecar a trabalhar com este paciente."
                 └─ Button primary "Adicionar hipotese"

HypothesisFormSheet (Sheet, right, max-w 480px)
  ├─ SheetHeader: "Adicionar hipotese" / "Editar hipotese"
  ├─ RadioGroup: "Por CID-10" | "Descritiva"
  ├─ [If CID-10 mode]
  │    └─ Popover + Command combobox
  │         ├─ CommandInput (placeholder "Buscar codigo ou descricao...")
  │         ├─ CommandList
  │         │    └─ CommandItem[] (code in font-mono brand-700 + description)
  │         └─ Selected: locked display with X to clear
  ├─ [If Descritiva mode]
  │    └─ Textarea (max 500 chars, label "Descricao da hipotese")
  ├─ Select (status): "Em investigacao" / "Confirmada" / "Descartada"
  ├─ Textarea (notes, optional, label "Observacoes")
  └─ Footer
       ├��� Button ghost "Cancelar"
       └─ Button primary "Salvar hipotese" (loading state)
```

## Badge Variants Mapping

| Status | Badge variant | Label (pt-BR) |
|--------|--------------|----------------|
| investigating | `warning` (warning-50 bg + warning-700 text) | "Em investigacao" |
| confirmed | `success` (success-50 bg + success-700 text) | "Confirmada" |
| discarded | `neutral` (surface-muted bg + text-secondary) | "Descartada" |

## Module File Additions

```
src/modules/medical-records/
  lib/
    cid10-data.json              # ~12k entries, committed (built artifact)
    cid10-search.ts              # searchCid10(query, limit) pure function
    schemas/
      hypothesis.ts              # Zod: createHypothesisSchema, updateHypothesisSchema, statusSchema
  server/
    hypotheses.ts                # createHypothesis, updateHypothesis, updateHypothesisStatus, listHypothesesByPatient
    cid10.ts                     # searchCid10 Server Action (wraps lib)
  components/
    hypotheses-tab.tsx           # Tab content container
    hypothesis-card.tsx          # Individual hypothesis card
    hypothesis-form-sheet.tsx    # Sheet with form (add/edit)
    hypotheses-empty-state.tsx   # Empty state component
    cid10-combobox.tsx           # Command/Popover CID-10 search combobox

scripts/
  build-cid10-data.ts            # CLI: CSV → JSON

data/
  cid10-source.csv               # Source Datasus CSV (committed)
```

## Risks / Trade-offs

- **[Static JSON file size in git]** The `cid10-data.json` file is ~1.5 MB. This adds to the repo size but avoids a build-time dependency on external URLs. Git handles it well (compresses to ~300 KB). Trade-off accepted for deployment simplicity and CI reliability.
- **[In-memory search on cold start]** The JSON is loaded into memory when the module is first imported (~50 MB Node.js heap increase for the parsed array). For a serverless environment (Vercel), this happens once per cold start (~20ms). Acceptable given the sub-ms search performance thereafter.
- **[Annual CID-10 updates]** When Datasus publishes an updated CSV (typically once per year), a developer must re-run `scripts/build-cid10-data.ts` and commit the updated JSON. This is manual but infrequent. A CI check could verify the JSON is up-to-date with the source CSV hash.
- **[No hard delete = growing table]** Over 20 years with 30 patients, a psychologist might accumulate ~200-500 hypotheses (not all patients get hypotheses). Volume is negligible. No partitioning needed.
- **[Audit log volume]** Every tab view writes an audit_log row. Same consideration as the foundation change — manageable at scale with the existing (user_id, created_at) index.

## Migration Plan

1. Generate Drizzle migration (`npm run db:generate`)
2. Manually append RLS SQL, CHECK constraints, and FK constraint (`user_id REFERENCES auth.users(id)`, `patient_id REFERENCES patients(id)`) to the generated migration file
3. Run `npm run db:migrate` locally
4. Verify with integration tests (table exists, RLS active, CHECK enforced, policies correct)
5. Deploy: migration runs automatically via `npm run db:migrate` in CI
6. Rollback: additive (new table only); rollback = DROP TABLE diagnostic_hypotheses (reversible, no data loss since table is new)

## Open Questions

(none — all decisions are locked per user direction)
