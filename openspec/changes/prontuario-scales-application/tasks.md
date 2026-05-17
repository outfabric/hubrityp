## 1. Database Schema — scale_applications Table

- [x] 1.1 Add `scaleApplications` table definition to `src/shared/db/schema/medical-records/tables.ts` with all columns per design.md (id, user_id, patient_id, scale_key with CHECK constraint, applied_at, responses, total_score, classification, notes, applied_remotely, remote_token UNIQUE, token_expires_at, completed_at, created_at) and indexes
- [x] 1.2 Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`: `scaleApplicationsPolicies` array with SELECT/INSERT/UPDATE for authenticated (user_id = auth.uid()), no DELETE
- [x] 1.3 Update `src/shared/db/schema/medical-records/index.ts` barrel to export `scaleApplications` table and policies
- [x] 1.4 Run `npm run db:generate`, manually append RLS SQL + CHECK constraint (`scale_key IN ('phq9','gad7','sdq','audit','whoqol-bref')`) + FK constraints (user_id -> auth.users, patient_id -> patients) to the generated migration
- [x] 1.5 Run `npm run db:migrate` locally, verify table exists with correct columns and policies
- [x] 1.6 **Integration test:** Create `src/__tests__/integration/medical-records/scale-applications-schema.int.test.ts` — verify table exists, RLS enabled, SELECT/INSERT/UPDATE policies present, NO DELETE policy, UNIQUE on remote_token, CHECK on scale_key, index on (patient_id, scale_key, applied_at)

## 2. Scale Definitions Library — Types and PHQ-9

- [ ] 2.1 Create `src/modules/medical-records/lib/scales/types.ts` with ScaleOption, ScaleQuestion, ClassificationResult, ScaleDefinition interfaces per design.md
- [ ] 2.2 Create `src/modules/medical-records/lib/scales/phq9.ts` — 9 questions (Portuguese prompts), options 0-3 (Nenhuma vez/Varios dias/Mais da metade dos dias/Quase todos os dias), scoring (sum), classification thresholds (0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe)
- [ ] 2.3 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/phq9.test.ts` — test boundaries: score 4 -> minimal, 5 -> mild, 9 -> mild, 10 -> moderate, 14 -> moderate, 15 -> moderately severe, 19 -> moderately severe, 20 -> severe, 27 -> severe (max). Test all 9 questions present. Test scoring sums correctly

## 3. Scale Definitions Library — GAD-7 and AUDIT

- [ ] 3.1 Create `src/modules/medical-records/lib/scales/gad7.ts` — 7 questions (Portuguese), options 0-3, scoring (sum), classification (0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe)
- [ ] 3.2 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/gad7.test.ts` — test boundaries: 4/5, 9/10, 14/15, max 21. Test 7 questions present
- [ ] 3.3 Create `src/modules/medical-records/lib/scales/audit.ts` — 10 questions (Portuguese), mixed options (questions 1-8: 0-4, questions 9-10: 0/2/4), scoring (sum), classification (0-7 low, 8-15 risky, 16-19 harmful, 20-40 dependence)
- [ ] 3.4 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/audit.test.ts` — test boundaries: 7/8, 15/16, 19/20, max 40. Test 10 questions. Test mixed option ranges

## 4. Scale Definitions Library — SDQ and WHOQOL-Bref

- [ ] 4.1 Create `src/modules/medical-records/lib/scales/sdq.ts` — 25 questions (Portuguese, 11-17 self-report), options 0-2 (Falso/Mais ou menos verdadeiro/Verdadeiro), reverse scoring for prosocial items (1,4,9,17,20), total difficulties = sum of emotional+conduct+hyperactivity+peer (NOT prosocial), classification (0-15 normal, 16-19 borderline, 20-40 abnormal)
- [ ] 4.2 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/sdq.test.ts` — test reverse scoring on prosocial items, test total difficulties excludes prosocial, test boundaries 15/16, 19/20. Test 25 questions present
- [ ] 4.3 Create `src/modules/medical-records/lib/scales/whoqol-bref.ts` — 26 questions (Portuguese), 4 domains (Physical: items 3,4,10,15,16,17,18; Psychological: 5,6,7,11,19,26; Social: 20,21,22; Environmental: 8,9,12,13,14,23,24,25), transformation formula to 0-100, score() returns null, classify() returns severity='domains' with domain scores
- [ ] 4.4 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/whoqol-bref.test.ts` — test domain transformation formula (raw 4-20 range -> 0-100), test all 26 questions grouped correctly, test score() returns null, test classify() returns 4 domain values

## 5. Scale Library Registry and Token Generation

