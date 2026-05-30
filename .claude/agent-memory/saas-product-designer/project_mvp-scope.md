---
name: project_mvp-scope
description: Escopo MVP vs pós-MVP do HubrityP — quais PRDs estão no lançamento e quais foram adiados
metadata:
  type: project
---

Decisão tomada: os PRDs 04, 06, 07 e 08 foram empurrados para depois do MVP.

**MVP (no ar no lançamento):**
- PRD 01 — Cadastro e autenticação
- PRD 02 — Gestão de pacientes
- PRD 03 — Agenda e agendamentos
- PRD 05 — Prontuário eletrônico
- PRD 09 — Telepsicologia (videochamada via Stream.io)
- PRD 10 — Transcrição automática com IA (Gemini)
- PRD 11 — Onboarding e dashboard (reescrito para refletir somente o MVP)

**Pós-MVP (adiados):**
- PRD 04 — Lembretes automáticos via WhatsApp (Twilio)
- PRD 06 — Cobrança e gestão financeira (PIX via Asaas)
- PRD 07 — Emissão de Receita Saúde (e-CAC/ICP-Brasil)
- PRD 08 — Recibo para reembolso de plano de saúde

**Why:** decisão de foco tomada durante o desenvolvimento para não atrasar o lançamento. Os módulos financeiro/fiscal/WhatsApp têm dependências externas complexas (Asaas, Twilio, e-CAC) e foram considerados como segunda onda após validação do core clínico.

**How to apply:** qualquer PRD, feature ou fluxo que referencie WhatsApp automatizado, cobrança PIX, Receita Saúde ou recibos de reembolso deve ser tratado como pós-MVP. O onboarding (PRD 11) e o dashboard não devem exibir pendências, passos de wizard ou notificações dessas features até os módulos existirem.
