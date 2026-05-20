## Context

A página de detalhe do paciente (`/pacientes/[id]`) renderiza um `PatientTabs` (Radix Tabs via shadcn) com seis abas, das quais quatro eram placeholders "Em breve" no momento em que o componente foi desenhado. Ao longo de mai/2026, sete changes implementaram e arquivaram a funcionalidade completa de prontuário em uma rota dedicada (`/pacientes/[id]/prontuario`), mas a aba "Prontuário" no `PatientTabs` ficou esquecida e ainda mostra "Em breve". Na última iteração da change `prontuario-export-pdf` (commit `d09d5c4`), a aba "Documentos" foi convertida em painel de redirect apontando para a página dedicada — criando, sem intenção, duplicidade com a aba "Prontuário".

O `PatientTabs` é um componente client (`'use client'`) sem dependências de I/O: ele recebe `patientId`, `overviewContent` e `anamnesisContent` por props e organiza a renderização em torno de uma única estrutura de dados (`TABS: TabDefinition[]`).

Esta change é estritamente de UX e cosmética visual — nenhum requisito de segurança (auth gating, RLS, LGPD), nenhuma mudança em queries, server actions, schemas Drizzle, políticas, middleware ou env vars. Toda a complexidade vive em um único arquivo de produção (`patient-tabs.tsx`) e na cobertura de testes correspondente.

## Goals / Non-Goals

**Goals:**

- Eliminar o falso negativo de UX em que a aba "Prontuário" diz "Em breve" para uma funcionalidade já em produção.
- Reduzir duplicidade na navegação removendo a aba "Documentos" (cuja única função hoje é apontar para `/pacientes/[id]/prontuario`).
- Alinhar o ícone da aba "Financeiro" (`Wallet` → `Receipt`) ao contexto fiscal brasileiro (recibo de sessão para abatimento de IR).
- Manter o padrão visual e de acessibilidade já estabelecido pelo painel da aba "Documentos" no commit `d09d5c4`, copiando-o para a aba "Prontuário".
- Cobertura de testes (unit + E2E) que trave o novo contrato — abas presentes/ausentes, ícone correto, painel de redirect funcional.

**Non-Goals:**

- Refatorar o componente `PatientTabs` para um modelo de "abas-com-link" (algumas TabsTrigger sendo `<Link>`). Já foi avaliado e descartado nesta iteração por aumentar complexidade sem ganho proporcional.
- Mexer em qualquer rota do prontuário (`/pacientes/[id]/prontuario/*`) — está fora do escopo.
- Substituir/alterar comportamento das abas "Histórico de sessões" e "Financeiro" — continuam placeholders "Em breve" (a do "Financeiro" só troca o ícone).
- Adicionar deep-link ou query param para selecionar uma aba específica via URL.
- Mudar a aba padrão (continua "Visão geral").

## Decisions

**1. Aba "Prontuário": painel de redirect, NÃO link-no-trigger.**

A aba "Prontuário" permanece sendo um `TabsTrigger` Radix; ao ser clicada, exibe um `<TabsContent>` com ícone, título, descrição e botão "Abrir prontuario" (`<Link>`). Alternativa considerada: tornar o próprio trigger um `<Link>` (clique já navega, sem painel intermediário). Descartada porque: (a) quebra a metáfora "abas" (uma das triggers comportar-se-ia diferente das outras), (b) exige replicar manualmente o styling Radix Tabs num componente custom, (c) o padrão de painel de redirect já está estabelecido no repo (aba "Documentos" no commit `d09d5c4`), facilitando consistência e onboarding. O custo de um clique extra é aceitável dado o ganho em consistência.

**2. Aba "Documentos": remoção total.**

A aba "Documentos" passa a não existir mais — nem no array `TABS`, nem como `<TabsContent>`. Alternativa considerada: manter a aba e fazê-la apontar diretamente para `/pacientes/[id]/prontuario/documentos`. Descartada porque mantém duplicidade conceitual com a aba "Prontuário" (ambas seriam atalhos para a mesma feature, só em rotas filhas diferentes). A página do prontuário já oferece navegação interna para documentos clínicos, e o painel de redirect da aba "Prontuário" cobre o ponto de entrada.

**3. Ícone "Financeiro": `Receipt`.**

Trocar `Wallet` por `Receipt`. Alternativa considerada: manter `Wallet`. Descartada porque, no contexto brasileiro do produto (PIX manual, recibos de sessão para IR — ver CLAUDE.md), o usuário associa "financeiro" muito mais a recibos/comprovantes do que a "carteira". `Receipt` também era o ícone que estava em "Documentos" e fica disponível com a remoção.

**4. Texto do painel "Prontuário".**

