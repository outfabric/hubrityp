## 1. Metadados / titles

- [x] 1.1 Em `src/app/layout.tsx` (linha ~30), alterar o `title` base de `'HubrityP'` para `'Hubrity'`.
- [x] 1.2 Nos layouts públicos, alterar o `title` de metadados de "… — HubrityP" para "… — Hubrity": `src/app/termo/layout.tsx`, `src/app/escala/layout.tsx`, `src/app/confirmar-sessao/layout.tsx`, `src/app/v/[token]/layout.tsx`. NÃO tocar o `<span>` visível do header (tratado pela change da logo).

## 2. Copy de UI

- [ ] 2.1 `src/app/(auth)/login/page.tsx`: "Acesse sua conta HubrityP." → "Acesse sua conta Hubrity.".
- [ ] 2.2 `src/app/(auth)/signup/page.tsx`: "Cadastre-se para começar a usar o HubrityP." → "… usar o Hubrity.".
- [ ] 2.3 `src/modules/dashboard/components/first-steps-slot.tsx` (linha ~43): "Bem-vindo(a) ao HubrityP." → "Bem-vindo(a) ao Hubrity.".
- [ ] 2.4 Rodapés dos layouts públicos: "HubrityP — Plataforma para psicólogos" → "Hubrity — Plataforma para psicólogos" (em `termo`, `escala`, `confirmar-sessao`, `v/[token]`).

## 3. E-mails transacionais e PDF

- [ ] 3.1 `src/shared/lib/mail/resend.ts`: remetente `'HubrityP <noreply@hubrityp.com>'` → `'Hubrity <noreply@hubrity.com>'` (nome **e** domínio).
- [ ] 3.2 Atualizar sign-off e corpo (partes HTML **e** texto) em `src/shared/lib/mail/send-account-locked.ts`, `src/shared/lib/mail/send-password-changed.ts` e `src/shared/lib/mail/send-nps-detractor-followup.ts`: "— Equipe HubrityP" → "— Equipe Hubrity"; no NPS, "sua experiência recente com o HubrityP" → "… com o Hubrity".
- [ ] 3.3 `src/modules/medical-records/inngest/export-pdf.ts` (linhas ~826/845): rodapé "— Equipe HubrityP" → "— Equipe Hubrity" (HTML e texto).
- [ ] 3.4 Testes unitários: estender/criar specs para os builders de e-mail afirmando display name "Hubrity" e sign-off "— Equipe Hubrity" nas partes HTML e texto; e um teste do `metadata.title` do root layout = "Hubrity".

## 4. Domínio da aplicação (hubrityp.com.br → hubrity.com)

- [ ] 4.1 Atualizar refs hardcoded de domínio em código (não-teste): `src/shared/env/schemas.ts` (comentário do `APP_URL`), `src/modules/telepsicologia/lib/video-url.ts` (JSDoc), `src/modules/whatsapp/lib/template-variables.ts` (exemplos `app.`/`meet.`), `src/modules/whatsapp/server/start-twilio-connection.ts` (placeholder de webhook) e `.env.example` (comentário). `app.hubrityp.com.br` → `app.hubrity.com` (abandonar o `.com.br`).
- [ ] 4.2 Atualizar os ~20 fixtures de teste que usam `hubrityp.com`/`hubrityp.com.br` (agenda, whatsapp, telepsicologia, patients) para `hubrity.com`, mudando entrada **e** saída esperada juntas para manter os specs verdes (ex.: `create-session-reserve-room.int.test.ts`, `list-sessions-video-url.int.test.ts`, `reminders-dispatcher.int.test.ts`, `select-template-variables.test.ts`, `video-url.test.ts`, `consent-share.test.ts`, `session-form-modal-copy-toast.test.tsx`, `session-detail-drawer-copy-link.test.tsx`).


