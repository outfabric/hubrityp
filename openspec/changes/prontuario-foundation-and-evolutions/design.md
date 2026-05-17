## Context

PRD 05 (Prontuario Eletronico) is the most regulated module in HubrityP. It depends on PRD 01 (auth), PRD 02 (patients), and PRD 03 (sessions/agenda) being implemented — all three are done. This is change #1 of a 7-change decomposition: it bootstraps the data layer, evolution CRUD with immutability enforcement, and the prontuario shell page so that subsequent changes (hipoteses, plano, escalas, documentos, anexos, exportacao) can build on a tested foundation.

Additionally, four route prefixes (`/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes`) are currently classified as `'public'` by `classifyPath()` in `src/middleware.ts` despite living in the `(app)` route group. This is a security gap — unauthenticated users can reach these routes. The middleware defensive sweep closes this gap.

**Constraints:**
- Lei 13.787/2018: 20-year retention, no deletion allowed
- LGPD art. 11: all clinical data is "dado pessoal sensivel"
- RN-05.02: 30-day immutability window, then addendum-only
- RN-05.04: strict user_id isolation (cross-psychologist access = incident)
- CFP 001/2009: every session generates mandatory record
- Tiptap already installed (from patient-anamnesis change)
- `useAutoSave` hook already exists at `src/modules/patients/lib/use-auto-save.ts`

## Goals / Non-Goals

**Goals:**
- Drizzle schema + migration for `evolutions`, `evolution_versions`, `audit_log` with RLS
- Medical-records module with evolution CRUD (create, update, get, list, version history)
- 30-day immutability enforcement server-side (not UI-only)
- Template system with Zod validation per template type
- Tiptap editor with auto-save reusing existing hook
- Prontuario shell page with Tabs (Evolucoes functional, others placeholder)
- Audit log writes on every prontuario/evolution read
- Inngest cron: remind-missing-evolution (7-day grace)
- Middleware defensive sweep (4 prefixes -> 'app')

**Non-Goals:**
- Hipoteses diagnosticas, plano terapeutico, escalas, documentos formais, anexos, notas pessoais (future changes)
- Custom template editor UI (the JSONB field exists but the config UI is out of scope)
- PDF export of prontuario
- ICP-Brasil digital signature
- CID-10 autocomplete
- Patient-facing prontuario access
- AI-assisted text generation

## Decisions

### 1. Generic audit_log table (not prontuario-specific)

The `audit_log` table is designed with generic columns (`action`, `resource_type`, `resource_id`, `metadata`) so PRD 11 (LGPD/Seguranca/Auditoria) can adopt it without migration. Every domain that needs audit trails (billing, WhatsApp, exports) will write to the same table.

**Alternative considered:** Per-domain audit tables (e.g., `prontuario_access_log`).
**Rejected because:** Fragmenting audits across tables makes the PRD 11 "quem acessou o que" query harder, requires N audit dashboards, and creates schema sprawl. A single indexed table with `resource_type` discrimination is simpler and more performant for the 20-year retention window.

### 2. evolution_versions JOIN-scoped RLS (not direct user_id)

The `evolution_versions` table has no `user_id` column. RLS is enforced via subquery: `evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid())`. This avoids denormalizing `user_id` into the versions table.

**Alternative considered:** Adding `user_id` directly to `evolution_versions`.
**Rejected because:** Denormalization creates a consistency risk (what if the FK and the denormalized `user_id` diverge?). The subquery approach is the same pattern used successfully for `patient_guardians` and `anamnesis`. The index on `evolutions(user_id)` ensures the subquery is efficient.

### 3. No DELETE policy on any medical-records table

Lei 13.787/2018 mandates 20-year retention for digital clinical records. We enforce this at the RLS layer: no DELETE policy exists, meaning even the table owner cannot delete rows via the authenticated role. System-level anonymization (after 20 years) will use service-role in a scheduled Inngest job (future PRD 11 change).

**Alternative considered:** Soft-delete with `deleted_at` column.
**Rejected because:** Soft-delete creates ambiguity (queries must filter deleted rows, UI might accidentally show them). A hard "no delete" at the RLS level is simpler and legally unambiguous.

