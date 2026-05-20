## Why

A funcionalidade de prontuário foi entregue ao longo de sete changes arquivadas (mai/2026), mas a aba "Prontuário" no detalhe do paciente (`/pacientes/[id]`) continua exibindo o placeholder genérico "Em breve", desviando o psicólogo do ponto de entrada real em `/pacientes/[id]/prontuario`. Em paralelo, a aba "Documentos" foi convertida em painel de redirect para a mesma página do prontuário, criando duplicidade de navegação. Esta change consolida a UX: "Prontuário" passa a ser o atalho explícito, "Documentos" é removida, e o ícone de "Financeiro" assume o ícone `Receipt` (recibo) que combina melhor com o contexto brasileiro de comprovantes de sessão para IR.

## What Changes

- A aba "Prontuário" deixa de ser um placeholder "Em breve" e passa a renderizar um painel de redirect (ícone + título "Prontuario" + descrição curta + botão "Abrir prontuario") que aponta para `/pacientes/[id]/prontuario`, espelhando o padrão já usado pela aba "Documentos".
- **BREAKING (UX)**: A aba "Documentos" é removida do `PatientTabs`. Documentos clínicos (declarações, atestados, laudos, etc.) continuam acessíveis via a página dedicada do prontuário (`/pacientes/[id]/prontuario/documentos`), apenas deixam de ter entrada própria no painel de abas do paciente.
- O ícone da aba "Financeiro" muda de `Wallet` (carteira) para `Receipt` (recibo) — alinhado ao contexto fiscal brasileiro (psicólogo emite recibo da sessão para o paciente abater no IR).
- Cobertura de testes E2E em `patient-detail.spec.ts` ganha dois casos novos amarrados aos deltas: (i) "Prontuário" → clica na aba, vê painel, clica no botão, URL termina em `/pacientes/[id]/prontuario`; (ii) "Documentos" → `toHaveCount(0)` no testid da aba. O teste já existente `placeholder tabs show "Em breve" message` permanece inalterado (cobre apenas `sessions` e `financial`).
- Cobertura unitária do `PatientTabs` é criada (arquivo novo) com **um teste por delta**: ausência da aba "Documentos", ícone `Receipt` na aba "Financeiro", e clique em "Prontuário" → painel + link para `/pacientes/[id]/prontuario`. Comportamento pré-existente (ordem dos triggers, aba default, placeholder das outras abas) NÃO é reafirmado aqui — fica no escopo do E2E que já existe.

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `patient-detail`: o requisito "Patient detail page uses a tab layout" muda — "Prontuário" deixa de ser placeholder "Em breve" e passa a ser um painel de redirect; "Documentos" é removida do painel; "Financeiro" passa a usar o ícone `Receipt`.

## Impact

- **Produção (source)**: `src/modules/patients/components/patient-tabs.tsx` é a única source change. Sem alterações em server actions, rotas, schemas Drizzle, políticas RLS, middleware ou env vars.
- **Testes**:
  - `src/__tests__/e2e/seeded/patients/patient-detail.spec.ts` — ajustes nas asserções de abas.
  - `src/__tests__/unit/modules/patients/components/patient-tabs.test.tsx` — criar ou estender testes unitários cobrindo o novo painel.
  - Não há mudanças que motivem testes de integração novos (componente client-only, sem boundary de I/O).
- **Rotas externas**: nenhuma. A rota `/pacientes/[id]/prontuario` (e suas filhas `evolucoes/`, `documentos/`, `exportacoes/`) já existe e permanece intocada.
- **Compatibilidade**: usuários que tinham o hábito de clicar em "Documentos" no painel de abas precisarão se acostumar a abrir o prontuário primeiro. Não há link externo conhecido nem deep-link que dependa da aba "Documentos" existir.
