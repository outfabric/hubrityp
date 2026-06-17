---
name: project_mvp-scope
description: Escopo MVP vs pós-MVP do HubrityP — quais PRDs estão no lançamento e quais foram adiados
metadata:
  type: project
---

Decisão tomada: os PRDs 06, 07 e 08 foram empurrados para depois do MVP. O PRD 04 foi reincluído no MVP.

**MVP (no ar no lançamento):**
- PRD 01 — Cadastro e autenticação
- PRD 02 — Gestão de pacientes
- PRD 03 — Agenda e agendamentos
- PRD 04 — Lembretes automáticos via WhatsApp (Twilio) ← reincluído no MVP
- PRD 05 — Prontuário eletrônico
- PRD 09 — Telepsicologia (videochamada via Stream.io)
- PRD 10 — Transcrição automática com IA (Gemini)
- PRD 11 — Onboarding e dashboard (reescrito para refletir somente o MVP)

**Pós-MVP (adiados):**
- PRD 06 — Cobrança e gestão financeira (PIX via Asaas)
- PRD 07 — Emissão de Receita Saúde (e-CAC/ICP-Brasil)
- PRD 08 — Recibo para reembolso de plano de saúde

**Why:** PRD 04 foi reincluído porque redução de no-show e automação de lembretes é dor imediata e quantificável (~30-45 min/dia do psicólogo). Os módulos financeiro/fiscal (Asaas, e-CAC) continuam como segunda onda.

**How to apply:** qualquer PRD, feature ou fluxo que referencie cobrança PIX, Receita Saúde ou recibos de reembolso deve ser tratado como pós-MVP. WhatsApp automatizado (PRD 04) JÁ FAZ PARTE do MVP. O onboarding (PRD 11) e o dashboard não devem exibir pendências dessas features pós-MVP até os módulos existirem.