### 4. Audit log writes via service-role (not authenticated INSERT)

The `audit_log` has no INSERT policy for the `authenticated` role. Writes go through a server-side function using service-role. This prevents users from inserting fake audit entries (e.g., backdating access logs or poisoning the trail). The `logProntuarioAccess` function validates the session, extracts `user_id` from `auth.getUser()`, and writes with service-role.

**Alternative considered:** INSERT policy allowing `user_id = auth.uid()`.
**Rejected because:** A user could insert misleading rows (different `action`, wrong `resource_id`, altered timestamps) to cover tracks or pollute the audit trail. Server-only writes guarantee integrity.

### 5. Reuse `useAutoSave` from patients module (not duplicate)

The existing `useAutoSave` hook at `src/modules/patients/lib/use-auto-save.ts` is generic (takes content of type T, a save function, and an interval). Rather than duplicating, the evolution editor imports it directly. If in the future it needs extraction to `shared/`, that's a separate refactor.

**Alternative considered:** Move to `src/shared/lib/use-auto-save.ts` now.
**Rejected because:** YAGNI — only two consumers exist (anamnesis and evolutions). Rule of three says wait. The import path crossing module boundaries (`@/modules/patients`) is acceptable for a utility hook that has no domain-specific logic.

### 6. Middleware defensive sweep: 4 prefixes added in one shot

Rather than adding prefixes incrementally as routes are built, we gate all four at once. This closes the security gap immediately and prevents regression as future routes are added under these prefixes.

**Implementation:** Add prefix checks for `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes` to `classifyPath()` before the `/dashboard` check, using the same pattern (`pathname === X || pathname.startsWith(X + '/')`).

**Risk:** If a public-facing page exists under these prefixes (none does today), it would be gated incorrectly. Mitigated by auditing existing routes before merge.

### 7. Template content as JSONB (not separate columns per field)

Each template type has different fields (TCC has 7, livre has 1, aba has 5). Storing as JSONB in a single `content` column with per-template Zod validation provides flexibility without schema changes when templates evolve.

**Alternative considered:** Separate columns per template field (union table or EAV).
**Rejected because:** 6 templates x avg 5 fields = 30 nullable columns on a single table, most of which would be NULL for any given row. JSONB with Zod validation at the application boundary is the established pattern (same approach as anamnesis `custom_sections`).

## Drizzle Table DDL Summary

```typescript
// src/shared/db/schema/medical-records/tables.ts

export const evolutions = pgTable('evolutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),          // FK auth.users (manual in migration)
  patientId: uuid('patient_id').notNull(),    // FK patients(id)
  sessionId: uuid('session_id'),              // FK sessions(id), UNIQUE
  templateType: text('template_type').notNull(), // 'tcc'|'psicanalise'|'sistemica'|'aba'|'livre'|'custom'
  content: jsonb('content').notNull(),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
}, (table) => [
  index('idx_evolutions_patient_created').on(table.patientId, table.createdAt),
  unique('evolutions_session_id_unique').on(table.sessionId),
]);

export const evolutionVersions = pgTable('evolution_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  evolutionId: uuid('evolution_id').notNull(), // FK evolutions(id) ON DELETE CASCADE
  versionNumber: integer('version_number').notNull(),
  content: jsonb('content').notNull(),
  isAddendum: boolean('is_addendum').notNull().default(false),
  modifiedBy: uuid('modified_by').notNull(),   // FK auth.users
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index('idx_evolution_versions_evolution').on(table.evolutionId, table.versionNumber),
  unique('evolution_versions_evo_version_unique').on(table.evolutionId, table.versionNumber),
]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),           // FK auth.users
  action: text('action').notNull(),            // e.g. 'prontuario.read', 'evolution.create'
  resourceType: text('resource_type').notNull(), // e.g. 'evolution', 'patient'
  resourceId: uuid('resource_id'),             // nullable (some actions are resource-less)
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  ipAddress: text('ip_address'),               // inet stored as text for Drizzle compat
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index('idx_audit_log_user_created').on(table.userId, table.createdAt),
  index('idx_audit_log_resource').on(table.resourceType, table.resourceId),
]);
```

