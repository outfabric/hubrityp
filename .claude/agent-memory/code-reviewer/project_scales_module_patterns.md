---
name: scales-module-patterns
description: Architecture patterns from the prontuario-scales-application change -- public token route, service-role justification, severity keyword mapping bug, classifyPath conventions
metadata:
  type: project
---

The medical-records module added a psychometric scale application system (PHQ-9/GAD-7/AUDIT/SDQ/WHOQOL-Bref) with these patterns:

**Public token-gated route pattern:** `/escala/[token]` page + `/api/scales/[token]` Route Handler. Same pattern as `/confirmar-sessao/[token]` and `/termo/[token]`. Uses service-role DB client with narrow SELECT (no PII in return type). Token is 256-bit (randomBytes(32).toString('hex'), 64 hex chars). Anti-enumeration: not-found and expired return identical shapes. Single-use: WHERE completed_at IS NULL race guard.

**Middleware classification for public patient routes:** Explicitly classified as `'public'` in `classifyPath()` via prefix check (`/escala/` or `/escala`). API routes at `/api/scales/...` fall through to the default `'public'` return -- they're NOT matched by the `/escala` prefix rule.

**Rate limiting pattern:** In-memory per-IP rate limiter in the Route Handler (separate GET/POST buckets with configurable thresholds). Lazy cleanup when map exceeds 1000 entries. Rate limit checked BEFORE any DB work.

**Severity mapping (RESOLVED 2026-05-17):** `classificationToSeverity` was extracted into `lib/scales/severity-tokens.ts` as a single shared function. It is exhaustive against all five scale definitions with correct substring-ordering: Anormal before Normal, Provavel dependencia before Uso de risco, Moderadamente grave before Grave. Fallback is `null` (not `'minimal'`), which renders as neutral/brand color. Both `scale-history-chart.tsx` and `scale-summary-card.tsx` import from this shared helper. Exported via module barrel.

**WHOQOL-Bref divergence:** This scale has no single total score (returns null). Classification is a JSON-stringified object with 4 domain scores (physical/psychological/social/environmental, 0-100 each). The `classification` column stores this JSON string. Charts and cards parse it back to render 4-line charts or domain score grids.

**Inngest functions are NOT exported through the module barrel.** They're imported directly from `@/modules/medical-records/inngest/<function-name>` by the `/api/inngest/route.ts`. This is a pre-existing pattern (same as `remindMissingEvolution`).

**Why:** Documents patterns for future reviews of the scales module and adjacent public token-gated features.
**How to apply:** When reviewing changes to scale scoring, chart rendering, or public token routes, verify any new scale's classify() labels are covered in `classificationToSeverity` (severity-tokens.ts). Check for WHOQOL JSON divergence. Ensure `responses` jsonb default remains `'{}'::jsonb` (not `'[]'`).
