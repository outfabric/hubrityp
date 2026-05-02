# PRD 00 — Visão Geral do Produto (MVP)

> **Leia este documento ANTES de qualquer outro PRD.** Ele estabelece o contexto, o público-alvo, o stack recomendado e as restrições regulatórias que se aplicam a todo o sistema.

---

## 1. O que é o produto

Um **SaaS web** voltado para **psicólogos autônomos brasileiros** que atendem pacientes em consultório próprio, online ou no formato híbrido. O produto centraliza, em uma única ferramenta, todas as tarefas administrativas e clínicas que hoje o psicólogo faz em ferramentas separadas (Google Agenda + WhatsApp + Word + Excel + PIX manual).

**Frase de posicionamento:** "O único prontuário feito por psicólogos para psicólogos, com IA que respeita o CFP e Receita Saúde em um clique."

## 2. Quem é o usuário (persona)

- **Profissão:** Psicóloga(o) com registro ativo em Conselho Regional de Psicologia (CRP).
- **Modalidade de trabalho:** Autônoma (PF ou PJ no Simples Nacional). NÃO é CLT, NÃO é servidor público.
- **Volume de atendimentos:** 15 a 40 pacientes por semana.
- **Tempo de carreira:** 3 a 15 anos.
- **Faixa etária:** 28 a 45 anos.
- **Tecnologia:** Usa smartphone Android/iOS o tempo todo, computador (Windows ou Mac) algumas horas por dia. Não é especialista em tecnologia — espera que as coisas "simplesmente funcionem".
- **Sensibilidade:** Trabalha com dados extremamente sensíveis (saúde mental). Tem alta consciência ética sobre sigilo profissional e LGPD.

## 3. As três dores que o MVP resolve

1. **Burocracia fiscal** — emitir Receita Saúde (obrigatório desde 01/01/2025) e recibos para reembolso de plano de saúde toma horas por mês.
2. **No-show e cobrança manual** — paciente falta sem avisar, lembretes WhatsApp manuais consomem 30+ min/dia, controle de pagamentos é desorganizado.
3. **Registro clínico em três lugares** — anotação em caderno, evolução no Word, observação no celular. Nada conversa entre si.

## 4. Stack técnico recomendado

> Estas escolhas são recomendações, não obrigatórias. Se você (dev) tiver razão técnica para mudar, documente.

- **Frontend:** Next.js 16+ (App Router) com TypeScript, Tailwind CSS e shadcn/ui.
- **Backend:** Next.js API Routes (mesma base).
- **Banco de dados:** PostgreSQL via Supabase (inclui auth, storage, realtime).
- **Hospedagem:** Vercel (frontend) + Supabase (DB) — ambos com região São Paulo (`sa-east-1`) por exigência de LGPD em saúde.
- **Storage:** Supabase Storage para anexos (criptografado em repouso).
- **Filas, jobs assíncronos e cronjobs:** Utilizar a ferramenta Inngest, pois ela oferece um free-tier generoso.
- **IA (transcrição):** Google Gemini 3 Flash.
- **IA (geração de texto):** Google Gemini 3 flash.
- **Pagamentos (assinatura do psicólogo):** Asaas é preferido por gerar nota fiscal automática.
- **Pagamentos (cobrança paciente pelo psicólogo):** PIX direto na chave do psicólogo via Asaas Split. NUNCA passar pelo nosso sistema (regulação Bacen).
- **WhatsApp:** Utilizar o BSP Twilio para integração com a API oficial do WhatsAPP Business.
- **Vídeo (telepsicologia):** Stream.io, pois ele oferece créditos gratuitos. Áudio gravado deve ser efêmero (não persistido).
- **Assinatura digital:** ICP-Brasil para laudos (pode ser implementado depois do MVP).

## 5. Restrições regulatórias que se aplicam a TODO o sistema

> **Estas regras NÃO são opcionais.** Toda feature deve ser construída respeitando-as.

### 5.1. LGPD (Lei 13.709/2018) — dados sensíveis de saúde

- Toda informação clínica de paciente é **dado pessoal sensível** (art. 5º, II + art. 11).
- Criptografia obrigatória: **AES-256 em repouso, TLS 1.3 em trânsito**.
- Logs de acesso a prontuário devem ser auditáveis (quem viu, quando, de qual IP).
- Consentimento granular do paciente para cada finalidade (atendimento, gravação, comunicação por WhatsApp).
- Direito de eliminação do paciente (art. 18, VI) **conflita** com obrigação legal de guarda de prontuário (Lei 13.787/2018, 20 anos para prontuário digital). Nesse conflito, **prevalece a obrigação legal** — o sistema deve documentar a recusa de exclusão fundamentada.
- Multa máxima ANPD: 2% do faturamento, limitado a R$ 50 milhões.

### 5.2. Resolução CFP nº 001/2009 — Prontuário Psicológico

- Todo atendimento gera registro obrigatório.
- O psicólogo deve manter prontuário por no mínimo 5 anos após a última sessão (atualizado para 20 anos pela Lei 13.787/2018 quando digital).
- Paciente tem direito de acesso ao próprio prontuário (art. 5º).
- Existe documento separado: **registro documental restrito ao psicólogo** (notas pessoais que NÃO compõem o prontuário).

### 5.3. Resolução CFP nº 06/2019 — Documentos Psicológicos

