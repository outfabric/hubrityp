## Context

PRD 05 section 5.5 (RF-05.14 to RF-05.18) specifies a psychometric scale application system. The `prontuario-foundation-and-evolutions` change has already bootstrapped the medical-records schema domain, `audit_log` table, middleware defensive sweep, and the prontuario shell page with placeholder tabs (including "Escalas" showing "Em breve"). This change (#4 of 7) replaces that placeholder with a fully functional scale application system.

**Constraints:**
- LGPD art. 11: all clinical data (scale responses) is "dado pessoal sensivel"
- RN-05.04: strict `user_id` isolation — psychologist B must never see psychologist A's scale data
- Lei 13.787/2018: 20-year retention, no DELETE allowed
- PRD explicitly excludes BDI-II and BAI (proprietary, Pearson copyright)
- SATEPSI licensed tests are out of scope (future)
- PHQ-9, GAD-7, SDQ, AUDIT are confirmed public-domain for clinical use
- WHOQOL-Bref is WHO-licensed but free for clinical use (no commercial redistribution restriction)
- Recharts already installed; shadcn RadioGroup available

**Dependencies:**
- `prontuario-foundation-and-evolutions` (audit_log table, middleware gating of `/pacientes`, prontuario shell with tabs)
- `src/shared/db/schema/medical-records/` (existing domain folder to extend)
- `src/modules/medical-records/` (existing module to extend)

## Goals / Non-Goals

**Goals:**
- Drizzle schema + migration for `scale_applications` table with RLS
- Scale definition library (5 scales) with scoring algorithms and classification thresholds
- Server Actions for creating, submitting (in-session + remote), querying history
- Public token-gated patient-facing page (`/escala/[token]`) and Route Handler (`/api/scales/[token]`)
- Middleware explicit classification of `/escala` as `'public'`
- Inngest cron for expiring remote tokens hourly
- Recharts line chart for longitudinal score visualization
- Audit log integration on all operations
- Replace "Escalas" tab placeholder with functional `ScalesTab` component

**Non-Goals:**
- BDI-II, BAI (proprietary — explicitly excluded by PRD)
- SATEPSI tests (licensed, future)
- In-app WhatsApp link sending (hook noted for PRD 04 integration, not implemented)
- Custom scale creation by psychologist (future)
- PDF export of scale history (handled by prontuario export change)
- AI interpretation of scores (PRD 10)

## Decisions

### 1. Scale definitions as code, not database rows

Scale definitions (questions, scoring algorithm, classification thresholds) live as TypeScript modules in `src/modules/medical-records/lib/scales/`. The `scale_key` column in the table is a text enum referencing the code definition, not a FK to a `scale_definitions` table.

**Alternative considered:** Database table `scale_definitions` with JSONB questions/thresholds.
**Rejected because:** Scale definitions are stable clinical instruments — they don't change at runtime. Keeping them as code enables: TypeScript-level validation, tree-shaking, unit testing of scoring functions, and zero DB queries to render a questionnaire. If custom scales are needed later (non-goal), a hybrid approach can be added without migrating existing scales.

### 2. Public token access via service-role function, NOT RLS policy

The public patient-facing route (`/escala/[token]`) fetches the scale application by token using a service-role Drizzle client. This bypasses RLS intentionally.

**Why not an `anon` RLS policy?** An anon-visible SELECT policy on `scale_applications` would need to be narrowly scoped (`WHERE remote_token = $input AND token_expires_at > now() AND completed_at IS NULL`). However:
- The `anon` role seeing any clinical table (even one row) is a larger attack surface than a controlled server function.
- The public response must NEVER include `user_id` or `patient_id` — with RLS, a bug in the SELECT column list could leak these. With service-role in a dedicated function, the output shape is hardcoded and tested.
- Rate limiting is applied at the Route Handler level (not possible with direct anon queries).

**Service-role justification (required by CLAUDE.md):** The `getScaleApplicationByToken` function uses service-role exclusively to serve the public token route. It returns only: `{ id, scaleKey, questions, isExpired, isCompleted }` — no `user_id`, no `patient_id`, no `patient_name`, no psychologist info. Tested via integration test that the response shape leaks nothing.

### 3. Route Handler (not Server Action) for public submissions

The public patient-facing form submits to `POST /api/scales/[token]` (a Route Handler), not a Server Action. Rationale:
- Server Actions require a Next.js page context with CSRF protection tied to the origin. The public page qualifies, but a Route Handler gives explicit control over rate limiting, response shape, and IP extraction.
- The Route Handler can be independently rate-limited by IP without middleware complexity.
- It can return structured JSON for error states (expired, completed, validation failure).

The GET endpoint at the same path returns the scale definition (questions only) for client-side rendering.

### 4. Token generation: 64 hex characters (256 bits entropy)

Tokens are generated using `crypto.randomBytes(32).toString('hex')` — 64 hex characters, 256 bits of entropy. This matches the pattern used by `confirmar-sessao` and `termo` tokens in the codebase.

**Why not UUID?** UUIDs are 122 bits of entropy (v4). Clinical data requires higher entropy to prevent brute-force enumeration. 256 bits makes enumeration computationally infeasible even without rate limiting (though rate limiting is also applied).

### 5. Rate limiting strategy for public Route Handler

In-memory token-bucket rate limiter per IP (5 requests/minute for POST, 20/minute for GET). Implementation uses a `Map<string, { count: number, resetAt: number }>` with lazy cleanup. This is sufficient for Vercel serverless (each cold start gets a fresh map; sustained abuse across instances is acceptable because the token single-use guard is the primary protection).

**Alternative considered:** Vercel Edge Rate Limiting (paid add-on) or Upstash Redis rate limiter.
**Rejected because:** The free tier constraint and the single-use token guarantee make in-memory adequate. The worst case for a race condition (two instances accept the same token simultaneously) is mitigated by the DB-level `completed_at IS NULL` check in the UPDATE query (only one wins).

### 6. WHOQOL-Bref: 4 domain scores, no single classification

WHOQOL-Bref produces 4 domain scores (Physical, Psychological, Social, Environmental) each transformed to a 0-100 scale. Unlike PHQ-9/GAD-7/AUDIT, it has no single "total score" with classification cutoffs. The `total_score` column will be NULL for WHOQOL-Bref; `classification` will store a JSON-stringified object `{ physical: 72, psychological: 65, social: 80, environmental: 58 }` for chart purposes.

**Alternative considered:** Separate `scale_domain_scores` table for multi-domain scales.
**Rejected because:** Only WHOQOL-Bref has this pattern in the current library. Over-engineering a join table for one scale violates YAGNI. The JSONB `responses` column already stores all answers; the `classification` column storing a JSON string for multi-domain scales is pragmatic and queryable via `jsonb` operators if needed.

### 7. SDQ: only 11-17 self-report version for MVP

The SDQ has multiple versions (parent-report for 3-16, teacher-report, self-report for 11-17). For MVP, we implement only the self-report (11-17) version. The `scale_key` is `'sdq'` (not `'sdq-self-11-17'`). If additional SDQ versions are needed later, they can be added as separate scale_keys.

### 8. Chart: dots colored by classification severity

The Recharts line chart uses custom dot rendering where each dot's fill color maps to the classification severity:
- `success-500` for minimal/low-risk classifications
- `warning-500` for mild/moderate/risky classifications
- `danger-500` for severe/harmful/likely-dependence classifications

The line itself uses `brand-500` (a neutral green-sage that doesn't imply severity). Grid uses `surface-muted`. This follows Salvia design system rules: semantic colors only for status indicators, never for decorative purposes.

### 9. Middleware: explicit `'public'` for `/escala` (not implicit fallthrough)

The current `classifyPath()` returns `'public'` as the default fallthrough. However, per CLAUDE.md convention, every new route must be explicitly classified. We add `/escala` check BEFORE the fallthrough, returning `'public'`. This documents intent and protects against future changes to the default behavior.

## Drizzle Table DDL

```typescript
// Added to src/shared/db/schema/medical-records/tables.ts

export const scaleApplications = pgTable('scale_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),              // FK auth.users
  patientId: uuid('patient_id').notNull(),        // FK patients(id)
  scaleKey: text('scale_key').notNull(),           // CHECK in ('phq9','gad7','sdq','audit','whoqol-bref')
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().default(sql`now()`),
  responses: jsonb('responses').notNull().default(sql`'[]'::jsonb`),
  totalScore: integer('total_score'),             // null until completed; null always for whoqol-bref
  classification: text('classification'),         // null until scored; JSON string for whoqol-bref domains
  notes: text('notes'),
  appliedRemotely: boolean('applied_remotely').notNull().default(false),
  remoteToken: varchar('remote_token', { length: 64 }),  // UNIQUE WHERE NOT NULL
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index('idx_scale_apps_patient_scale_applied').on(table.patientId, table.scaleKey, table.appliedAt),
  unique('scale_applications_remote_token_unique').on(table.remoteToken),
]);
```

## RLS Policies

```sql
ALTER TABLE scale_applications ENABLE ROW LEVEL SECURITY;

-- Psychologist can read own scale applications
CREATE POLICY "owner can select scale_applications" ON scale_applications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Psychologist can create scale applications
CREATE POLICY "owner can insert scale_applications" ON scale_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Psychologist can update own scale applications (for adding notes, etc.)
CREATE POLICY "owner can update scale_applications" ON scale_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- NO DELETE policy (Lei 13.787/2018: 20-year retention)
-- Public token access bypasses RLS via service-role function (Decision #2)
```

## Scale Data Layout

Each scale file exports a standard interface:

```typescript
// src/modules/medical-records/lib/scales/types.ts
export interface ScaleOption {
  value: number;
  label: string;
}

export interface ScaleQuestion {
  id: string;
  prompt: string;
  options: ScaleOption[];
  reverseScored?: boolean;  // for SDQ prosocial items
}

export interface ClassificationResult {
  label: string;
  severity: 'minimal' | 'mild' | 'moderate' | 'severe' | 'domains';  // 'domains' for WHOQOL-Bref
}

export interface ScaleDefinition {
  key: string;
  label: string;
  description: string;
  estimatedMinutes: number;
  questions: ScaleQuestion[];
  score(responses: Record<string, number>): number | null;  // null for WHOQOL-Bref
  classify(score: number | null, responses?: Record<string, number>): ClassificationResult;
}
```

### PHQ-9 Thresholds
| Score Range | Classification | Severity |
|---|---|---|
| 0-4 | Minimal | minimal |
| 5-9 | Mild | mild |
| 10-14 | Moderate | moderate |
| 15-19 | Moderately Severe | severe |
| 20-27 | Severe | severe |

### GAD-7 Thresholds
| Score Range | Classification | Severity |
|---|---|---|
| 0-4 | Minimal | minimal |
| 5-9 | Mild | mild |
| 10-14 | Moderate | moderate |
| 15-21 | Severe | severe |

### AUDIT Thresholds
| Score Range | Classification | Severity |
|---|---|---|
| 0-7 | Low risk | minimal |
| 8-15 | Risky use | mild |
| 16-19 | Harmful use | moderate |
| 20-40 | Likely dependence | severe |

### SDQ (11-17 Self-Report) — Total Difficulties Cutoffs
| Score Range | Classification | Severity |
|---|---|---|
| 0-15 | Normal | minimal |
| 16-19 | Borderline | mild |
| 20-40 | Abnormal | severe |

### WHOQOL-Bref
No single score. 4 domains (Physical, Psychological, Social, Environmental), each transformed to 0-100. Classification stored as JSON object with domain scores.

## Server Action Signatures

```typescript
// createScaleApplication
input: { patientId: string; scaleKey: ScaleKey; mode: 'in-session' | 'remote'; expiresInHours?: number }
output: { ok: true; id: string; remoteToken?: string; remoteUrl?: string }
       | { ok: false; code: 'INVALID_SCALE' | 'UNAUTHORIZED' | 'PATIENT_NOT_FOUND' }

// submitScaleResponses (psychologist-side, in-session)
input: { applicationId: string; responses: Record<string, number> }
output: { ok: true; totalScore: number | null; classification: ClassificationResult }
       | { ok: false; code: 'NOT_FOUND' | 'ALREADY_COMPLETED' | 'UNAUTHORIZED' | 'INVALID_RESPONSES' }

// submitScaleResponsesByToken (public route handler implementation)
// Called by POST /api/scales/[token] — uses service-role
input: { token: string; responses: Record<string, number>; ip: string }
output: { ok: true } | { ok: false; code: 'INVALID_TOKEN' | 'EXPIRED' | 'ALREADY_COMPLETED' | 'INVALID_RESPONSES' }

// getScaleHistory (psychologist queries patient's scale history)
input: { patientId: string; scaleKey?: string }
output: { applications: ScaleApplicationSummary[]; timeseries: TimeseriesPoint[] }

// listScalesForPatient (summary: last application per scale + chart data)
input: { patientId: string }
output: { scales: ScaleSummary[] }  // one entry per scale ever applied
```

## Public Route Security Model

### GET /api/scales/[token]
- Looks up `scale_applications` by `remote_token` using service-role
- Returns ONLY: `{ scaleKey, questions, isExpired: boolean, isCompleted: boolean }`
- NEVER returns: `user_id`, `patient_id`, patient name, psychologist name, any PII
- Rate limit: 20 req/min per IP

### POST /api/scales/[token]
- Validates token exists, not expired (`token_expires_at > now()`), not completed (`completed_at IS NULL`)
- Validates responses against scale's question IDs (Zod)
- Scores and classifies
- Updates row: `responses`, `total_score`, `classification`, `completed_at`
- Writes `audit_log` with action='scale.public-submit', metadata includes IP (no PII)
- Rate limit: 5 req/min per IP
- Returns: `{ ok: true }` or `{ ok: false, code: '...' }` — no data leak on error

### /escala/[token] Page (public)
- Server Component fetches scale data via GET /api/scales/[token] (internal fetch) or direct service-role query
- Renders questions with RadioGroup per question (all visible, scrollable)
- Submit calls POST /api/scales/[token]
- States: loading, questions, expired, already-completed, success
- Does NOT show score to patient (clinical interpretation is psychologist's role)
- LGPD footer: "Suas respostas sao protegidas pela LGPD e serao acessiveis apenas ao seu psicologo."

## Recharts Chart Specification

```typescript
// Component: ScaleHistoryChart
// Props: { data: TimeseriesPoint[]; scaleKey: string }
// TimeseriesPoint: { appliedAt: string; totalScore: number; classification: ClassificationResult }

// Structure:
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
    <CartesianGrid stroke="var(--color-surface-muted)" strokeDasharray="3 3" />
    <XAxis
      dataKey="appliedAt"
      tickFormatter={(date) => format(new Date(date), 'dd/MM', { locale: ptBR })}
      tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
    />
    <YAxis
      domain={[0, maxScoreForScale]}
      tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
    />
    <Tooltip content={<ScaleChartTooltip />} />
    <Line
      type="monotone"
      dataKey="totalScore"
      stroke="var(--color-brand-500)"
      strokeWidth={2}
      dot={<ClassificationDot />}  // custom dot colored by severity
      activeDot={{ r: 6 }}
    />
  </LineChart>
</ResponsiveContainer>

// ClassificationDot renders with fill:
//   severity 'minimal' -> var(--color-success-500)
//   severity 'mild' | 'moderate' -> var(--color-warning-500)
//   severity 'severe' -> var(--color-danger-500)
```

## Inngest Cron: expire-remote-tokens

```typescript
export const expireRemoteTokens = inngest.createFunction(
  { id: 'scales/expire-remote-tokens' },
  { cron: 'TZ=America/Sao_Paulo 0 * * * *' },  // every hour, Sao Paulo timezone
  async ({ step }) => {
    await step.run('mark-expired-tokens', async () => {
      // UPDATE scale_applications
      // SET token_expires_at = token_expires_at  (no change — just a semantic marker)
      // Actually: rows with token_expires_at < now() AND completed_at IS NULL
      // are already "expired" by the check in submitScaleResponsesByToken.
      // This cron is a cleanup/audit step — it can optionally set a
      // `expired_at` marker or simply log the count for observability.
      // The primary expiry enforcement is in the submission check itself.
    });
  }
);
```

Note: The cron is primarily for observability and potential future cleanup (e.g., nulling tokens after expiry for GDPR right-to-be-forgotten of the token string itself). The critical expiry enforcement happens at submission time via `token_expires_at > now()` check.

## Module Structure (additions to existing medical-records module)

```
src/modules/medical-records/
  lib/
    scales/
      types.ts              # ScaleDefinition, ScaleQuestion, ScaleOption, ClassificationResult
      phq9.ts               # PHQ-9 definition + scoring + classification
      gad7.ts               # GAD-7 definition + scoring + classification
      sdq.ts                # SDQ 11-17 self-report + scoring + classification
      audit.ts              # AUDIT definition + scoring + classification
      whoqol-bref.ts        # WHOQOL-Bref definition + domain scoring
      index.ts              # registry: scaleByKey(key) -> ScaleDefinition
      token.ts              # generateScaleToken(): string (64 hex, crypto.randomBytes)
    scales-schemas.ts       # Zod: createScaleApplicationSchema, submitResponsesSchema, etc.
  server/
    scales.ts               # All scale Server Actions (create, submit, history, list)
    scales-public.ts        # Service-role functions for public token route
  components/
    scales-tab.tsx          # ScalesTab replacing placeholder
    scale-application-form.tsx  # In-session questionnaire with RadioGroups
    scale-history-chart.tsx     # Recharts LineChart wrapper
    scale-summary-card.tsx      # Card with last score + badge + sparkline
    scale-select-modal.tsx      # Modal for choosing scale + mode
  inngest/
    expire-remote-tokens.ts # Hourly cron
```

## Risks / Trade-offs

- **[In-memory rate limiter resets on cold start]** Vercel serverless instances are ephemeral. A sustained attacker could bypass by waiting for new instances. Mitigation: The single-use token guard (`completed_at IS NULL` enforced at DB level) is the true protection. Rate limiting is defense-in-depth, not the primary gate.
- **[WHOQOL-Bref classification stored as JSON string in text column]** Breaks the uniform `totalScore: int, classification: text` contract. Mitigation: The chart component handles `scaleKey === 'whoqol-bref'` as a special case (renders 4 domain lines instead of 1). The `listScalesForPatient` action documents this divergence.
- **[SDQ only 11-17 self-report]** Psychologists working with younger children (3-10) cannot use the parent-report version. Mitigation: Clearly documented in the scale description ("Versao autoaplicavel para adolescentes de 11 a 17 anos"). Additional versions can be added as separate scale_keys in a future change.
- **[Token enumeration]** Even with 256-bit entropy tokens, the public GET endpoint confirms whether a token exists. Mitigation: Return identical response shape for "not found" and "expired" (both `{ isExpired: true }`) so an attacker cannot distinguish valid-but-expired from nonexistent.
- **[Race condition on double-submit]** Two concurrent POST requests for the same token could both pass the `completed_at IS NULL` check. Mitigation: The UPDATE uses `WHERE remote_token = $1 AND completed_at IS NULL` — only one will match (Postgres row-level locking). The second gets 0 rows affected and returns `ALREADY_COMPLETED`.

## Migration Plan

1. Generate Drizzle migration for `scale_applications` table (`npm run db:generate`)
2. Manually append RLS SQL + CHECK constraint + FK constraints to the generated migration
3. Run `npm run db:migrate` locally and verify table exists with correct policies
4. Add `/escala` public classification to `src/middleware.ts:classifyPath()` — trivial, additive
5. Deploy: migration runs automatically in CI; no breaking changes to existing tables
6. Rollback: drop `scale_applications` table (additive-only change, fully reversible)

## Open Questions

(none — all decisions locked per user direction)