- [ ] 5.1 Create `src/modules/medical-records/lib/scales/index.ts` — export `scaleByKey(key: string): ScaleDefinition | undefined`, `AVAILABLE_SCALES` array, `ScaleKey` type union
- [ ] 5.2 Create `src/modules/medical-records/lib/scales/token.ts` — `generateScaleToken(): string` using `crypto.randomBytes(32).toString('hex')`
- [ ] 5.3 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/token.test.ts` — test returns 64 hex chars, test uses crypto (verify by checking character set [0-9a-f]), test two calls produce different tokens
- [ ] 5.4 Create `src/modules/medical-records/lib/scales-schemas.ts` — Zod schemas: `createScaleApplicationSchema` (patientId uuid, scaleKey enum, mode 'in-session'|'remote', expiresInHours optional number), `submitResponsesSchema` (applicationId uuid, responses record), `submitResponsesByTokenSchema` (token string length 64, responses record)
- [ ] 5.5 **Unit test:** Create `src/__tests__/unit/modules/medical-records/scales/schemas.test.ts` — test createScaleApplicationSchema rejects invalid scale_key, accepts valid ones, requires mode; test submitResponsesSchema validates response shape

## 6. Server Actions — Create and Submit (Psychologist Side)

- [ ] 6.1 Create `src/modules/medical-records/server/scales.ts` — `createScaleApplication` action: validates with Zod, authenticates via getUser(), sets user_id from session, generates token if remote mode, writes row, writes audit_log 'scale.create', returns id + optional token/URL
- [ ] 6.2 Add `submitScaleResponses` to same file — validates applicationId + responses via Zod, authenticates, verifies ownership (WHERE id=$1 AND user_id=auth.uid()), checks not already completed, calls scale's score() and classify(), updates row, writes audit_log 'scale.submit'
- [ ] 6.3 **Integration test:** Create `src/__tests__/integration/medical-records/scales-crud.int.test.ts` — test createScaleApplication in-session persists row with correct user_id; test createScaleApplication remote generates 64-char token + token_expires_at; test submitScaleResponses scores PHQ-9 correctly and sets completed_at; test submitScaleResponses rejects already-completed; test RLS negative (psychologist B cannot read/submit for psychologist A's application); test audit_log rows created

## 7. Server Actions — Public Token Submission and History

- [ ] 7.1 Create `src/modules/medical-records/server/scales-public.ts` — `getScaleApplicationByToken(token)` using service-role: returns ONLY {id, scaleKey, isExpired, isCompleted} (NO user_id, NO patient_id); `submitScaleResponsesByToken(token, responses, ip)` using service-role: validates token+expiry+not-completed, scores, updates row, writes audit_log with IP
- [ ] 7.2 Add `getScaleHistory` to `src/modules/medical-records/server/scales.ts` — authenticates, validates patientId, queries scale_applications WHERE patient_id=$1 AND user_id=auth.uid() (RLS), optional scaleKey filter, returns applications + timeseries data, writes audit_log 'scale.history-read'
- [ ] 7.3 Add `listScalesForPatient` to same file — authenticates, returns one summary entry per scale ever applied (last score, last date, last classification), with chart-ready timeseries per scale
- [ ] 7.4 **Integration test:** Create `src/__tests__/integration/medical-records/scales-public.int.test.ts` — test getScaleApplicationByToken with valid token returns minimal fields (no user_id/patient_id); test submitScaleResponsesByToken with valid token works; test expired token rejected; test already-completed token rejected (double-submit); test audit_log 'scale.public-submit' has IP and no PII in metadata

## 8. Public Route Handler and Middleware

- [ ] 8.1 Create `src/app/api/scales/[token]/route.ts` — GET handler: calls getScaleApplicationByToken, returns scale questions from library + status flags; POST handler: validates body with Zod, extracts IP from headers, calls submitScaleResponsesByToken, returns {ok:true} or error. Both handlers implement in-memory rate limiting (20/min GET, 5/min POST per IP, 429 on excess)
- [ ] 8.2 Update `src/middleware.ts:classifyPath()` — add explicit check for `/escala` prefix returning `'public'` BEFORE the default fallthrough (same pattern as existing public routes)
- [ ] 8.3 **Integration test:** Create `src/__tests__/integration/medical-records/scales-middleware.int.test.ts` — test classifyPath('/escala/abc123') returns 'public'; test GET /escala/[token] does NOT redirect to login (middleware passes through for anonymous)
- [ ] 8.4 **Integration test:** Add to `scales-public.int.test.ts` — test Route Handler GET returns questions + status only (no PII); test POST with rate limit exceeded returns 429

## 9. Public Patient-Facing Page

- [ ] 9.1 Create `src/app/escala/layout.tsx` — minimal public layout (same pattern as confirmar-sessao): centered card, max-width 640px, HubrityP logo header, LGPD footer
- [ ] 9.2 Create `src/app/escala/[token]/page.tsx` — Server Component: fetches scale data via service-role, renders states (valid/expired/completed/not-found). Valid state renders ScalePublicForm client component. All states include LGPD footer. No PII displayed anywhere
- [ ] 9.3 Create `src/modules/medical-records/components/scale-public-form.tsx` — Client Component: RadioGroup per question (all questions visible, scrollable), submit button "Enviar respostas" (full-width mobile, loading state), success state message, error handling. Accessibility: labels, keyboard nav, aria-live on result
- [ ] 9.4 **Unit test:** Create `src/__tests__/unit/modules/medical-records/components/scale-public-form.test.ts` — test renders correct number of RadioGroups for PHQ-9 (9), test submit button disabled until all questions answered, test success message shown after submit

## 10. Frontend — Scales Tab and Summary

- [ ] 10.1 Create `src/modules/medical-records/components/scales-tab.tsx` — Client Component replacing "Em breve" placeholder: h3 "Escalas aplicadas", Button primary "Aplicar nova escala" (icon ClipboardCheck), scale summary cards or empty state per Salvia design rules
- [ ] 10.2 Create `src/modules/medical-records/components/scale-summary-card.tsx` — Card showing: scale label, last application date (format dd/MM/yyyy), last score as text, Badge with classification label colored by severity (success-50/700 for minimal, warning-50/700 for mild/moderate, danger-50/700 for severe), "Ver historico completo" link
- [ ] 10.3 Create `src/modules/medical-records/components/scale-history-chart.tsx` — Client Component: Recharts ResponsiveContainer + LineChart, brand-500 line, custom ClassificationDot (fill by severity), CartesianGrid stroke surface-muted, XAxis date formatter dd/MM, YAxis 0-max, custom Tooltip showing date+score+classification. WHOQOL-Bref variant renders 4 domain lines
- [ ] 10.4 Update prontuario-tabs component to render ScalesTab instead of EmptyTabPlaceholder for the "Escalas" tab

## 11. Frontend — Apply Scale Flow

- [ ] 11.1 Create `src/modules/medical-records/components/scale-select-modal.tsx` — Step 1: RadioGroup with 5 scale cards (label, description, estimatedMinutes). Step 2: mode select ("Aplicar agora" / "Enviar link") + expiration Select (24h/48h/7dias) for remote mode. Calls createScaleApplication on confirm
- [ ] 11.2 Create `src/modules/medical-records/components/scale-application-form.tsx` — Client Component for in-session application: renders questions from scale definition as RadioGroups, "Salvar no prontuario" button (primary, loading state), calls submitScaleResponses, shows score+classification result after submission
- [ ] 11.3 Create remote-link display sub-component within scale-select-modal: shows generated URL, "Copiar link" button (copies to clipboard with toast confirmation), note about "Enviar por WhatsApp" as future feature

## 12. Inngest Cron and Module Barrel

- [ ] 12.1 Create `src/modules/medical-records/inngest/expire-remote-tokens.ts` — Inngest createFunction with cron 'TZ=America/Sao_Paulo 0 * * * *', queries scale_applications with token_expires_at < now() AND completed_at IS NULL, logs count for observability
- [ ] 12.2 Update `src/modules/medical-records/index.ts` barrel to export all new scale-related actions, types, schemas, and components
- [ ] 12.3 Register the expire-remote-tokens function in the Inngest client configuration (same pattern as existing remind-missing-evolution)

## 13. End-to-End Tests

- [ ] 13.1 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/scales.spec.ts` — in-session flow: navigate to prontuario -> Escalas tab -> Aplicar nova escala -> select PHQ-9 -> answer 9 items -> submit -> assert score + classification Badge with correct semantic color
- [ ] 13.2 **E2E (Playwright, seeded):** Remote flow in same file: generate link -> open in new browser context (no auth) -> fill answers -> submit -> assert "Obrigado" message -> return to psychologist view -> assert score appeared in ScalesTab
- [ ] 13.3 **E2E (Playwright, seeded):** Chart test: seed 3 PHQ-9 applications for a patient, navigate to Escalas tab -> "Ver historico completo" -> assert Recharts container renders with 3 visible dot elements
- [ ] 13.4 **E2E (Playwright, seeded):** Expired token UI: navigate to `/escala/{known-expired-token}` -> assert "Este link expirou" message rendered
- [ ] 13.5 **E2E (Playwright, seeded):** Middleware negative test: unauthenticated GET to `/escala/{token}` does NOT redirect to login (confirms public classification works)