- Define cinco tipos: declaração, atestado, relatório/laudo, parecer, multiprofissional.
- Estrutura formal obrigatória: identificação, descrição da demanda, procedimentos, análise, conclusão, local/data/assinatura.
- Numeração de laudas e rubrica em todas as páginas (assinatura ICP-Brasil supre rubrica física).

### 5.4. Resolução CFP nº 09/2024 — Telepsicologia

- Atendimento online por psicólogo brasileiro está autorizado (revogou cadastro e-Psi).
- Exige avaliação técnica caso a caso, contrato formal com paciente e cumprimento da LGPD.
- Atendimento somente dentro do território nacional (psicólogo e paciente no Brasil).

### 5.5. Resolução CFP nº 13/2022 — Gravação de Sessão

- Gravação só pode ocorrer com **consentimento livre, prévio, informado, por escrito e justificado pelo método**.
- Termo de consentimento digital robusto é mandatório antes de qualquer gravação.

### 5.6. IN RFB nº 2.240/2024 — Receita Saúde

- Obrigatório desde 01/01/2025 para psicólogos pessoa física.
- Substitui o RPA (Recibo de Prestação Autônoma).
- Multa por não emissão ou emissão incorreta: até 20% do valor declarado.
- Integração via API e-CAC do governo.

### 5.7. Código de Ética do Psicólogo

- Sigilo profissional é absoluto, exceto em risco iminente (art. 9º).
- CID-10 no recibo é controverso (pode ferir sigilo); o sistema deve permitir emissão **com OU sem CID** a critério do psicólogo.

## 6. Arquitetura de alto nível

```
┌─────────────────────────────────────────────────────┐
│              Frontend Next.js (Vercel)
└─────────────────────────────────────────────────────┘
                       │ HTTPS (TLS 1.3)
                       ▼
┌─────────────────────────────────────────────────────┐
│  API (Next.js API Routes)                 │
│  - Autenticação JWT (Supabase Auth)                 │
│  - Rate limiting                                    │
│  - Audit log                                        │
└─────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼────────────────┬───────────────────────────┬
        ▼              ▼                ▼                           ▼
   PostgreSQL    Supabase Storage   Filas async / cronjobs       Integrações externas
   (criptografado) (S3-compatível)         (Inngest)                   
                                                                 - Twilio (WA)
                                                                 - Google Gemini
                                                                 - e-CAC
                                                                 - Asaas
                                                                 - Stream.io
```

## 7. Como ler os PRDs deste projeto

Cada PRD segue a estrutura:

1. **Contexto e problema** — por que essa feature existe
2. **Objetivo da feature** — o que ela entrega
3. **Escopo** — o que está dentro e o que está fora
4. **User stories** — quem usa e para quê
5. **Requisitos funcionais (RF)** — o que o sistema DEVE fazer
6. **Requisitos não-funcionais (RNF)** — performance, segurança, etc.
7. **Regras de negócio** — restrições e validações
8. **Edge cases** — casos extremos a tratar
9. **Critérios de aceitação** — testes que devem passar
10. **Dependências** — outras features ou serviços externos
11. **Referências regulatórias** — normas aplicáveis

## 8. Ordem recomendada de implementação

1. **PRD 01** — Cadastro e autenticação (base de tudo)
2. **PRD 02** — Gestão de pacientes
3. **PRD 03** — Agenda
4. **PRD 04** — Lembretes WhatsApp
5. **PRD 05** — Prontuário eletrônico
6. **PRD 06** — Cobrança e financeiro (PIX, controle de pagamentos)
7. **PRD 07** — Receita Saúde
8. **PRD 08** — Recibo para reembolso
9. **PRD 09** — Telepsicologia (vídeo)
10. **PRD 10** — Transcrição com IA
11. **PRD 11** — LGPD, segurança e auditoria (transversal — começar early)
12. **PRD 12** — Onboarding e dashboard

## 9. Princípios gerais de UX

- **Português brasileiro claro**, sem jargão técnico médico (psicólogo NÃO é médico).
- **Vocabulário psi-nativo**: "sessão" não "consulta", "paciente" ou "cliente" (sistema deve permitir escolha), "evolução" ou "registro" não "prontuário" no nome do botão (mas o backend mantém "prontuário" pela conformidade CFP).
- **Modo escuro** disponível.
- **Acessibilidade** WCAG 2.1 AA mínimo.

## 10. Glossário

| Termo | Definição |
|---|---|
| CFP | Conselho Federal de Psicologia |
| CRP | Conselho Regional de Psicologia (estadual) |
| e-Psi | Cadastro de telepsicologia (extinto pela Res. 09/2024) |
| Receita Saúde | Sistema da Receita Federal para emissão de recibos por profissionais de saúde |
| TUSS | Terminologia Unificada da Saúde Suplementar — códigos de procedimentos |
| TISS | Padrão de troca de informações com operadoras de plano de saúde |
| CID-10 | Classificação Internacional de Doenças, 10ª revisão |
| LGPD | Lei Geral de Proteção de Dados (Lei 13.709/2018) |
| ANPD | Autoridade Nacional de Proteção de Dados |
| ICP-Brasil | Infraestrutura de Chaves Públicas brasileira (assinatura digital) |
| ILPI | Instituição de Longa Permanência para Idosos (não aplicável aqui) |
| SATEPSI | Sistema de Avaliação de Testes Psicológicos do CFP |

---

**Próximo passo:** leia o PRD 01 (Cadastro e Autenticação) antes de codar qualquer coisa.