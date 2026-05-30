## Context

Esta é a change menos arriscada do conjunto: UI + 3 Server Actions para popular uma tabela que já existe. O ciclo do PRD 10 fecha aqui — sem este painel, configurações por psicólogo ficam invisíveis. O design segue o padrão estabelecido por outras áreas de `/configuracoes`: o índice tem cards interativos (`settings-areas.ts`), as subpáginas são formulários simples com auto-save ou save explícito + toast.

A única decisão substantiva é a UX da retenção de áudio (`keepAudioHours`): o PRD permite valores > 24h, mas o termo V1 só fala em 24h. Vamos limitar UI a 24h no MVP e deixar valores maiores fora; quando legal/PRD evoluir, libera-se.

## Goals / Non-Goals

**Goals:**

- Form intuitivo, sem ambiguidade. Cada controle tem helper text explicando o efeito.
- Estatísticas claras, baseadas em queries simples (sem analytics warehouse).
- Audit log em mudanças sensíveis.
- Cobre RF-10.22 e RF-10.23 sem inflar escopo.

**Non-Goals:**

- Gráficos elaborados. Cards com números e (stretch) um barchart simples.
- Exportar histórico de transcrições como CSV (futuro).
- Permitir customização de prompts pelo psicólogo (templates são fixos no MVP — RF-10.22 sugere o oposto).

## Decisions

### D1. Save explícito (botão), não auto-save

**Decisão:** form com `Button` "Salvar configurações" no final; toast on success/error. Não auto-save (pequeno; ato deliberado).

**Por quê:** mudanças têm impacto operacional (retenção, sensibilidade); o psicólogo deve confirmar.

### D2. UI limita `keepAudioHours` a `24` no MVP

**Decisão:** apenas a opção `24` é apresentada como `Select` com um único valor visível. Tecnicamente a coluna aceita até 168 (foundation), mas a UI só permite 24 até decisão legal posterior. Comentário no código explica.

**Por quê:** desencoraja decisão isolada do psicólogo de aumentar retenção; quando habilitarmos, ajustamos o template V2 + UI conjuntamente.

**Alternativa:** liberar 48/72/168 já. Rejeitada para MVP (princípio: mínima superfície LGPD).

### D3. Sensibilidade de risco com explicações inline

**Decisão:** `RadioGroup` em vez de `Select` para deixar as três opções visíveis com helper text de cada:
- Baixa — "Sinaliza apenas menções diretas e literais."
- Média (padrão) — "Sinaliza menções diretas e fortes hipóteses."
- Alta — "Sinaliza qualquer indício, mesmo tênue."

### D4. Stats Panel é Server Component (não Client)

**Decisão:** o painel é renderizado pelo server (faz Drizzle direto, sem hidratação). Refresh por revalidação da página, não por websocket.

**Por quê:** stats não são tempo real. Simplicidade > sofisticação.

### D5. Card de stats segue Sálvia

**Decisão:** 4 cards pequenos em grid responsivo (1 col mobile / 2 cols tablet / 4 cols desktop). Cada card: `caption-upper` label + número grande em `h2`. Sem ícones decorativos (Sálvia §"Funcional antes de decorativo").

### D6. Audit log em mudanças sensíveis

**Decisão:** usar o helper de audit existente (a partir do spec `audit-log`). Eventos:
- `ai_transcription_enabled` quando vai false→true.
- `ai_transcription_disabled` quando vai true→false.
- `ai_transcription_retention_changed` quando `keepAudioHours` muda.
- `ai_transcription_keep_transcription_toggled` quando `keepTranscription` muda.

Payload: `{ userId, oldValue, newValue }`. NO PII.

### D7. Empty state quando count = 0

**Decisão:** o painel verifica `totalProcessed === 0` e renderiza, em vez dos cards numéricos, um único card explicativo "Nenhuma transcrição processada ainda" + link para a doc.

## Risks / Trade-offs

- [Risco] **Psicólogo desliga a feature enquanto há transcrições em curso** → Mitigação: AlertDialog informa "transcrições em andamento concluirão normalmente". Pipeline atual checa `enabled` apenas ao receber áudio (na Server Action de upload); não cancelamos jobs já enfileirados. Documentar.
- [Risco] **Cálculo de "taxa de aceitação" enganoso quando count é pequeno** → Mitigação: exibir "Dados insuficientes" quando `reviewed < 5`. Eviita números percentuais ruidosos.
- [Risco] **Mudança de `defaultTemplate` afeta TRANSCRIÇÕES FUTURAS, não as passadas** → Mitigação: o helper de pipeline já lê `defaultTemplate` no momento do start; documentar via helper text "Aplica-se apenas a novas transcrições."
- [Trade-off] **Stats simples sem analytics warehouse** → aceito MVP; ETL pode vir depois.

## Migration Plan

1. Implementar as 3 Server Actions.
2. Implementar componentes.
3. Atualizar `settings-areas.ts`.
4. Atualizar `breadcrumb-labels.ts`.
5. Testes.

**Rollback:** trivial — código puro, sem migração.

## Open Questions

- **Q1.** A página deveria oferecer um botão para "Re-processar todas as falhas"? Decisão MVP: não — a página de revisão (`/dashboard/transcricoes`) já tem retry por item.
- **Q2.** Exportar histórico em CSV/PDF? Fora de escopo.
