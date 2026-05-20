## 1. Verificação prévia

- [ ] 1.1 Rodar `grep -rn "patient-tab-documents\|Documentos clinicos\|patient-tab-documents-open-prontuario" src/` para confirmar que os únicos consumidores das referências da aba "Documentos" são o próprio `patient-tabs.tsx` e (eventualmente) testes. Listar achados antes de prosseguir.
- [ ] 1.2 Confirmar que `src/app/(app)/pacientes/[id]/prontuario/page.tsx` e a rota filha `documentos/` continuam existindo e funcionais (rota de destino do botão "Abrir prontuario").

## 2. Source change — `PatientTabs`

- [ ] 2.1 Em `src/modules/patients/components/patient-tabs.tsx`, remover `Wallet` do import de `lucide-react` e adicionar (ou manter) `Receipt` e `FileText`.
- [ ] 2.2 No array `TABS`, remover a entry de `value: 'documents'`.
- [ ] 2.3 No array `TABS`, alterar a entry de `value: 'financial'` para usar o ícone `<Receipt …/>` (substituindo `<Wallet …/>`).
- [ ] 2.4 No array `TABS`, na entry de `value: 'records'`, mudar `placeholder: true` para `placeholder: false` para que o loop de placeholders não a alcance.
- [ ] 2.5 Remover o bloco `<TabsContent value="documents">` inteiro (painel atual de "Documentos clinicos" com botão "Abrir prontuario").
- [ ] 2.6 Adicionar um novo `<TabsContent value="records" data-testid="patient-tab-content-records">` espelhando o padrão do antigo painel de "Documentos": ícone `FileText`, título "Prontuario", texto curto mencionando evolucoes/hipoteses/escalas/plano/documentos, e botão (`Button asChild` + `Link`) com `data-testid="patient-tab-records-open-prontuario"` apontando para `/pacientes/${patientId}/prontuario`.
- [ ] 2.7 Conferir que o loop final `TABS.filter((tab) => tab.placeholder).map(...)` agora cobre apenas `sessions` e `financial` (nenhum trigger órfão sem `<TabsContent>`).
- [ ] 2.8 Rodar `npm run lint` e `npm run typecheck`; corrigir qualquer warning/erro introduzido (imports não usados, etc.).

## 3. Testes unitários

- [ ] 3.1 Criar `src/__tests__/unit/modules/patients/components/patient-tabs.test.tsx` com setup Vitest + React Testing Library, importando `PatientTabs` e mockando `next/link` somente se necessário.
- [ ] 3.2 Adicionar teste: renderiza, na ordem esperada, os triggers "Visao geral", "Historico de sessoes", "Prontuario", "Anamnese", "Financeiro" — e NENHUM trigger "Documentos".
- [ ] 3.3 Adicionar teste: o elemento com `data-testid="patient-tab-documents"` NÃO existe no DOM, e `data-testid="patient-tab-content-documents"` também não.
- [ ] 3.4 Adicionar teste: o trigger "Financeiro" (`patient-tab-financial`) contém um SVG com classes/atributos que comprovam o ícone `Receipt` (ex.: `lucide-receipt`), e não contém o ícone `Wallet`.
- [ ] 3.5 Adicionar teste: ao clicar em "Prontuario" (`patient-tab-records`), aparece `patient-tab-content-records` com título "Prontuario", descrição mencionando "prontuario", e um link/botão `patient-tab-records-open-prontuario` cujo `href` é `/pacientes/<patientId>/prontuario` (usar `patientId` arbitrário, ex.: `"abc-123"`).
- [ ] 3.6 Adicionar teste: ao clicar em "Historico de sessoes" (`patient-tab-sessions`) e em "Financeiro" (`patient-tab-financial`), o placeholder com texto "Em breve" (`patient-tab-placeholder-sessions` / `patient-tab-placeholder-financial`) é exibido.
- [ ] 3.7 Adicionar teste: a aba default é "Visao geral" (o conteúdo `patient-tab-content-overview` está visível sem clique inicial).
- [ ] 3.8 Rodar `npm run test:unit -- patient-tabs` e garantir verde.

## 4. Testes E2E

- [ ] 4.1 Em `src/__tests__/e2e/seeded/patients/patient-detail.spec.ts`, conferir que o teste existente `placeholder tabs show "Em breve" message` (linha ~88) continua válido — ele cobre apenas `sessions` e `financial`, então sem mudanças aqui. Se houver outra asserção a `patient-tab-documents*` em qualquer lugar do arquivo, removê-la.
- [ ] 4.2 Adicionar novo teste `'Prontuário tab redirects to prontuario page'`: navegar para a página do paciente seed, clicar em `patient-tab-records`, aguardar `patient-tab-content-records` visível, verificar a presença do link `patient-tab-records-open-prontuario`, clicar nele, e confirmar que `page.url()` termina em `/pacientes/<patientId>/prontuario`.
- [ ] 4.3 Adicionar (mesmo arquivo) asserção curta `'Documentos tab is not rendered'`: navegar para a página do paciente, verificar `expect(page.getByTestId('patient-tab-documents')).toHaveCount(0)`.
- [ ] 4.4 Rodar `npm run test:e2e:seeded -- patient-detail` localmente (Docker Compose up + Playwright seeded suite). Garantir verde.

## 5. Validação final

- [ ] 5.1 Rodar `openspec validate patient-tabs-prontuario-shortcut` — deve reportar `is valid`.
- [ ] 5.2 Rodar `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e:seeded`.
- [ ] 5.3 Smoke test manual (browser): subir Docker Compose, logar, abrir um paciente, navegar pelas 5 abas, validar (a) "Prontuario" mostra painel com botão e o botão leva pra `/prontuario`, (b) "Documentos" não está na lista, (c) ícone de "Financeiro" é o `Receipt`.
- [ ] 5.4 Commit + abrir PR.
- [ ] 5.5 Após merge: arquivar a change com `/opsx:archive patient-tabs-prontuario-shortcut`.
