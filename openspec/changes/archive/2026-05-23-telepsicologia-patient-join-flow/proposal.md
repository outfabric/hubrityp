## Why

The patient must be able to join a video session without logging in, without installing an app, via a unique token link sent by WhatsApp (RF-09.04, RF-09.12). This is a public, token-gated route — the URL token is the only credential. The patient experience must be clean, trustworthy, and handle edge cases gracefully: early arrival, expired session, bad browser, no permissions. This change builds the entire patient-facing video join flow.

## What Changes

- New public route `src/app/v/[token]/page.tsx` — patient video join page (token-gated, no Supabase session required)
- Route Handler `src/app/api/video/join/route.ts` — validates the patient token, returns the Stream JWT and call metadata. Uses service-role to query `video_rooms` by `patient_token` (patient is not a Supabase user)
- Patient waiting room UI: psychologist name/photo, "Aguarde, [Psicologo] vai admitir voce em breve" message (RF-09.06)
- Time-gate logic: before `available_from` (10 min pre-session), show "Sua sessao e as [hora]. Volte 10 minutos antes." with optional device test (RF-09.07, edge case)
- Expired/ended session: "Esta sessao ja foi encerrada. Fale com [Psicologo] se precisar reagendar." (RF-09.24)
- Patient in-call UI: clean, minimal branding. Psychologist video (large), patient video (small PiP). Controls: mic, camera, leave. No screen share for patient (RF-09.14)
- Browser compatibility check: if unsupported browser, show message with download links (RNF-09.06)
- Pre-call device test: camera/mic permission request with troubleshooting guidance
- Patient disconnect: when psychologist ends call, patient sees "Sessao encerrada por [Psicologo]" message

## Capabilities

### New Capabilities

- `telepsicologia-patient-join`: Public token-gated video join page for patients, including waiting room, time-gate, device test, in-call UI, and post-session states

### Modified Capabilities

(none)

## Impact

- **Routes:** New public `src/app/v/[token]/page.tsx`, new Route Handler `src/app/api/video/join/route.ts`
- **Security:** Token-gated (not auth-gated). Token is 64-char hex, single-use per session. Service-role used in Route Handler (justified: patient is not a Supabase user). `classifyPath()` explicitly classifies `/v` as `'public'`. Video session log insert for patient events uses service-role (justified comment required)
- **Module expansion:** `src/modules/telepsicologia/components/` gains patient-specific components
- **Server Actions:** None for patient (stateless join via Route Handler)
- **LGPD:** No PII logged. Patient name is not stored in Stream — only `patient-<uuid>`. The join page shows the psychologist's name (already consented via the therapeutic relationship)
