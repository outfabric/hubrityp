# crp-validation

## Resumo

Valida sincronamente o número e a UF do CRP no momento de submissão (formato `XX/NNNNNN` + código regional 01..24 conforme PRD-01 Apêndice A) e mantém a fila de revisão manual do CRP até que um operador (service-role) aprove ou rejeite cada inscrição. A revisão automatizada via lookup CFP é deferida para uma evolução futura (PRD-01 §5.1) — o módulo isola a superfície pública para que a troca seja invisível aos consumidores.

## Onde mora o código

- **Módulo crp-validation** (`src/modules/crp-validation/`):
  - `src/modules/crp-validation/index.ts` — barrel público (validators puros + Server Actions).
  - `src/modules/crp-validation/lib/crp-format.ts` — `crpNumberSchema` (regex + refine no código regional) e `crpUfSchema` (Zod enum dos 27 UFs). Mensagens de erro em pt-BR voltadas ao usuário.
  - `src/modules/crp-validation/lib/regional-codes.ts` — `regionalCodes` (`01..24 → UF`, `as const`), `regionalCodeToUf(code)` e `BRAZILIAN_UFS` (tupla literal das 27 UFs).
  - `src/modules/crp-validation/server/approve.ts` — `approveCrpValidationImpl(args)`: gate por service-role, marca a fila como `approved`, dispara `applyTransition(..., 'crp_approved')` reusando a tx, audita.
  - `src/modules/crp-validation/server/reject.ts` — `rejectCrpValidationImpl(args)`: gate por service-role, exige `reason` não-vazio, marca a fila como `rejected` com `rejection_reason`, dispara `applyTransition(..., 'crp_rejected')`.
- **Schema e migration**:
  - `src/shared/db/schema/auth/crp-validation-queue.ts` — tabela `crp_validation_queue` (`id`, `user_id`, `crp_number`, `crp_uf`, `status` CHECK em `pending|approved|rejected`, `submitted_at`, `decided_at`, `decided_by`, `rejection_reason`).
  - `src/shared/db/schema/auth/policies.ts` — política única `service role manages queue` (FOR ALL TO `service_role`).
  - `src/shared/db/migrations/0001_left_phalanx.sql` — cria a tabela, FKs para `auth.users`, índice `(status, submitted_at)`, RLS habilitada com policy só para `service_role`.
- **Consumidores diretos**:
  - `src/modules/auth/lib/signup-input-schema.ts` importa `crpNumberSchema` e `crpUfSchema` de `@/modules/crp-validation/lib/crp-format` (caminho interno deliberado — evita arrastar `'server-only'` do barrel para o bundle do form).
  - `src/modules/auth/server/signup.ts` insere uma row `pending` na fila para cada novo psicólogo.

## Superfície pública

- **Validators puros** (importáveis de `@/modules/crp-validation`):
  - `crpNumberSchema: ZodString` — valida `^\d{2}/\d{4,7}$` e refina o prefixo contra `regionalCodes`.
  - `crpUfSchema: ZodEnum<typeof BRAZILIAN_UFS>` — UF brasileira em maiúsculas.
  - `regionalCodes` (constante `as const`), `regionalCodeToUf(code: string): Uf | null`, `BRAZILIAN_UFS` (tupla literal).
- **Tipos**: `CrpNumber`, `CrpUf`, `RegionalCode`, `Uf`, `ApproveCrpValidationArgs`, `ApproveResult`, `RejectCrpValidationArgs`, `RejectResult`.
- **Server Actions** (importáveis de `@/modules/crp-validation` em chamadores server-side; via route shell em Client Components — quando a UI admin existir):
  - `approveCrpValidation({ queueId, actorUserId, isServiceRole })` → `ApproveResult` (`ok` | `forbidden` | `queue_not_found` | `already_decided` | `invalid_transition` | `profile_not_found` | `unknown`).
  - `rejectCrpValidation({ queueId, actorUserId, reason, isServiceRole })` → `RejectResult` (variantes acima + `reason_required`).
- **DB**:
  - Tabela `crp_validation_queue` com índice `(status, submitted_at)` (otimiza varredura "pendentes mais antigos").
  - UNIQUE `(crp_number, crp_uf)` em `psychologist_profiles` (RN-01.02 — não vive nesta tabela porque a fila aceita re-submissões após rejeição).

## Comportamento e invariantes

- **Formato sincronicamente validado em todo entry-point** (signup form, profile update, admin queue): `crpNumberSchema` rejeita up-front qualquer `XX/NNNNNN` malformado (delimitador errado, comprimento da inscrição fora de `4..7`, espaços) e qualquer prefixo regional fora de `01..24`. As mensagens são humanas (`"CRP inválido. Use o formato XX/NNNNNN (ex.: 06/123456)."`), não técnicas.

- **`regionalCodes` é a única fonte de verdade do mapeamento código → UF** (PRD-01 Apêndice A: `01→DF, 02→RJ, ..., 24→RO`, total de 24 entradas). Duplicar o mapping em outro arquivo é proibido pela spec. RR, AP e TO existem em `BRAZILIAN_UFS` mas NÃO têm código regional próprio — psicólogos desses estados se inscrevem em CRPs vizinhos.

