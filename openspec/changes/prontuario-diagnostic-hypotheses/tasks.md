## 1. Database Schema — diagnostic_hypotheses Table

- [x] 1.1 Add `diagnosticHypotheses` table definition to `src/shared/db/schema/medical-records/tables.ts` with columns: id (uuid PK), user_id (uuid NOT NULL), patient_id (uuid NOT NULL), description (text nullable), cid10_code (varchar(10) nullable), cid10_description (text nullable), status (text NOT NULL default 'investigating'), notes (text nullable), created_at (timestamptz), updated_at (timestamptz). Add composite index on (patient_id, status, created_at)
- [x] 1.2 Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`: `diagnosticHypothesesPolicies` array with SELECT/INSERT/UPDATE scoped via `user_id = auth.uid()`. No DELETE policy
- [x] 1.3 Update `src/shared/db/schema/medical-records/index.ts` barrel to re-export `diagnosticHypotheses` table and policies
- [x] 1.4 Run `npm run db:generate`, manually append to migration: RLS ENABLE, policies SQL, CHECK constraint `chk_hypothesis_has_descriptor` (description IS NOT NULL OR cid10_code IS NOT NULL), CHECK constraint `chk_hypothesis_status` (status IN ('investigating','confirmed','discarded')), FK constraints (user_id -> auth.users, patient_id -> patients)
- [x] 1.5 Run `npm run db:migrate` locally and verify table exists with correct structure
- [x] 1.6 **Integration test:** Create `src/__tests__/integration/medical-records/hypotheses/schema.int.test.ts` — verify: table exists, RLS is enabled, SELECT/INSERT/UPDATE policies exist, no DELETE policy exists, CHECK constraint rejects row with both description and cid10_code NULL, CHECK constraint rejects invalid status value, index exists on (patient_id, status, created_at)

## 2. CID-10 Data Build Script

- [x] 2.1 Create `data/cid10-source.csv` — commit the Datasus CID-10 CSV file (CODIGO;DESCRICAO format, UTF-8, ~12k rows). Document source URL and license (public domain) in a `data/README.md`
- [x] 2.2 Create `scripts/build-cid10-data.ts` — Node script that reads `data/cid10-source.csv`, parses semicolon-delimited rows, strips BOM, outputs `src/modules/medical-records/lib/cid10-data.json` as `Array<{code: string; description: string}>`. Include source URL and license note in script header
- [x] 2.3 Run `scripts/build-cid10-data.ts` and commit the generated `cid10-data.json` (~1.5 MB). Verify JSON is valid and contains >12000 entries

## 3. CID-10 Search Utility

- [x] 3.1 Create `src/modules/medical-records/lib/cid10-search.ts` — export `searchCid10(query: string, limit?: number): Cid10Result[]`. Loads `cid10-data.json` once (lazy singleton). Performs accent-stripped, case-insensitive matching: code prefix OR description substring. Returns sorted results (exact prefix first, then alphabetical). Export `Cid10Result` type (`{ code: string; description: string }`)
- [x] 3.2 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/cid10-search.test.ts` — tests: code prefix match ('F32' returns F32.x codes), description substring match ('depressao' matches 'Depressao'), accent-insensitive search, case-insensitive search, empty query returns [], result limit respected (limit=5 returns at most 5), query with no matches returns []

## 4. Zod Schemas — Hypothesis Validation

