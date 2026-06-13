## Why

O nome canônico da marca é **"Hubrity"** (o wordmark oficial não tem "P"), mas o produto ainda se refere a si mesmo como `HubrityP` em textos voltados ao usuário e usa o domínio antigo `hubrityp.com` / `hubrityp.com.br`. A change `usar-logomarca-no-header` já substitui a **marca visível** (header, home) pela logomarca; este follow-up alinha o **texto** restante e o **domínio** ao novo nome, unificando tudo em `hubrity.com`.

## What Changes

- Renomear todas as referências **textuais voltadas ao usuário** de `HubrityP` para `Hubrity` (H maiúsculo, sem "P" — substantivo próprio em prosa):
  - **Metadados/titles:** `src/app/layout.tsx` (title base) e os `title` dos layouts públicos (`termo`, `escala`, `confirmar-sessao`, `v/[token]`).
  - **Copy de UI:** `src/app/(auth)/login/page.tsx` e `signup/page.tsx` (CardDescription); `src/modules/dashboard/components/first-steps-slot.tsx` (boas-vindas); rodapés "— Plataforma para psicólogos" dos layouts públicos.
  - **E-mails transacionais:** display name do remetente em `src/shared/lib/mail/resend.ts`; assinaturas "— Equipe HubrityP" e corpo em `send-account-locked.ts`, `send-nps-detractor-followup.ts`, `send-password-changed.ts` (HTML + texto).
  - **PDF:** rodapé "— Equipe HubrityP" em `src/modules/medical-records/inngest/export-pdf.ts`.
- **Unificar o domínio em `hubrity.com`:**
  - **E-mail:** `noreply@hubrityp.com` → `noreply@hubrity.com` (`resend.ts`).
  - **App:** `app.hubrityp.com.br` → `app.hubrity.com` (abandona o `.com.br`) nas referências de código — comentários/JSDoc (`schemas.ts`, `video-url.ts`), exemplos (`template-variables.ts`, `.env.example`), placeholder de webhook (`start-twilio-connection.ts`) e nas ~20 referências hardcoded em testes (agenda, whatsapp, telepsicologia, patients).
  - A fonte de verdade da URL em runtime é a env var **`APP_URL`** (definida na infra), não as strings hardcoded — estas são alinhamento cosmético/de fixtures.
- **Dependência de infraestrutura (pré-requisito de produção, fora do código):** apontar o DNS de `hubrity.com`, adicionar/verificar o domínio na **Vercel**, verificar `hubrity.com` no **Resend** (SPF/DKIM) para envio, e reconfigurar as **URLs de webhook do Twilio**. Sem isso, e-mails e links absolutos quebram em produção mesmo com o código correto.
- **Fora de escopo:** a marca **visível** (logo, tratada por `usar-logomarca-no-header`) e identificadores internos não-domínio e não voltados ao usuário (nome do pacote npm, hostnames internos de dev).

## Capabilities

### New Capabilities
- `brand-naming`: define que toda referência textual ao produto voltada ao usuário (títulos de metadados, copy de UI, e-mails transacionais e PDFs) usa "Hubrity", nunca "HubrityP", e que o domínio canônico é `hubrity.com` (e-mail e app). Estabelece a dependência de infraestrutura para o cutover de domínio.

### Modified Capabilities
<!-- Nenhuma. As únicas asserções normativas sobre o texto da marca estavam em app-shell (home), já modificadas pela change usar-logomarca-no-header. -->

## Impact

- **Código (strings de texto + domínio):** `src/app/layout.tsx`, `src/app/{termo,escala,confirmar-sessao,v/[token]}/layout.tsx`, `src/app/(auth)/{login,signup}/page.tsx`, `src/modules/dashboard/components/first-steps-slot.tsx`, `src/shared/lib/mail/{resend,send-account-locked,send-nps-detractor-followup,send-password-changed}.ts`, `src/modules/medical-records/inngest/export-pdf.ts`, `src/shared/env/schemas.ts` (comentário), `src/modules/telepsicologia/lib/video-url.ts` (JSDoc), `src/modules/whatsapp/lib/template-variables.ts` (exemplos), `src/modules/whatsapp/server/start-twilio-connection.ts` (placeholder), `.env.example` (comentário).
- **Testes:** ~20 referências hardcoded a `hubrityp.com`/`hubrityp.com.br` em specs de agenda, whatsapp, telepsicologia e patients (fixtures de URL) atualizadas para `hubrity.com`, mantendo entrada e saída esperada coerentes.
- **Infra (não-código, pré-requisito):** DNS, Vercel (domínio + `APP_URL`), Resend (verificação de `hubrity.com`), Twilio (webhooks). Rastrear como checklist de cutover.
- **Dependência de ordem:** assume `usar-logomarca-no-header` aplicada antes — esta change não toca as marcas visíveis. Layouts públicos editados por ambas, em linhas distintas.
- **Sem impacto em segurança de dados/RLS:** nenhuma rota nova, sem auth/middleware/banco. Risco relevante é de **deliverability** (e-mail) e **links quebrados** se o cutover de infra não acompanhar o merge.
