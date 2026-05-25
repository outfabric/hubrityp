## Why

CFP 13/2022 e LGPD art. 11 deixam claro: gravação de sessão exige consentimento **livre, prévio, informado, por escrito e justificado pelo método**. RF-10.01/02/03 do PRD 10 amplifica: o paciente precisa consentir não só com a gravação, mas também com o processamento por IA (Gemini), com a retenção de 24h do áudio, e com seus direitos de revogação. Sem essa peça, NADA do pipeline de transcrição pode rodar — e o sistema deve, ele mesmo, **bloquear a UI** quando o termo não está vigente (RN-10.07, RF-10.03). O codebase já tem `consent_terms` para o termo geral de tratamento (PRD 02), mas o termo de IA é um tipo distinto, com cláusulas próprias e ciclo de vida independente: pode ser revogado sem afetar o termo geral, e a revogação **interrompe gravações futuras imediatamente** (RN-10.06).

## What Changes

- Estende `consent_terms` com um discriminador `kind` (`'general' | 'ai_recording'`) e um campo `revocation_takes_effect_immediately` (boolean, default false para `general`, true para `ai_recording`). Cria índice operacional para a lookup "qual termo de IA está vigente para o paciente X do psicólogo Y" usado em todas as Server Actions de gravação/upload da change seguinte.
- Adiciona, ao módulo `ai-transcription` (criado em `ai-transcription-foundation`), o helper `assertAiConsentActive({ userId, patientId }): Promise<{ ok: true; termId: string; signedAt: Date } | { ok: false; reason: 'never_signed' | 'revoked' | 'patient_not_found' }>` em `lib/consent.ts`. Esse helper é a única autoridade de "tem termo de IA vigente?". Todas as gravações/uploads downstream chamam isso.
- Adiciona Server Actions ao módulo `patients` (consistente com o módulo onde `consent_terms` vive):
  - `generateAiConsentTerm({ patientId })` — cria um termo de IA com texto canônico, devolve link `/termo/[token]` para o paciente assinar; só permite se ainda não houver termo de IA ativo.
  - `revokeAiConsentTerm({ patientId, reason })` — revoga termo vigente; grava `revoked_at`, `revocation_reason`; **dispara evento Inngest** `ai-transcription/consent.revoked` que a change `ai-transcription-gemini-processing` consumirá para cancelar jobs em andamento (futuro). Aqui já emitimos com payload Zod-validado; consumidor é stub no MVP.
  - `getAiConsentStatus({ patientId })` — leitura para UI exibir "termo vigente desde DD/MM/YYYY" ou "Sem termo — gerar agora".
- Adiciona um template canônico de termo de IA (texto pt-BR) que cobre: finalidade, dados envolvidos, retenção 24h, controlador (psicólogo) / operador (Gemini), direitos do titular (LGPD art. 18), revogação a qualquer momento, base legal (consentimento + tutela da saúde — LGPD art. 7º II + art. 11). Texto vive em `src/modules/ai-transcription/lib/consent-template.ts` e é versionado (`templateVersion: 1`).
- Estende a rota pública `/termo/[token]/page.tsx`:
  - Detecta o `kind` do termo carregado pelo token (público, gated por token).
  - Renderiza o texto correto (geral ou IA).
  - Salva a assinatura com `signed_at`, `signed_ip` (hash), `signed_user_agent` (hash).
- Adiciona painel "Termo de Transcrição IA" na ficha do paciente (`src/app/(app)/pacientes/[id]/`) — componente que mostra estado e oferece [Gerar termo] / [Revogar]. **UI mínima nesta change** (só o painel; o uso nas Server Actions de gravação fica para `ai-transcription-audio-upload`).
- Atualiza `middleware.ts:classifyPath()` para garantir que `/dashboard/pacientes/[id]` está classificado como `'app'` (já deve estar via redirect; confirmar). A rota pública `/termo/[token]` permanece pública (gated por token).

## Capabilities

### New Capabilities

- `ai-transcription-consent-flow`: novo tipo de termo `ai_recording`, helpers de verificação (`assertAiConsentActive`), Server Actions `generateAiConsentTerm` / `revokeAiConsentTerm` / `getAiConsentStatus`, template canônico de texto em pt-BR (LGPD + CFP 13/2022), evento Inngest `ai-transcription/consent.revoked`, painel mínimo na ficha do paciente. Cobre RF-10.01 / RF-10.02 / RF-10.03 / RN-10.06 / RN-10.07.

### Modified Capabilities

- `patient-consent`: a tabela `consent_terms` ganha as colunas `kind`, `revocation_takes_effect_immediately`, `revocation_reason`, `template_version`. A capacidade incorpora o requisito "termo de IA existe como tipo distinto, com cláusulas próprias e ciclo de vida próprio" — sem alterar os requisitos do termo geral. Inclui o índice operacional `(user_id, patient_id, kind, revoked_at)` para a lookup do helper.

## Impact

- **Código**:
  - `src/shared/db/schema/patients/tables.ts` — colunas adicionadas em `consent_terms`.
  - `src/modules/patients/server/` — 3 novas Server Actions (`generate-ai-consent.ts`, `revoke-ai-consent.ts`, `get-ai-consent-status.ts`).
  - `src/modules/patients/lib/` — Zod schemas + helper `findActiveAiConsent`.
  - `src/modules/ai-transcription/lib/consent.ts` — `assertAiConsentActive`, `consent-template.ts`.
  - `src/modules/ai-transcription/inngest/events.ts` (novo arquivo) — Zod schema do evento `ai-transcription/consent.revoked`; o `client.ts` Inngest do módulo é criado nesta change como skeleton.
  - `src/app/termo/[token]/page.tsx` — discriminação por `kind`.
  - `src/app/(app)/pacientes/[id]/components/ai-consent-panel.tsx` — novo componente UI.
- **Banco de dados**: 1 migração Drizzle adicionando 4 colunas em `consent_terms` + 1 índice operacional. Reversível. Valor `kind` default `'general'` em rows existentes (backfill).
- **Rotas**: `/termo/[token]` permanece pública (token-gated). Painel em `/dashboard/pacientes/[id]` permanece gated (mantém classificação `'app'`).
- **Segurança / LGPD**: termo é o gatekeeper de TODO o pipeline. RLS de `consent_terms` é a mesma do schema existente (`user_id = auth.uid()`). Token público é cryptographically random (já é o padrão da capacidade `patient-consent`). Helper `assertAiConsentActive` é a única autoridade — qualquer Server Action de gravação que não chamá-lo viola política.
- **Dependências**: nenhuma nova lib externa. Inngest cliente skeleton do módulo `ai-transcription/inngest/client.ts` é criado aqui (será expandido por `ai-transcription-gemini-processing`).
