## Context

Follow-up textual + de domínio da change `usar-logomarca-no-header`. O nome canônico é "Hubrity" e o domínio canônico é `hubrity.com`. O código ainda usa "HubrityP" em 16 strings (metadados, copy, e-mails, PDF) e o domínio legado `hubrityp.com` / `hubrityp.com.br` em ~30 pontos (1 e-mail real + comentários/exemplos/placeholder + ~20 fixtures de teste). A marca **visível** (spans de header, `<h1>` da home) é tratada pela change da logo e está fora daqui. Não há testes afirmando "HubrityP" como texto além dos 2 e2e de marca visível (cobertos pela logo); a regressão de teste relevante aqui vem dos fixtures de domínio (entrada + saída esperada devem mudar juntas).

A URL da app em runtime vem da env var **`APP_URL`** (definida na infra) — as strings hardcoded de domínio são apenas comentários/exemplos/fixtures. Os assets de imagem já estão atualizados com o novo nome (informado pelo time), então não há trabalho de arte aqui.

## Goals / Non-Goals

**Goals:**
- Substituir todas as referências textuais voltadas ao usuário de "HubrityP" por "Hubrity".
- Garantir verificabilidade: nenhuma das superfícies em escopo renderiza "HubrityP".
- Preservar infraestrutura (domínio de e-mail) e sinalizar assets de imagem.

**Non-Goals:**
- Marca visível (logo) — outra change.
- Domínio `hubrityp.com`, nome do pacote, `docs/`, hostnames internos.
- Regeneração de `og-image.png` / `opengraph-image` / `twitter-image` (arte, não texto).

## Decisions

### D1 — "Hubrity" capitalizado em prosa, minúsculo só no wordmark

Em texto corrido (copy, e-mails, títulos) o nome é substantivo próprio: **"Hubrity"** com H maiúsculo. A estilização minúscula ("hubrity") vive apenas no wordmark vetorizado da logo. Assim "Acesse sua conta HubrityP." → "Acesse sua conta Hubrity.".

### D2 — Edições string-a-string, sem find-replace cego

Cada ocorrência é editada no contexto (algumas frases têm artigo: "ao HubrityP" → "ao Hubrity"; "o HubrityP" → "o Hubrity"). E-mails têm parte HTML **e** texto — ambas mudam. Evitar `sed` global para não tocar o domínio `hubrityp.com` nem identificadores.

### D3 — Domínio unificado em `hubrity.com` (e-mail + app)

`'HubrityP <noreply@hubrityp.com>'` → `'Hubrity <noreply@hubrity.com>'` (nome **e** domínio). O domínio da app `app.hubrityp.com.br` → `app.hubrity.com` (abandona o `.com.br`) nas refs hardcoded de código e nos fixtures de teste. A troca de código é trivial, mas o **cutover real é de infra**: `hubrity.com` precisa de DNS, ser adicionado/verificado na Vercel (e `APP_URL` apontando para ele), verificado no Resend (SPF/DKIM) para envio, e os webhooks do Twilio reapontados. Tratar como pré-requisito de produção, não como concluído pela edição de strings.

Nos testes, entrada e saída esperada usam a mesma URL de amostra (ex.: `generatePatientVideoUrl('https://app.hubrity.com', token)` → `https://app.hubrity.com/v/${token}`); mudar as duas pontas mantém o teste verde — os specs não dependem do domínio real, só de coerência.

### D4 — Coordenação com a change da logo nos layouts públicos

Os layouts `termo`/`escala`/`confirmar-sessao`/`v/[token]` são editados por ambas as changes em linhas distintas: a logo troca o `<span>` do header; este rename ajusta o `title` (metadado) e o rodapé. Aplicar este rename após a logo evita conflito; se aplicado antes, o `<span>` ainda dirá "HubrityP" até a logo entrar (aceitável e transitório).

### D5 — Plano de testes

- **Unit:** asserções focadas nos builders de e-mail (`send-*`) — display name "Hubrity", domínio `noreply@hubrity.com`, sign-off "— Equipe Hubrity" nas partes HTML e texto; e no `metadata.title` do root layout. (Estender suites existentes de mail, se houver; senão, teste mínimo por builder.)
- **Fixtures de domínio:** atualizar entrada + saída esperada juntas nos ~20 pontos de teste (agenda, whatsapp, telepsicologia, patients) de `hubrityp.com(.br)` → `hubrity.com`.
- **Guard anti-regressão:** um teste/CI que falha se reaparecer "HubrityP" **ou** `hubrityp.com`/`hubrityp.com.br` nas superfícies/arquivos em escopo. Mantém os specs "nenhuma superfície mostra HubrityP" e "nenhum código usa o domínio legado" verificáveis.

## Risks / Trade-offs

- **[Deliverability de e-mail quebra no merge]** trocar para `noreply@hubrity.com` antes de verificar `hubrity.com` no Resend faz os envios falharem (domínio não verificado) → Mitigação: cutover de infra (DNS + SPF/DKIM no Resend) **antes ou junto** do deploy; tratar como pré-requisito bloqueante de produção, não como detalhe.
- **[Links absolutos quebram]** se `APP_URL` não apontar para `hubrity.com` na Vercel, links de vídeo/confirmação em WhatsApp/e-mail apontam para domínio morto → Mitigação: atualizar `APP_URL` e o domínio na Vercel; reapontar webhooks Twilio.
- **[Find-replace cego]** `sed` global de "HubrityP"→"Hubrity" tocaria o domínio de forma inconsistente; `sed` de "hubrityp.com" pode pegar `hubrityp.com.br` parcialmente → Mitigação: edições por contexto, verificando `.com` vs `.com.br`; nunca substituição global cega.
- **[Concordância de gênero/artigo em PT]** "o Hubrity" / "ao Hubrity" → Mitigação: edição contextual e conferência de leitura.
- **[E-mail só-HTML ou só-texto esquecido]** builders têm duas partes → Mitigação: D5 testa ambas.

## Migration Plan

1. Editar metadados (root + 4 layouts públicos).
2. Editar copy de UI (login, signup, first-steps, rodapés públicos).
3. Editar e-mails (resend from + domínio + 3 builders, HTML e texto) e o rodapé do PDF.
4. Atualizar domínio da app nas refs de código (comentários/JSDoc/exemplos/placeholder/`.env.example`) e nos ~20 fixtures de teste.
5. Adicionar/estender testes (D5) e o guard anti-regressão (texto + domínio).
6. Quality gates: `lint` + `typecheck`; `test:unit`.
7. **Pré-requisito de infra (não-código):** DNS de `hubrity.com`; domínio + `APP_URL` na Vercel; verificação no Resend (SPF/DKIM); webhooks do Twilio. Coordenar com o deploy.

**Rollback:** `git revert` cobre o código (strings/fixtures, sem estado persistido). O cutover de infra tem rollback próprio (reverter `APP_URL`/DNS/Resend) e deve ser planejado junto.

## Open Questions

- Cutover de infra do domínio `hubrity.com` será feito **antes**, **junto** ou **depois** do merge? Recomendado: infra pronta (Resend verificado + `APP_URL` atualizado) antes do deploy, para não quebrar e-mail/links. É decisão de release, fora do código.
