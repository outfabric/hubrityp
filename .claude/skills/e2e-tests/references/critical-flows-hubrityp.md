# HubrityP critical flows that deserve E2E

E2E is expensive. The pyramid holds: **few tests, high value**. Use this list as a map of what to cover and what **not** to cover.

## Cover (1 test per journey)

| Journey | Suggested spec | Tag | Main assertions |
|---|---|---|---|
| Login + dashboard access (mock GoTrue) | `auth.spec.ts` | `@auth` | redirects after login; state persisted on refresh; logout clears the session |
| Real login (signup/refresh/logout) | `auth.spec.ts` (real suite) | `@auth-real` | signup → confirm email → signin → refresh token → signout |
| Patient registration | `paciente.spec.ts` | `@pacientes` | creates via form, appears in the list, data persisted in the DB |
| Consultation scheduling | `agendamento.spec.ts` | `@agenda` | creates, appears on the calendar, triggers the Twilio mock with the correct payload |
| WhatsApp reminder | inside `agendamento.spec.ts` | `@agenda` | incoming Twilio webhook marks the reminder as delivered |
| Digital prescription (Receita Saúde) | `receita.spec.ts` | `@receitas` | generates, shows QR, digital signature mock flowed |
| PIX billing | `cobranca-pix.spec.ts` | `@financeiro` | creates via UI, Asaas webhook marks as paid, status reflected in the UI |
| Telepsychology session (Stream.io) | `telepsicologia.spec.ts` | `@telepsicologia` | generates link, opens room (iframe mock), closing updates the medical record |
| Medical record (creation + transcription) | `prontuario.spec.ts` | `@prontuario` | creates a note, Gemini mock transcribes, content appears |
| Isolation between psychologists | `multi-tenant.spec.ts` | `@pacientes` | dr B does not see dr A's patients in the UI |

Total: ~9 specs (8 in the seeded suite + 1 in the real one), ~15 tests. CI runs in <5min.

> **Tags `@<domain>`** are mandatory. The `/dev-cycle` orchestrator filters the suite with `--grep "@<tag>"` for scoped re-validation of fixes; specs without a tag force a fallback to the full suite.

## DO NOT cover in E2E

Migrate to the correct pyramid:

- **Form validations** (invalid CPF, required field) → unit on the Zod schema (`unit-tests`).
- **Fee calculation** → unit of the function.
- **RLS permission** (dr B cannot query dr A's patients in the DB) → integration (`integration-tests`).
- **Edge cases of scheduling** (consultation on Sunday, holiday, timezone) → integration of the Server Action.
- **Server Action errors** (duplicate patient, overlapping appointment) → integration.
- **Rendering of each loading/error state** in isolation → component unit.

The heuristic: if the test proves "**the feature works when a human uses the app**", it is E2E. If it proves "**a business rule is correct**", it is unit or integration.

## Post-deploy smoke test (reduced subset)

After deploy, run a subset pointing to staging/production with a dedicated seed user:

- Login + dashboard loads.
- Patient list responds in <2s.
- Health-check endpoint `/api/health` returns 200.

Configure as a separate project (`smoke`) in `playwright.seeded.config.ts` with `baseURL` pointing to the environment:

```ts
{
  name: 'smoke',
  testMatch: /.*\.smoke\.spec\.ts/,
  use: { baseURL: process.env.SMOKE_BASE_URL },
  // no dependencies (does not run Testcontainers)
}
```

Triggered with `npx playwright test --config playwright.seeded.config.ts --project=smoke` in a post-deploy job.

## When to add a new E2E

Cumulative criteria:

1. The journey crosses **more than one system** (UI + Server Action + DB + external integration).
2. Silent failure costs money/reputation (billing not created, reminder not sent).
3. Not covered by lower layers.

If 2 or 3 do not hold, **do not create**. An E2E suite that grows without discipline dies of flakiness in 6 months.

## When to remove an E2E

- Covers a business rule that migrated to unit/integration.
- Intermittent failure >5% even after serious investigation — bad coverage is worse than none.
- Duplicates a journey already covered (e.g., two different tests both exercising "create patient").

Document the removal in the PR — someone will ask why it disappeared.