Curto, factual, sem promessas vazias. Espelha o tom já usado em "Documentos clinicos" no commit `d09d5c4`. Inclui menção às áreas que vivem no prontuário (evoluções, hipóteses, escalas, plano terapêutico, documentos) para reduzir incerteza do usuário sobre o que vai encontrar na próxima tela. Sem acentos no texto (consistência com o resto do componente, que usa "Visao geral", "Prontuario" etc.).

**5. `data-testid`s.**

- Trigger da aba: `patient-tab-records` (já existe; mantém).
- Conteúdo: `patient-tab-content-records` (já existe; mantém).
- Botão de abertura: `patient-tab-records-open-prontuario` (novo). Segue o padrão `patient-tab-documents-open-prontuario` do commit `d09d5c4`.
- Não há `data-testid` da aba "Documentos" a manter — testes que referenciam `patient-tab-documents*` devem ser deletados.

**6. Estratégia de testes.**

- **Unit (Vitest + RTL)** — `src/__tests__/unit/modules/patients/components/patient-tabs.test.tsx` (criar se não existir): cobertura de pura composição/render. Testa: (a) abas renderizadas e a ordem, (b) ausência de "Documentos" no DOM, (c) ícone da aba "Financeiro" é `Receipt`, (d) clicar em "Prontuario" mostra painel com botão cujo `href` é `/pacientes/<id>/prontuario`, (e) abas placeholder ("Histórico de sessões", "Financeiro") mostram "Em breve". Nenhum mock de Supabase / DB / network — componente é puro client-side.
- **E2E (Playwright + seeded)** — `src/__tests__/e2e/seeded/patients/patient-detail.spec.ts`: remover qualquer asserção a `patient-tab-documents*` e adicionar fluxo: navegar para `/pacientes/<seeded-id>`, clicar em `patient-tab-records`, verificar painel + botão, clicar no botão e confirmar URL `/pacientes/<seeded-id>/prontuario`.
- **Integration**: nenhuma. Não há boundary I/O envolvido (sem Server Action, sem Route Handler, sem mudança em RLS) — Vitest unit + Playwright E2E cobrem tudo o que importa.

**7. Backward compatibility.**

Há um break de UX (usuários que usavam "Documentos" no painel de abas terão que clicar em "Prontuário"), mas nenhum break técnico (sem URL/route/API removida). A página `/pacientes/[id]/prontuario/documentos` continua existindo e acessível pela navegação interna do prontuário. Sem migração ou comunicação especial necessária — o painel da nova aba "Prontuário" guia o usuário.

## Risks / Trade-offs

- [Risco: usuário tenta clicar em "Documentos" por hábito] → Mitigação: painel da aba "Prontuário" menciona explicitamente "documentos clínicos" no texto, levando o usuário a entender que estão lá dentro. Risco baixo — o repo ainda não tem volume de usuários e mudanças semelhantes (commit `d09d5c4`) não geraram queixa.
- [Risco: teste E2E flaky por animação Radix Tabs] → Mitigação: já existe um padrão estável de aguardar o `data-testid` do conteúdo aparecer (`patient-tab-content-records`) usado pelos testes do commit `d09d5c4`. Replicar.
- [Trade-off: clique extra para chegar ao prontuário pelo painel "Prontuário"] → Aceito conscientemente em prol da consistência visual e da acessibilidade do painel. Caso a fricção fique tangível depois, é trivial promover a aba para `<Link>` no `TabsList` (decisão revisitável).
- [Risco: outros consumidores externos importam algum testid ou texto da aba "Documentos"] → Mitigação: `grep` por `patient-tab-documents`, `Documentos clinicos`, `documents` antes de remover, para confirmar que o escopo de remoção é local ao componente e aos testes.

## Migration Plan

Esta change não envolve schema, dados, jobs nem APIs — não há migração no sentido tradicional.

Deploy steps:

1. Aplicar o patch em `patient-tabs.tsx`.
2. Atualizar/criar os testes unit + E2E.
3. Rodar `npm run test:unit`, `npm run lint`, `npm run typecheck`, e a suíte `npm run test:e2e:seeded` (ou equivalente local) localmente.
4. Abrir PR; após merge, deploy automático via Vercel.

Rollback: revert do commit. Sem efeito colateral (zero estado persistido tocado).

## Open Questions

Nenhuma bloqueante. Itens explícitos para revisitar pós-deploy se aparecerem como atrito real:

- Vale a pena, no futuro, ter um deep-link estilo `/pacientes/[id]?tab=anamnese` para abrir uma aba específica via URL? Hoje não é necessário, mas é uma evolução natural.
- Caso o produto cresça e usuários peçam "voltar para os Documentos como aba", reavaliar se vira aba dedicada ou continua acessível só pela rota do prontuário.
