## 1. Verificação prévia

- [x] 1.1 Rodar `grep -rn "patient-tab-documents\|Documentos clinicos\|patient-tab-documents-open-prontuario" src/` para confirmar que os únicos consumidores das referências da aba "Documentos" são o próprio `patient-tabs.tsx` e (eventualmente) testes. Listar achados antes de prosseguir.
- [x] 1.2 Confirmar que `src/app/(app)/pacientes/[id]/prontuario/page.tsx` e a rota filha `documentos/` continuam existindo e funcionais (rota de destino do botão "Abrir prontuario").

## 2. Source change — `PatientTabs`

- [x] 2.1 Em `src/modules/patients/components/patient-tabs.tsx`, remover `Wallet` do import de `lucide-react` e adicionar (ou manter) `Receipt` e `FileText`.
- [x] 2.2 No array `TABS`, remover a entry de `value: 'documents'`.
- [x] 2.3 No array `TABS`, alterar a entry de `value: 'financial'` para usar o ícone `<Receipt …/>` (substituindo `<Wallet …/>`).
- [x] 2.4 No array `TABS`, na entry de `value: 'records'`, mudar `placeholder: true` para `placeholder: false` para que o loop de placeholders não a alcance.
- [x] 2.5 Remover o bloco `<TabsContent value="documents">` inteiro (painel atual de "Documentos clinicos" com botão "Abrir prontuario").
- [x] 2.6 Adicionar um novo `<TabsContent value="records" data-testid="patient-tab-content-records">` espelhando o padrão do antigo painel de "Documentos": ícone `FileText`, título "Prontuario", texto curto mencionando evolucoes/hipoteses/escalas/plano/documentos, e botão (`Button asChild` + `Link`) com `data-testid="patient-tab-records-open-prontuario"` apontando para `/pacientes/${patientId}/prontuario`.
- [x] 2.7 Conferir que o loop final `TABS.filter((tab) => tab.placeholder).map(...)` agora cobre apenas `sessions` e `financial` (nenhum trigger órfão sem `<TabsContent>`).

## 3. Testes unitários

Escopo: somente os três deltas desta change — (a) remoção da aba "Documentos", (b) ícone de "Financeiro" → `Receipt`, (c) aba "Prontuário" → painel de redirect. Composição/ordem dos triggers sobreviventes, aba default e comportamento placeholder de "Sessões"/"Financeiro" são pré-existentes e NÃO devem ser asseridos aqui.

- [ ] 3.1 Criar `src/__tests__/unit/modules/patients/components/patient-tabs.test.tsx` com setup Vitest + React Testing Library, importando `PatientTabs` e mockando `next/link` somente se necessário.
- [ ] 3.2 Adicionar teste para o delta (a): nenhum elemento com `data-testid="patient-tab-documents"` existe no DOM, e nenhum `data-testid="patient-tab-content-documents"` também.
- [ ] 3.3 Adicionar teste para o delta (b): o trigger "Financeiro" (`patient-tab-financial`) contém um SVG do ícone `Receipt` (ex.: classe `lucide-receipt`) e NÃO contém o ícone `Wallet` (`lucide-wallet`). O teste foca exclusivamente no ícone — não reafirma o texto da aba nem o placeholder "Em breve".
- [ ] 3.4 Adicionar teste para o delta (c): ao clicar em `patient-tab-records`, `patient-tab-content-records` fica visível, contém o título "Prontuario" e um link/botão `patient-tab-records-open-prontuario` cujo `href` é `/pacientes/<patientId>/prontuario` (usar `patientId` arbitrário, ex.: `"abc-123"`).

## 4. Testes E2E

Escopo: cobrir o novo fluxo de redirect da aba "Prontuário" (delta c) e a ausência da aba "Documentos" (delta a). O teste já existente `placeholder tabs show "Em breve" message` cobre apenas `sessions` e `financial` — NÃO o tocaremos (continua válido sem alteração). O delta do ícone Financeiro (b) é coberto suficientemente em unit (item 3.3), sem precisar de E2E adicional.

- [ ] 4.1 Em `src/__tests__/e2e/seeded/patients/patient-detail.spec.ts`, fazer uma busca por `patient-tab-documents` no arquivo; remover qualquer asserção encontrada (não há nenhuma esperada hoje, mas confirmar).
- [ ] 4.2 Adicionar novo teste `'Prontuário tab redirects to prontuario page'`: navegar para a página do paciente seed, clicar em `patient-tab-records`, aguardar `patient-tab-content-records` visível, clicar em `patient-tab-records-open-prontuario`, e confirmar que `page.url()` termina em `/pacientes/<patientId>/prontuario`.
- [ ] 4.3 Adicionar novo teste curto `'Documentos tab is not rendered'`: navegar para a página do paciente, verificar `expect(page.getByTestId('patient-tab-documents')).toHaveCount(0)`.
