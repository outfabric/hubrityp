## Context

O sistema HubrityP já possui autenticação completa (PRD 01), com profiles de psicólogos, middleware de gating, e estrutura modular (`src/modules/`). O domínio de pacientes é o primeiro módulo de negócio — tudo que não é auth/onboarding. Precisamos seguir os padrões estabelecidos: Drizzle schema por domínio, RLS owner-scoped, Server Actions com `'use server'` nos route shells, barrel exports via `index.ts`.

O módulo de pacientes será o mais utilizado do sistema — quase todas as features futuras (agenda, prontuário, cobrança, telepsicologia) dependem dele. Performance da listagem e robustez do schema são críticas.

## Goals / Non-Goals

**Goals:**
- CRUD completo de pacientes com validação rigorosa (telefone BR, CPF, email)
- Listagem performante com busca full-text, filtros, paginação server-side
- Schema extensível para changes futuras (guardians, anamnesis, consent)
- Segurança: RLS, foto em bucket privado, CPF mascarado no frontend
- UX: formulário em 2 etapas, criação em menos de 1 minuto

**Non-Goals:**
- Responsáveis legais (change `patient-guardians-and-couples`)
- Vinculação de casais (change `patient-guardians-and-couples`)
- Anamnese (change `patient-anamnesis`)
- Termo de consentimento (change `patient-consent-term`)
- Exportação PDF e importação CSV (change `patient-export-and-import`)
- Audit log de leitura de prontuário (PRD 11 — change futura)
- Campos "Última sessão", "Próxima sessão", "Saldo financeiro" na listagem (dependem de PRDs 03/06 — serão adicionados quando esses módulos existirem)

## Decisions

### 1. Drizzle schema em `src/shared/db/schema/patients/`

Seguindo o padrão de `schema/auth/` e `schema/health/`, o domínio patients terá:
- `tables.ts` — tabela `patients` com todas as colunas
- `policies.ts` — RLS policies owner-scoped (SELECT, INSERT, UPDATE, DELETE via `auth.uid() = user_id`)

O barrel `schema/index.ts` será atualizado para reexportar `./patients/tables`.

**Alternativa considerada:** Colocar tudo em um arquivo só — rejeitada por inconsistência com o padrão existente e dificuldade de manutenção ao adicionar tabelas futuras (guardians, anamnesis, consent_terms).

### 2. Server Actions no módulo `src/modules/patients/`

Estrutura:
```
src/modules/patients/
  server/
    create-patient.ts      # createPatientImpl
    list-patients.ts       # listPatientsImpl
    get-patient.ts         # getPatientImpl
    update-patient.ts      # updatePatientImpl
    archive-patient.ts     # archivePatientImpl (archive + unarchive)
    delete-patient.ts      # deletePatientImpl (hard delete)
    upload-patient-photo.ts # uploadPatientPhotoImpl
  lib/
    patient-input-schema.ts  # Zod schemas para create e update
    patient-validators.ts    # validação de telefone BR, CPF
    patient-types.ts         # tipos TypeScript do domínio
  components/
    patient-list.tsx          # listagem (client component com filtros/paginação)
    patient-form.tsx          # formulário de criação/edição (client component)
    patient-detail-header.tsx # cabeçalho da página de detalhes
    patient-tabs.tsx          # layout de tabs
    patient-overview-tab.tsx  # conteúdo da tab "Visão geral"
    archive-confirm-modal.tsx # modal de confirmação de arquivamento
    delete-confirm-modal.tsx  # modal de confirmação de exclusão
  index.ts                    # barrel (sem 'use server')
```

Route shells em `src/app/(app)/pacientes/`:
```
src/app/(app)/pacientes/
  page.tsx          # RSC → lista de pacientes
  actions.ts        # 'use server' — delega para módulo
  novo/page.tsx     # RSC → formulário de criação
  [id]/page.tsx     # RSC → detalhe do paciente
  [id]/editar/page.tsx # RSC → formulário de edição
```

**Alternativa considerada:** API Routes em vez de Server Actions — rejeitada porque o padrão do projeto é Server Actions, e não há necessidade de endpoints REST neste momento.

