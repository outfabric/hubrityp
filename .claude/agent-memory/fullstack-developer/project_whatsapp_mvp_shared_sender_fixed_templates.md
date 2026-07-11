---
name: whatsapp-mvp-shared-sender-fixed-templates
description: WhatsApp MVP = 1 sender da plataforma + templates fixos da plataforma; psicólogo NÃO cria/edita templates; tab Templates deve ficar OCULTA atrás de NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED
metadata:
  type: project
---

No MVP dos lembretes WhatsApp (PR #101, shared-number), o modelo é: **um único sender da plataforma** (`TWILIO_WHATSAPP_FROM`, sem provisão per-psicólogo) e **apenas templates fixos da plataforma** (5 Content SIDs via env, seedados como `approved`; enum fechado de 6 keys). O psicólogo não cria nem edita templates.

**Decisões do usuário (2026-07-11):**
1. A tab "Templates" em `/configuracoes/lembretes` deve ser congelada pela flag `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` — e o congelamento aqui é **ocultar a tab por completo** ("não deve aparecer"), não o padrão "Em breve" desabilitado usado em cards/menu. Flags do MVP: reminders ON, inbox OFF, connection OFF. Futuramente a edição pode ser reativada ligando a flag. Bloquear as rotas por URL direta e guardar `updateTemplateImpl` server-side ficou registrado como ajuste FUTURO, fora do escopo atual.
2. `confirmacao_recebida` NÃO deve ser template Meta — o ack só dispara via quick-reply inbound (janela 24h garantidamente aberta), então template é desperdício de dinheiro. Vira mensagem **free-form** (`sendFreeText`). Escolhida a **opção B**: remover a key do enum/seed/labels por completo, corpo vira constante no código do sender, com migração de dados das linhas existentes (enum passa de 6 → 5 keys; templates Meta da plataforma passam de 5 → 4 SIDs; `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` sai do env).
3. Os 4 Content templates reais da plataforma usam variáveis **NOMEADAS** (`{{first_name}}`, `{{professional_name}}`, `{{date}}` DD/MM/AAAA, `{{time}}` HH:MM BRT, `{{session_link}}` só no link_video) — o corpo NÃO vive em código/DB; `contentVariables` deve usar essas chaves, não o dicionário PT de 12 variáveis. Só o `lembrete_24h` tem quick-replies (button IDs `confirm`/`cancel`); o webhook deve classificar por `ButtonPayload` (ID), nunca por `ButtonText` (o match por texto atual já está quebrado: constante sem acento "Nao posso comparecer").
4. `whatsapp_messages.body` fica **NULL** em sends via template (minimização LGPD) — o Histórico deriva exibição de `template_key` + status. body continua obrigatório de fato para inbound (inbox, risco, busca full-text) e outbound free-form.

**Why:** o spec `whatsapp-ui-feature-flag` já declarava que a flag connection governa "a edição de texto de template", mas a implementação só congelou os cards WhatsApp — a cadeia legada (tab Templates → template-card → `updateTemplateImpl`) ficou alcançável. Editar sobrescreve o Content SID aprovado da plataforma por um SID per-psicólogo pendente na Meta, sem rollback, e `fetchTemplate` não checa `metaStatus` → lembretes daquele tipo quebram silenciosamente para o psicólogo.

**How to apply:** ao tocar em qualquer superfície de templates WhatsApp, tratar as linhas per-psicólogo de `message_templates` como cópias do template da plataforma (multi-tenant real é modelo futuro, colunas reservadas). Não expor edição de template enquanto connection flag = OFF; considerar guard server-side em `updateTemplateImpl` além do gate visual (o spec de flags diz "escopo exclusivamente visual", mas aqui a ação tem efeito destrutivo no SID da plataforma). Relacionado: [[default-off-flag-breaks-full-view-ui-suites]] (testes RTL com flag default-OFF).
