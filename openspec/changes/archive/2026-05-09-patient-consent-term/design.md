## Context

O termo de consentimento é uma obrigação ético-legal antes da primeira sessão. Esta change cria o fluxo completo: psicólogo gera link, paciente acessa página pública, assina, PDF é gerado e armazenado. Depende de `patient-crud-core` e opcionalmente de `patient-guardians-and-couples` (para envio ao responsável de menor).

## Goals / Non-Goals

**Goals:**
- Tabela `consent_terms` com token único e campos de assinatura
- Página pública `/termo/:token` sem autenticação
- Geração de PDF do termo assinado (pdfkit)
- Integração com Supabase Storage (bucket `consent-pdfs`)
- Status de consentimento visível no detalhe do paciente
- Envio de link via wa.me (client-side, sem integração Twilio nesta change)

**Non-Goals:**
- Integração com Twilio/WhatsApp Business API (change futura)
- Envio automático de email com cópia do termo (change futura — requer SMTP configurado)
- Template editor WYSIWYG para o psicólogo (nesta change: campo de texto simples para template)

## Decisions

### 1. Token de 64 caracteres hex via crypto.randomBytes(32)

Token suficientemente longo para ser não-adivinhável (256 bits de entropia). Armazenado como `VARCHAR(64)` com unique constraint. Sem expiração no MVP — o link permanece válido até ser usado.

**Alternativa considerada:** UUID v4 como token — rejeitada por entropia menor (122 bits) e por UUIDs serem mais comuns e potencialmente confundidos com IDs internos.

### 2. Página pública fora do layout autenticado

A rota `/termo/[token]/page.tsx` vive em `src/app/(public)/termo/[token]/page.tsx` ou `src/app/termo/[token]/page.tsx` (fora do grupo `(app)` que exige auth). Usa layout mínimo (logo, footer, sem sidebar/navigation).

O Server Component lê o consent_terms via service-role Supabase client (bypassa RLS) para buscar pelo token.

### 3. PDF gerado server-side via pdfkit

O PDF é gerado na Server Action chamada após a assinatura. Conteúdo: cabeçalho com dados do psicólogo (nome, CRP), texto integral do termo, bloco de assinatura (nome do paciente, data/hora, IP, user-agent), e nota de validade legal (MP 2.200-2/2001).

O PDF é uploaded direto para Supabase Storage via service-role e o path é salvo em `consent_terms.signed_pdf_url`.

### 4. Template de termo armazenado no perfil do psicólogo

O template padrão é um texto fixo no código (constante). O psicólogo pode customizar via um campo `consent_template` no profile (ou tabela `psychologist_settings` — TBD na implementação). Nesta change, se não houver template customizado, usa o default.

## Frontend — Design System Sálvia (`docs/design-system/rules.md`)

### Página pública `/termo/:token`
- Layout mínimo: logo centralizado no topo, bg `background`, max-width 720px (leitura longa)
- Texto do termo em body-lg (17px/400, line-height 1.65) dentro de `Card default`
- Checkbox "Li e aceito" com shadcn `Checkbox` (checked: `brand-500`)
- Botão "Assinar" como `Button primary` com loading state obrigatório
- Botão "Recusar" como `Button secondary`
- Mensagem de sucesso: ícone `CheckCircle2` em `success-500`, texto h3 "Termo assinado com sucesso"
- Mensagem de já assinado: ícone `Info` em `info-500`
- Mensagem de token inválido: 404 com ícone `AlertCircle` em `danger-500`
- **Acessibilidade:** contraste WCAG AA no texto do termo, foco visível em checkbox e botões
- **Mobile-first:** full-width em mobile, padding `space-4`

### Badges de consentimento no detalhe do paciente
- Assinado: `Badge success` (bg `success-50`, text `success-700`) "Consentimento assinado"
- Pendente: `Badge warning` (bg `warning-50`, text `warning-700`) "Consentimento pendente"
- Revogado: `Badge danger` (bg `danger-50`, text `danger-700`) "Consentimento revogado"

### Botões de ação no detalhe
- "Enviar por WhatsApp": `Button ghost` com ícone `MessageCircle`
- "Copiar link": `Button ghost` com ícone `Link`, toast success "Link copiado" ao clicar
- "Revogar consentimento": no `DropdownMenu`, com `AlertDialog` de confirmação

### Microcopy
- Botão de envio: "Enviar termo por WhatsApp" (não "Enviar consentimento")
- Toast: "Link do termo copiado" (não "Copied to clipboard")

## Risks / Trade-offs

- **[Sem expiração do token]** → Um link vazado permanece válido indefinidamente. Mitigation: o psicólogo pode revogar o consentimento, e o token só pode ser usado uma vez (after signing, retorna "já assinado").
- **[pdfkit no serverless]** → pdfkit funciona em Node.js sem dependências nativas. Tamanho do bundle pode aumentar. Mitigation: dynamic import para não impactar cold start de outras funções.
- **[Service role para página pública]** → A página pública usa service-role para ler consent_terms (RLS bloquearia, pois não há user autenticado). Risco de exposição se mal configurado. Mitigation: o Route Handler/Server Component filtra APENAS pelo token, nunca expõe dados além do termo específico.