### 3. Busca full-text com `tsvector` + `unaccent`

A busca por nome usará um índice GIN com `to_tsvector('portuguese', full_name)` para suportar busca eficiente. Para busca parcial (prefix match), usaremos `ILIKE` com `unaccent()` como fallback, já que `to_tsvector` não lida bem com prefixos.

Na prática, a query de listagem combinará:
- `unaccent(lower(full_name)) LIKE unaccent(lower('%term%'))` para nome
- `phone LIKE '%term%'` para telefone
- `email ILIKE '%term%'` para email

O índice GIN ficará disponível para queries mais sofisticadas no futuro (busca por tokens completos).

**Alternativa considerada:** Supabase full-text search API — rejeitada porque precisamos de controle fino sobre `unaccent` e prefix matching, e a query via Drizzle nos dá isso.

### 4. Paginação server-side com URL params

Os filtros e paginação serão persistidos como query params da URL (`?page=1&status=active&search=maria&tags=TCC,infantil&sort=full_name&order=asc`). Isso permite:
- Compartilhar/salvar URLs filtradas
- Back/forward do browser funcionam naturalmente
- Server Component pode ler os params diretamente

O componente de listagem será Client Component para gerenciar estado local de input de busca (debounce antes de atualizar URL).

### 5. Foto do paciente via Supabase Storage

Bucket privado `patient-photos`, path: `{user_id}/{patient_id}.{ext}`.

Upload flow:
1. Client faz upload via `supabase.storage.from('patient-photos').upload()`
2. Server Action recebe o path e valida ownership
3. Para exibir, Server Action gera signed URL com 5min de expiração

**Alternativa considerada:** Upload via Server Action (base64) — rejeitada por limitação de payload size em Server Actions e overhead desnecessário de encoding.

### 6. Tags como array TEXT[] no Postgres

Tags serão armazenadas como `TEXT[]` na coluna `tags` da tabela `patients`. O psicólogo pode criar tags livremente (não há tabela de tags separada no MVP). Filtragem por tags usa o operador `@>` (contains) do Postgres.

**Alternativa considerada:** Tabela normalizada `patient_tags` — rejeitada por over-engineering no MVP. Se necessário (autocomplete global, contagem de uso), pode ser adicionada em change futura sem breaking change.

### 7. Unique constraints com filtro NULL para email

A constraint `UNIQUE (user_id, phone)` é direta. Para email (que é opcional/nullable), usaremos um partial unique index: `CREATE UNIQUE INDEX ... ON patients(user_id, email) WHERE email IS NOT NULL`. Isso permite múltiplos pacientes sem email para o mesmo psicólogo.

### 8. Migration strategy

Uma única migration SQL que:
1. Cria tabela `patients` com todas as colunas
2. Habilita RLS e cria 4 policies owner-scoped
3. Cria índices (compound em user_id+status, GIN em full_name, partial unique em email)
4. Cria a extension `unaccent` se não existir

A migration é idempotente no que tange à extension. As policies seguem o template documentado em `migrations/README.md`.

## Risks / Trade-offs

- **[Performance do ILIKE com unaccent]** → Para <200 pacientes por psicólogo, ILIKE é suficiente. Se escalar, podemos adicionar índice trigram (`pg_trgm`). Não otimizar prematuramente.
- **[Tags sem normalização]** → Risco de inconsistência (e.g., "TCC" vs "tcc" vs "Tcc"). Mitigation: normalizar para lowercase no validator antes de salvar. Autocomplete no frontend baseado em tags já existentes do mesmo psicólogo (query `SELECT DISTINCT unnest(tags)`).
- **[Foto upload direto do client]** → Requer policy de Storage configurada corretamente. Mitigation: testar com RLS policies de Storage que limitam upload a `{user_id}/` prefix.
- **[CPF armazenado em texto]** → O PRD menciona criptografia em coluna para CPF. No MVP, armazenaremos como texto com mascaramento no frontend. Criptografia em coluna (pgcrypto) pode ser adicionada em change futura sem breaking change no schema externo.

## Migration Plan

