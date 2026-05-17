## Why

Psychologists routinely apply psychometric scales (PHQ-9, GAD-7, AUDIT, SDQ, WHOQOL-Bref) to track patient symptom progression, but today they manage this on paper or Excel with no longitudinal visibility. PRD 05 (RF-05.14 to RF-05.18, RN-05.04) mandates an integrated scale application system with automatic scoring, classification thresholds, remote patient links, and historical charts — all within the prontuario. This change delivers that capability on top of the foundation laid by `prontuario-foundation-and-evolutions`.

## What Changes

- New table `scale_applications` in `src/shared/db/schema/medical-records/tables.ts` with RLS (psychologist-scoped SELECT/INSERT/UPDATE, no DELETE)
- Scale definition library (`src/modules/medical-records/lib/scales/`) with one file per scale (PHQ-9, GAD-7, SDQ 11-17 self-report, AUDIT, WHOQOL-Bref) exporting questions, scoring, and classification functions
- Server Actions for creating applications (in-session or remote-token), submitting responses (psychologist-side and public-token-side), querying history, and listing per-patient timeseries
- Public Route Handler `src/app/api/scales/[token]/route.ts` (GET scale definition, POST responses) using service-role — rate-limited, no patient/user data leaked
- Public patient-facing page `src/app/escala/[token]/page.tsx` with RadioGroup form, token-expiry handling, completion guard, and LGPD footer
- Middleware extension: `classifyPath()` marks `/escala` as `'public'` (explicit classification, not implicit fallthrough)
- Inngest cron `scales/expire-remote-tokens` (hourly) marking expired tokens
- Audit log entries on all psychologist-side reads/writes and public submissions (with IP)
- Recharts `LineChart` for longitudinal score visualization (semantic dot colors by classification severity)
- Replaces "Em breve" placeholder for "Escalas" tab in the prontuario shell

## Capabilities

### New Capabilities
- `psychometric-scales`: Scale library, in-session/remote application, scoring, classification, history, longitudinal chart, token lifecycle, public patient route, RLS isolation, audit trail

### Modified Capabilities
(none — the prontuario shell tab swap from placeholder to functional is purely additive; no existing spec requirements change)

## Impact

- **Database:** 1 new table (`scale_applications`) + migration with RLS + indexes; extends `src/shared/db/schema/medical-records/`
- **Middleware (`src/middleware.ts`):** `classifyPath()` gains explicit `/escala` -> `'public'` entry (prevents accidental gating if defaults ever change)
- **Module:** `src/modules/medical-records/` gains `lib/scales/`, new server actions, new components (`ScalesTab`, `ScaleApplicationForm`, `ScaleHistoryChart`, `ScalePublicForm`)
- **Routes:** 1 new public page (`src/app/escala/[token]/page.tsx` with layout), 1 new Route Handler (`src/app/api/scales/[token]/route.ts`)
- **Inngest:** New cron function `scales/expire-remote-tokens`
- **Dependencies:** No new npm packages (Recharts already installed; shadcn RadioGroup already available)
- **Regulatory:** LGPD art. 11 (sensitive health data), RN-05.04 (strict user_id isolation), Lei 13.787/2018 (no deletion)
- **Security:** Public token route leaks NO patient/user identifiers; service-role usage documented; 256-bit entropy tokens; single-use after completion; rate-limited; audit logged with IP
- **Cross-change dependency:** References `audit_log` table and `logProntuarioAccess` from `prontuario-foundation-and-evolutions`
