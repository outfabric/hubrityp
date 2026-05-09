## 1. Database Schema — Consent Terms

- [x] 1.1 Adicionar tabela `consent_terms` em `src/shared/db/schema/patients/tables.ts` (colunas: id, patient_id FK, user_id, term_text TEXT, signature_token VARCHAR(64) UNIQUE, signed_at, signed_ip INET, signed_user_agent TEXT, signed_pdf_path TEXT, revoked_at, created_at)
- [x] 1.2 Adicionar RLS policies para `consent_terms` em `src/shared/db/schema/patients/policies.ts` — policy via `user_id = auth.uid()` (SELECT, INSERT, UPDATE, DELETE)
- [x] 1.3 Rodar `npm run db:generate`, editar migration para incluir RLS policies, UNIQUE em signature_token, índice em patient_id
- [x] 1.4 Testar migration com `npm run db:migrate` local
- [x] 1.5 **Teste de integração:** Criar `src/__tests__/integration/patients/consent-schema.int.test.ts` — verificar tabela existe, RLS habilitado, token unique constraint funciona

## 2. Dependencies

- [x] 2.1 Instalar `pdfkit` e `@types/pdfkit`: `npm install pdfkit @types/pdfkit`

## 3. Server Actions — Generate & Manage Consent

- [x] 3.1 Criar `src/modules/patients/server/generate-consent.ts` — gera token via `crypto.randomBytes(32).toString('hex')`, busca template (default ou custom), cria registro consent_terms, retorna token e link
- [x] 3.2 Criar `src/modules/patients/server/revoke-consent.ts` — set consent_terms.revoked_at=now, limpa patient.consent_signed_at
- [x] 3.3 Criar `src/modules/patients/server/get-consent-status.ts` — retorna status do consentimento do paciente (pending/signed/revoked) com data e link do PDF se assinado
- [x] 3.4 **Testes de integração:** Criar `src/__tests__/integration/patients/consent-generate.int.test.ts` — testar geração de token (unicidade, formato), revogação (limpa patient.consent_signed_at), get status

## 4. Server Actions — Public Signing Flow

- [ ] 4.1 Criar `src/modules/patients/server/get-consent-by-token.ts` — busca consent_terms por token via service-role (bypass RLS). Retorna term_text, patient name, psychologist name/CRP. Retorna null se token inválido
- [ ] 4.2 Criar `src/modules/patients/server/sign-consent.ts` — recebe token, IP, user-agent. Valida que não está já assinado. Set signed_at, signed_ip, signed_user_agent. Gera PDF via pdfkit. Upload PDF para `consent-pdfs/{user_id}/{patient_id}/{consent_id}.pdf`. Set signed_pdf_path. Atualiza patient.consent_signed_at
- [ ] 4.3 **Testes de integração:** Criar `src/__tests__/integration/patients/consent-signing.int.test.ts` — testar signing (sucesso, token inválido, já assinado), PDF path é salvo, patient.consent_signed_at é atualizado

## 5. PDF Generation

- [ ] 5.1 Criar `src/modules/patients/lib/generate-consent-pdf.ts` — função que recebe dados (psychologist name/CRP, patient name, term text, signed_at, signed_ip) e retorna Buffer do PDF. Incluir header com identificação, texto do termo, bloco de assinatura, nota de validade legal
- [ ] 5.2 **Teste unitário:** Criar `src/__tests__/unit/modules/patients/lib/generate-consent-pdf.test.ts` — testar que retorna Buffer válido, inclui dados esperados (mock pdfkit se necessário)

## 6. Default Consent Template

- [ ] 6.1 Criar `src/modules/patients/lib/default-consent-template.ts` — constante com texto padrão incluindo: identificação do psicólogo (placeholders), descrição do serviço, cláusula LGPD (base legal: execução de contrato + tutela da saúde), direitos do titular, prazo de retenção, política de gravação (opcional), valor e política de cancelamento

## 7. Module Barrel Update

- [ ] 7.1 Atualizar `src/modules/patients/index.ts` para reexportar: generateConsent, revokeConsent, getConsentStatus, getConsentByToken, signConsent, tipos

## 8. Frontend — Public Consent Page

> **Design System Sálvia** (`docs/design-system/rules.md`): página pública com layout mínimo, max-width 720px, body-lg para leitura longa, Checkbox + Button primary/secondary, mensagens com ícones semânticos.

- [ ] 8.1 Criar `src/app/termo/[token]/page.tsx` (Server Component, fora do grupo `(app)`) — **Design system:** bg `background`, max-width 720px centralizado. Termo em `Card default` (radius `xl`, padding `space-8` desktop / `space-6` mobile). Texto em body-lg (17px/400, line-height 1.65). Se inválido: ícone `AlertCircle` `danger-500` + h3 "Termo não encontrado". Se já assinado: ícone `Info` `info-500` + "Este termo já foi assinado em {date}". Se válido: renderiza texto + formulário
- [ ] 8.2 Criar `src/app/termo/[token]/actions.ts` com `'use server'` — delega para signConsent
- [ ] 8.3 Criar componente `src/modules/patients/components/consent-sign-form.tsx` (Client Component) — **Design system:** shadcn `Checkbox` (checked: `brand-500`) com label "Li e aceito os termos acima". Botão "Assinar" como `Button primary` com loading state obrigatório (>300ms). Botão "Recusar" como `Button secondary`. Gap `space-4` entre checkbox e botões. Sucesso: ícone `CheckCircle2` `success-500` + h3 "Termo assinado com sucesso" + body-sm "Uma cópia será enviada por email". Acessibilidade: foco visível, `aria-label` nos botões, contraste WCAG AA
- [ ] 8.4 Criar layout mínimo `src/app/termo/layout.tsx` — logo centralizado, bg `background`, footer com texto caption `text-tertiary`, sem sidebar/nav. Mobile-first padding `space-4`
- [ ] 8.5 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/consent-signing.spec.ts` — fluxo: acessar /termo/:token válido, ler termo, marcar checkbox, clicar "Assinar", verificar mensagem de sucesso. Testar também token inválido (404) e token já assinado (mensagem)

## 9. Frontend — Consent in Patient Detail

> **Design System Sálvia**: Badge semântico (success/warning/danger), Button ghost com ícones do mapa fixo, AlertDialog para revogação.

- [ ] 9.1 Adicionar badge de status de consentimento no patient-detail-header — **Design system:** `Badge success` (bg `success-50`, text `success-700`) "Consentimento assinado", `Badge warning` (bg `warning-50`, text `warning-700`) "Consentimento pendente", `Badge danger` (bg `danger-50`, text `danger-700`) "Consentimento revogado"
- [ ] 9.2 Adicionar botões no detalhe: "Enviar termo por WhatsApp" `Button ghost` + ícone `MessageCircle`, "Copiar link" `Button ghost` + ícone (toast success "Link do termo copiado", Sonner, auto-dismiss 4s). Se menor, usar telefone do guardian primary para wa.me
- [ ] 9.3 Adicionar "Revogar consentimento" no `DropdownMenu` de ações (text `danger-700`). Confirmação via shadcn `AlertDialog` (max-width 480px, título h3 "Revogar consentimento?", texto explicando consequências, botão "Revogar" `Button danger`, "Cancelar" `Button secondary`)
- [ ] 9.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/consent-management.spec.ts` — verificar que badge mostra status correto, botão "Copiar link" funciona, botão WhatsApp tem href correto