1. Criar migration via `npm run db:generate` após escrever o schema Drizzle
2. Editar migration gerada para adicionar RLS policies, extension `unaccent`, e partial unique index
3. Testar com `npm run db:migrate` em ambiente local (docker compose)
4. Criar bucket `patient-photos` no Supabase Storage com policy de acesso

**Rollback:** Dropar tabela `patients` e bucket. Nenhum dado de produção existe ainda (feature nova).

## Frontend — Design System Sálvia (`docs/design-system/rules.md`)

Todas as telas desta change DEVEM seguir o design system Sálvia. Referência completa em `docs/design-system/rules.md`. Destaques para esta change:

### Componentes shadcn/ui obrigatórios
- **Listagem:** `Table` (header bg `surface-muted`, hover bg `surface-muted`, mobile → cards stackados), `Badge` (status ativo/arquivado com variante `success`/`neutral`), `Avatar` (fallback iniciais sobre `brand-100`/`brand-700`)
- **Formulário:** `Input` com validação em **blur** (não onChange), erro inline com ícone `AlertCircle` + texto `danger-700`. Máscaras BR obrigatórias: telefone `+55 (DD) NNNNN-NNNN`, CPF `XXX.XXX.XXX-XX`
- **Criação em 2 etapas:** Usar **página dedicada** (não modal — wizard multi-passo não usa modal pelo design system)
- **Botões:** `primary` (brand-500) apenas no CTA principal ("Salvar", "+ Novo Paciente"), `secondary` para ações menores, `ghost` em toolbars, `danger` para exclusão. Loading state obrigatório em ações assíncronas >300ms. Labels começam com verbo infinitivo
- **Modal de confirmação:** Para archive/delete. Exclusão hard exige input "EXCLUIR DEFINITIVAMENTE". Max-width 480px
- **Tabs:** Underline style (tab ativa: text `primary`, border-bottom 2px `brand-500`)
- **Toast (Sonner):** Success/error com border-left 4px semântico, auto-dismiss 4s, posição topo-direito

### Ícones Lucide — mapa fixo
- Pacientes: `Users` / `User`
- Buscar: `Search`
- Filtrar: `SlidersHorizontal`
- Adicionar: `Plus`
- Editar: `Pencil`
- Excluir: `Trash2`
- Mais opções: `MoreHorizontal`
- WhatsApp: `MessageCircle`
- Download: `Download`
- Upload: `Upload`
- Voltar: `ArrowLeft`

### Tipografia e cor
- Título da página: h1 (28px/600)
- Título de card/seção: h3 (18px/600)
- Texto padrão: body (15px/400)
- Labels/badges: caption (12px/500)
- Brand (verde-sálvia) APENAS em: botão primário, item ativo sidebar, avatar fallback, anel de foco. Nunca em headers, cards, tabelas
- Status badges: `success-50` bg + `success-700` text (Ativo), `neutral` (Arquivado)

### UX patterns obrigatórios
- **Empty state:** ícone Lucide tertiary + h4 headline + descrição secondary + 1 CTA primário
- **Dirty state:** modal "Alterações não salvas" ao sair do form com mudanças
- **Optimistic update:** atualizar UI imediatamente, reverter se backend falhar
- **Mobile-first:** tabela → cards, modal → sheet bottom-up, form multi-coluna → coluna única
- **Acessibilidade WCAG 2.1 AA:** contraste 4.5:1, foco visível, navegação por teclado, `aria-label` em ícones standalone, labels associados a inputs

### Microcopy — glossário
- "Paciente" (não cliente)
- "Sessão" (não consulta)
- "Salvar" (não "Confirmar e prosseguir")
- Erros humanos: "Telefone inválido. Use o formato (11) 98765-4321." (não "ValidationError")

## Open Questions

- **Saldo financeiro na listagem:** O PRD pede exibir saldo na listagem, mas depende de PRD 06 (Cobrança). Decisão: não incluir nesta change — a coluna será adicionada quando o módulo financeiro existir.
- **"Tem sessão esta semana" como filtro:** Depende de PRD 03 (Agenda). Mesmo tratamento — filtro será adicionado na change do módulo de agenda.
- **Extensão `unaccent`:** Verificar se já está disponível no Supabase hosted ou se precisa ser habilitada via dashboard.