- [x] 4.1 Create `src/modules/medical-records/lib/schemas/hypothesis.ts` — export: `hypothesisStatusSchema` (z.enum(['investigating','confirmed','discarded'])), `createHypothesisSchema` (patientId uuid, optional description, optional cid10Code, optional cid10Description, optional notes, with `.refine()` ensuring at least one of description/cid10Code), `updateHypothesisSchema` (hypothesisId uuid, all fields optional with same refinement on update), `updateHypothesisStatusSchema` (hypothesisId uuid, status enum, optional notes). Export inferred types
- [x] 4.2 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/schemas/hypothesis.test.ts` — tests: createHypothesisSchema rejects when both description and cid10Code absent, accepts with only description, accepts with only cid10Code, accepts with both, rejects invalid patientId format. updateHypothesisStatusSchema accepts valid transitions, rejects invalid status value

## 5. Server Actions — Hypothesis CRUD

- [x] 5.1 Create `src/modules/medical-records/server/hypotheses.ts` — implement `createHypothesis`: validate input with Zod, authenticate via getUser(), set user_id from session (never from input), INSERT row, write audit_log with action='hypothesis.create' via service-role logProntuarioAccess pattern, return `{ok: true, id}`
- [x] 5.2 Implement `updateHypothesis` in same file: validate input, authenticate, query with WHERE id AND user_id=auth.uid() (ownership check), update fields, write audit_log action='hypothesis.update', return `{ok: true}`
- [x] 5.3 Implement `updateHypothesisStatus` in same file: validate input, authenticate, query with ownership check, update status + notes + updated_at, write audit_log action='hypothesis.status-change' with metadata {old_status, new_status}, return `{ok: true}`
- [x] 5.4 Implement `listHypothesesByPatient` in same file: validate patientId, authenticate, query WHERE patient_id AND user_id=auth.uid() with optional includeDiscarded filter, ORDER BY created_at DESC, write audit_log action='hypothesis.read' (resource_id=patientId), return `{hypotheses}`
- [x] 5.5 Create `src/modules/medical-records/server/cid10.ts` — implement `searchCid10` Server Action: authenticate via getUser() (CID-10 data is not sensitive but access must be authenticated), validate query string with Zod, call lib searchCid10, return `{results}`
- [x] 5.6 **Integration test:** Create `src/__tests__/integration/medical-records/hypotheses/crud.int.test.ts` — tests: createHypothesis persists with correct user_id and writes audit_log, updateHypothesis updates fields and writes audit_log, updateHypothesisStatus transitions correctly and logs old/new status, listHypothesesByPatient returns only user's hypotheses for the patient (RLS negative: psychologist B gets empty array for psychologist A's patient), CHECK constraint rejects insert with both description and cid10_code NULL at DB level

## 6. Module Barrel Update

- [x] 6.1 Update `src/modules/medical-records/index.ts` barrel to re-export: createHypothesis, updateHypothesis, updateHypothesisStatus, listHypothesesByPatient, searchCid10 (server action), hypothesisStatusSchema, createHypothesisSchema, updateHypothesisSchema, updateHypothesisStatusSchema, Cid10Result type, HypothesisStatus type

## 7. Frontend — Hypotheses Tab Components

- [x] 7.1 Create `src/modules/medical-records/components/hypotheses-empty-state.tsx` — Salvia empty state: ClipboardList icon in text-tertiary, h4 "Nenhuma hipotese registrada", p in text-secondary "Adicione a primeira hipotese ao comecar a trabalhar com este paciente.", Button primary "Adicionar hipotese" (emits onAdd callback)
- [x] 7.2 Create `src/modules/medical-records/components/hypothesis-card.tsx` — Card (radius xl, shadow xs, padding space-6): top row with description/CID-10 (code in font-mono) + Badge (variant mapped by status). Meta row: created_at formatted, updated_at if differs (body-sm, text-tertiary). DropdownMenu with MoreHorizontal trigger: "Editar" (Pencil), "Confirmar" (Check, hidden if confirmed), "Descartar" (X, hidden if discarded)
- [x] 7.3 Create `src/modules/medical-records/components/cid10-combobox.tsx` (Client Component) — Popover + Command combobox with debounced search input (250ms). Calls searchCid10 server action. Renders results with code in font-mono brand-700 + description. Selected state shows locked value with X button to clear. Keyboard navigation (Arrow keys, Enter, Esc). aria-labelledby for accessibility
- [x] 7.4 Create `src/modules/medical-records/components/hypothesis-form-sheet.tsx` (Client Component) — Sheet (right, max-w 480px). Form with React Hook Form + Zod resolver. RadioGroup toggle: "Por CID-10" / "Descritiva". Conditional fields: CID-10 mode shows Cid10Combobox, Descritiva mode shows Textarea (max 500 chars). Status Select with three options. Notes Textarea (optional). Buttons: ghost "Cancelar", primary "Salvar hipotese" with loading state. Validation inline on blur. Sonner toast on success. Focus trap in Sheet
- [x] 7.5 Create `src/modules/medical-records/components/hypotheses-tab.tsx` (Client Component) — Container component: header row (h3 + Button), Alert info banner (RF-05.11 exact copy), conditional HypothesesList or EmptyState. Manages Sheet open/close state. Calls listHypothesesByPatient on mount. Handles optimistic updates on create/status-change

## 8. Frontend — Tab Integration

- [x] 8.1 Update the prontuario shell's ProntuarioTabs component (`src/modules/medical-records/components/prontuario-tabs.tsx`) to replace the EmptyTabPlaceholder for the "Hipoteses" tab with the new HypothesesTab component. Pass patient_id as prop

## 9. End-to-End Tests

- [ ] 9.1 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/hypotheses.spec.ts` — test: open prontuario of seeded patient, click "Hipoteses Diagnosticas" tab, verify educational banner is visible, click "Adicionar hipotese", toggle to "Por CID-10", type "depres" in combobox, select F32 result, click "Salvar hipotese", assert card appears with Badge "Em investigacao" (warning variant)
- [ ] 9.2 **E2E (continued):** In same spec file, test: confirm hypothesis via dropdown menu "Confirmar", assert badge changes to "Confirmada" (success variant)
- [ ] 9.3 **E2E (continued):** In same spec file, test: add a descriptive-mode hypothesis (no CID-10), fill description textarea, save, assert card appears in list with the description text and Badge "Em investigacao"
