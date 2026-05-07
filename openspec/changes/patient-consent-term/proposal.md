## Why

Antes da primeira sessão, o paciente precisa assinar um termo de consentimento informado (obrigação ético-legal). Hoje isso é feito em papel ou PDF enviado por email. O sistema deve gerar um link único que o paciente (ou responsável, se menor) acessa em qualquer dispositivo, lê o termo e aceita eletronicamente — criando registro legal válido (MP 2.200-2/2001 art. 10, §2º).

## What Changes

- Nova tabela `consent_terms` com token único, texto do termo, e campos de assinatura (IP, user-agent, timestamp)
- Geração de token seguro (crypto.randomBytes) para link público do termo
- Página pública `/termo/:token` (sem autenticação) onde paciente lê e aceita o termo
- Geração de PDF do termo assinado (pdfkit) armazenado em Supabase Storage
- Botão "Enviar termo por WhatsApp" e "Copiar link" no detalhe do paciente
- Template padrão de termo editável pelo psicólogo (armazenado no perfil ou settings)
- Envio automático de cópia por email ao paciente após aceite
- Marcação de `consent_signed_at` no paciente após assinatura
- Possibilidade de revogação (`consent_revoked_at`) com aviso ao psicólogo
- Se menor de idade, link é enviado ao responsável

## Capabilities

### New Capabilities
- `patient-consent`: Geração, envio, assinatura digital e armazenamento de termos de consentimento, incluindo link público com token, registro de aceite (IP, user-agent, timestamp), geração de PDF, e fluxo de revogação

### Modified Capabilities
- `patient-detail`: A página de detalhes exibe status do consentimento (pendente/assinado/revogado) e botões de ação (enviar/reenviar termo)
- `patient-crud`: O campo `consent_signed_at` do paciente é atualizado pelo fluxo de assinatura

## Impact

- **Banco de dados:** Nova migration criando tabela `consent_terms` com RLS
- **Supabase Storage:** Novo bucket `consent-pdfs` (privado)
- **Dependências:** `pdfkit` (geração de PDF)
- **Rotas novas:** `src/app/termo/[token]/page.tsx` (pública, sem layout autenticado)
- **Módulo pacientes:** Server actions para gerar termo, verificar assinatura, revogar
- **Integração futura:** Envio de link via WhatsApp (Twilio) — nesta change, apenas copia link / abre wa.me