## RLS Policies (SQL appended to migration)

```sql
-- evolutions: owner-scoped, no DELETE
ALTER TABLE evolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select evolutions" ON evolutions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner can insert evolutions" ON evolutions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner can update evolutions" ON evolutions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- evolution_versions: JOIN-scoped via evolutions.user_id, no DELETE
ALTER TABLE evolution_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select evolution_versions" ON evolution_versions
  FOR SELECT TO authenticated
  USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));
CREATE POLICY "owner can insert evolution_versions" ON evolution_versions
  FOR INSERT TO authenticated
  WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));
CREATE POLICY "owner can update evolution_versions" ON evolution_versions
  FOR UPDATE TO authenticated
  USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()))
  WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));

-- audit_log: user can SELECT own rows only; no INSERT/UPDATE/DELETE for authenticated
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user can select own audit entries" ON audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- INSERT happens via service-role (bypasses RLS). No authenticated INSERT policy.
-- No UPDATE or DELETE policies — audit trail is immutable.
```

## Module Structure

```
src/modules/medical-records/
  index.ts                    # barrel: re-exports public API
  lib/
    evolution-schemas.ts      # Zod schemas per template type + create/update input schemas
    immutability-helpers.ts   # isWithinEditWindow(createdAt, now), shouldForceAddendum(...)
    content-diff.ts           # contentHasChanged(prev, next) for auto-save optimization
    template-types.ts         # TemplateType union, TEMPLATE_OPTIONS for Select
  server/
    create-evolution.ts       # createEvolution Server Action
    update-evolution.ts       # updateEvolution (handles both direct edit and addendum)
    get-evolutions-by-patient.ts  # list with pagination
    get-evolution-detail.ts   # single evolution + content
    list-evolution-versions.ts    # version history for a single evolution
    log-prontuario-access.ts  # audit_log write (service-role)
  components/
    evolution-editor.tsx      # Tiptap editor + template-aware field layout
    template-selector.tsx     # Select component for choosing template
    version-history-panel.tsx # Sheet with version list
    auto-save-indicator.tsx   # aria-live status display
    prontuario-tabs.tsx       # Shell Tabs component (Evolucoes + placeholder tabs)
    empty-tab-placeholder.tsx # "Em breve" empty state for disabled tabs
  inngest/
    remind-missing-evolution.ts  # Daily cron scanning overdue sessions
```

## Server Action Signatures

```typescript
// createEvolution
input: { patientId: string; sessionId: string; templateType: TemplateType; content: JsonValue }
output: { ok: true; id: string } | { ok: false; code: 'DUPLICATE_SESSION' | 'INVALID_TEMPLATE' | 'UNAUTHORIZED' }

// updateEvolution
input: { evolutionId: string; content: JsonValue; reason?: string }
output: { ok: true; version: number; isAddendum: boolean } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'REASON_REQUIRED' }
// Logic: if shouldForceAddendum(evolution.createdAt) -> creates addendum version
//        else -> updates content + creates regular version

// getEvolutionsByPatient
input: { patientId: string; cursor?: string; limit?: number }
output: { evolutions: EvolutionSummary[]; nextCursor: string | null }

// getEvolutionDetail
input: { evolutionId: string }
output: { evolution: EvolutionFull } | { ok: false; code: 'NOT_FOUND' }
// Side-effect: writes audit_log row (action='evolution.read')

// listEvolutionVersions
input: { evolutionId: string }
output: { versions: EvolutionVersion[] }

// logProntuarioAccess
input: { action: string; resourceType: string; resourceId?: string; metadata?: Record<string, unknown> }
output: void (fire-and-forget; errors logged internally, never surfaced to user)
```

## UI Component Tree (Prontuario Page)