- **`crpUfSchema` é case-sensitive**: input minúsculo é rejeitado pelo enum. O formulário Client Component é responsável por upper-case antes do submit (cenário "Lower-case UF is rejected" da spec).

- **`(crp_number, crp_uf)` é UNIQUE em `psychologist_profiles`** (RN-01.02 — uma inscrição CRP só pode pertencer a um psicólogo na plataforma). A constraint vive no banco para sobreviver a qualquer caminho que tente burlar o pre-flight check do signup. A fila de validação NÃO carrega essa constraint — ela aceita múltiplas linhas para o mesmo `(crp_number, crp_uf)` se a primeira foi rejeitada e o usuário se reinscrever (após reonboarding completo).

- **RLS service-role-only na fila**: `crp_validation_queue` tem `ENABLE ROW LEVEL SECURITY` e UMA política — `FOR ALL TO service_role`. Nenhuma policy para `authenticated`: psicólogos NUNCA leem ou escrevem esta tabela (nem mesmo a própria linha — eles veem a página bloqueante `crp-review`, não a fila). `service_role` já bypassa RLS no nível do role; a política explícita é só para deixar o modelo de acesso visível ao reviewer e satisfazer o `policy-coverage.int.test.ts`.

- **RN-01.05 — sem coluna de foto da carteira**: o módulo NUNCA armazena imagens da carteirinha do CRP. Auditoria é text-only (`crp_number`, `crp_uf`, `rejection_reason`, `decided_by`, `decided_at`). Adicionar uma coluna `photo_url` ou similar é regressão: viola a regra de minimização LGPD e introduziria um vetor de armazenamento de PII visual sem necessidade operacional.

- **Approve/reject são gated por service-role**: o argumento `isServiceRole: boolean` é obrigatório e seu valor `false` retorna imediatamente `{ ok: false, error: 'forbidden' }` com log `crp_validation_decided` (`decision: 'forbidden'`). O route shell admin é responsável por setar esse flag apenas quando o JWT do caller carrega de fato o role — nunca confiar em input do cliente.

- **Reject exige reason não-vazio**: `rejectCrpValidation` faz `.trim()` no `reason` e retorna `{ ok: false, error: 'reason_required' }` se a string ficar vazia. O valor trimado é o que persiste em `rejection_reason` — nada de whitespace acidental no audit trail. O log NÃO inclui o reason em si (admins podem escrever texto livre que poderia carregar contexto pessoal sobre o psicólogo); apenas a decisão e os identificadores.

- **Concurrency / rollback**: ambos approve e reject rodam dentro de `db.transaction(...)` e passam a tx para `applyTransition`. Race entre dois admins clicando aprovar simultaneamente é resolvida pelo row lock — o segundo vê `status !== 'pending'` e devolve `already_decided`. Falha em `applyTransition` (`invalid_transition` / `profile_not_found`) faz throw de uma `TransitionRollback` interna, que rola back o UPDATE da fila e mapeia para o erro tipado equivalente.

- **Mapeamento approve/reject → state machine**:
  - `crp_approved` em `pending_crp_validation` → `active`.
  - `crp_rejected` em `pending_crp_validation` → `suspended`. (Não `cancelled` — a rejeição inicial é reversível em tese pelo admin, ainda que o caminho ainda não exista; `cancelled` é terminal.)

- **Caminho de upgrade**: lookup automatizado contra a base do CFP será adicionado dentro deste módulo, atrás da MESMA superfície pública. A intenção é manter o barrel inalterado e introduzir o caller automatizado em `server/auto-validate.ts` (ou similar), que pode tanto chamar `approveCrpValidationImpl` diretamente quanto criar uma trilha alternativa que não requer service-role do operador. Consumidores (signup, route shells admin, testes) não devem precisar mudar.

## Testes

- **Unit** (`src/__tests__/unit/modules/crp-validation/`):
  - `lib/regional-codes.test.ts` — cobre os 24 códigos do mapping verbatim, retorno `null` para códigos desconhecidos, `BRAZILIAN_UFS` com 27 entradas.
  - `lib/crp-format.test.ts` — happy path (`06/123456`), rejeições (delimitador errado, comprimento fora, espaços, código regional inexistente), `crpUfSchema` aceitando todos os 27 UFs em maiúsculas e rejeitando minúsculas.
- **Integration** (`src/__tests__/integration/`):
  - `modules/auth/server/signup.int.test.ts` — exercita inserção da row `pending` na fila durante signup; cobre o pre-flight de unicidade `(crp_number, crp_uf)` e a corrida que cai na UNIQUE do banco.
  - (Approve/reject integration tests cobertos junto com o fluxo de `applyTransition` em `modules/account-lifecycle/server/transition.int.test.ts` — exercita as transições `crp_approved` e `crp_rejected` com a tx externa do approve/reject.)

## Histórico de changes

- 2026-05-03 add-account-signup-and-lifecycle — capability criada: validação síncrona de `crpNumber`/`crpUf` (regex + 24 códigos regionais), tabela `crp_validation_queue` service-role-only, `approveCrpValidation` e `rejectCrpValidation` com gate de service-role e auditoria, RN-01.05 enforced (sem foto). Lookup CFP automatizado deferido. Veja [`../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/`](../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/).