```
/pacientes/[id]/prontuario/page.tsx (RSC)
  └─ ProntuarioTabs
       ├─ Tab "Evolucoes" (active)
       │    └─ /pacientes/[id]/prontuario/evolucoes/page.tsx
       │         └─ EvolutionList (paginated, reverse chronological)
       │              └─ EvolutionCard[] (template badge, date, snippet)
       ├─ Tab "Hipoteses" → EmptyTabPlaceholder
       ├─ Tab "Plano"     → EmptyTabPlaceholder
       ├─ Tab "Escalas"   → EmptyTabPlaceholder
       ├─ Tab "Documentos"→ EmptyTabPlaceholder
       ├─ Tab "Anexos"    → EmptyTabPlaceholder
       └─ Tab "Notas"     → EmptyTabPlaceholder

/pacientes/[id]/prontuario/evolucoes/nova/page.tsx (RSC)
  └─ TemplateSelector
  └─ EvolutionEditor
       ├─ Tiptap field(s) per template
       ├─ AutoSaveIndicator (aria-live="polite")
       └─ Button "Registrar evolucao" (primary, loading state)

/pacientes/[id]/prontuario/evolucoes/[evolutionId]/page.tsx (RSC)
  └─ EvolutionEditor (pre-filled)
       ├─ AutoSaveIndicator
       ├─ Button "Salvar" / "Adicionar addendum" (context-dependent)
       └─ Button "Historico" → opens VersionHistoryPanel (Sheet right)
```

## Auto-Save Reuse Strategy

The evolution editor imports `useAutoSave` from `@/modules/patients/lib/use-auto-save.ts`:

```typescript
import { useAutoSave } from '@/modules/patients/lib/use-auto-save';

const { status, lastSavedAt } = useAutoSave(
  editorContent,
  async (content) => { await updateEvolution({ evolutionId, content }); },
  { interval: 10_000 }
);
```

The `AutoSaveIndicator` component renders the status with:
- `saved`: "Salvo as HH:MM" in `text-tertiary` caption (12px)
- `saving`: Spinner icon + "Salvando..."
- `error`: `AlertCircle` icon in `danger-700` + "Erro ao salvar"
- Container: `aria-live="polite"` for screen reader announcements

## Middleware Defensive Sweep

```typescript
// In classifyPath(), before the /dashboard check:
const APP_PREFIXES = ['/pacientes', '/agenda', '/caixa-de-entrada', '/configuracoes', '/dashboard'] as const;

for (const prefix of APP_PREFIXES) {
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    return 'app';
  }
}
```

This replaces the current single `/dashboard` check with a loop over all app-gated prefixes. The order doesn't matter since they're mutually exclusive. The strict separator check (`=== prefix` or `startsWith(prefix + '/')`) prevents false matches like `/pacientes-info`.

## Risks / Trade-offs

- **[JSONB content without schema evolution]** The `content` column stores template-specific JSONB. If a template adds a field in the future, old rows lack it. Mitigation: Zod schemas use `.optional()` / `.default()` for all fields. Reading code must tolerate partial content gracefully.
- **[audit_log volume over 20 years]** Every prontuario read generates a row. For a psychologist with 30 patients, 4 reads/patient/week = 6,240 rows/year = 124,800 rows over 20 years per psychologist. At scale (10K psychologists): ~1.2B rows. Mitigation: Partitioning by `created_at` (range partitioning, quarterly) should be introduced in PRD 11 before reaching scale. The index on `(user_id, created_at DESC)` ensures per-user queries remain fast regardless.
- **[useAutoSave cross-module import]** Importing from `@/modules/patients` in `@/modules/medical-records` creates a coupling. Acceptable under rule-of-three (only 2 consumers). If a third appears, extract to `@/shared/lib/`.
- **[evolution_versions JOIN-scoped RLS performance]** The subquery `evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid())` runs on every row access. Mitigation: The `evolutions` table has an index on `user_id` (implicit from the PK + RLS usage patterns); the subquery returns a small set (one user's evolutions). Tested in integration.

## Migration Plan

1. Generate Drizzle migration (`npm run db:generate`)
2. Manually append RLS SQL to the generated migration file
3. Run `npm run db:migrate` locally
4. Verify with integration tests (schema exists, RLS active, policies correct)
5. Deploy: migration runs automatically on deploy via `npm run db:migrate` in CI
6. Rollback: the migration is additive (new tables only); rollback = drop tables (reversible)

## Open Questions

(none — all decisions are locked per user direction)
