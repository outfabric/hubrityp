## Why

PRD 10 RF-10.22 e RF-10.23 são a última peça que falta: o psicólogo precisa conseguir (a) **ligar/desligar** a feature como um todo, (b) escolher o **template padrão** das notas, (c) ajustar **sensibilidade de detecção de risco**, (d) escolher se quer **reter áudio** além das 24h padrão, (e) escolher se quer **reter transcrição textual** (default não), (f) ver **estatísticas de uso** (RF-10.23: sessões processadas, tempo economizado estimado, taxa de aceitação). Sem essas configurações, a `ai_transcription_settings` (criada em foundation) fica como linha-fantasma: ninguém a popula, nada honra suas colunas, e o pipeline opera com defaults para todo mundo. Esta change conecta os endpoints existentes ao que o psicólogo de fato controla, e fecha o ciclo do PRD 10.

## What Changes

- **Nova rota** `/configuracoes/transcricao-ia` (já gated por `/configuracoes*` no middleware atual).
  - Página Server Component: fetch via Drizzle das settings (upsert default se nunca criada).
  - `<TranscriptionSettingsForm>` Client Component com os controles abaixo.
  - `<TranscriptionStatsPanel>` mostrando as estatísticas calculadas server-side.

- **Card de entrada** em `/configuracoes` (`settings-areas.ts`): adiciona uma entrada para "Transcrição IA" com ícone `Sparkles` e descrição em pt-BR — segue o padrão existente.

- **Controles do form** (RF-10.22):
  - `Switch` "Ativar Transcrição IA" → `enabled` (boolean).
  - `Select` "Template padrão" → `defaultTemplate` (`tcc | psicanalise | sistemica | aba | livre`).
  - `RadioGroup` "Sensibilidade de detecção de risco" → `riskDetectionSensitivity` (`low | medium | high`) com explicações dos três níveis.
  - `Select` "Manter áudio por" → `keepAudioHours` (`24 | 48 | 72 | 168` em horas; default 24). Texto explicativo: "Configurações acima de 24h exigem registro adicional para auditoria — recomendamos manter o padrão 24h."
  - `Switch` "Manter transcrição textual" → `keepTranscription` (boolean; default false). Texto explicativo: "Em geral, a nota é o suficiente. Mantenha a transcrição textual apenas se houver razão clínica/auditoria documentada."

- **Server Action** `updateTranscriptionSettings(input)` em `src/modules/ai-transcription/server/`:
  - getUser → Zod parse → UPSERT em `ai_transcription_settings`.
  - Quando `enabled` muda de `false` para `true`, registra audit log entry; idem para `keepAudioHours > 24` (mudança que aumenta retenção é evento auditável).

- **Server Action** `getTranscriptionStats()` em `src/modules/ai-transcription/server/`:
  - Calcula (todas RLS-scoped):
    - **Sessões processadas no mês**: COUNT WHERE `status IN ('ready','reviewed')` AND `created_at >= date_trunc('month', now())`.
    - **Sessões processadas total**: COUNT WHERE `status IN ('ready','reviewed')`.
    - **Tempo médio economizado**: count × 8 min (constante do PRD §1, RF-10.23).
    - **Taxa de aceitação**: `count(saved_to_prontuario=true AND user_edits_count=0) / count(reviewed)` — "salvou sem editar muito".
    - **Custo médio por sessão** (opcional, derivado das colunas `*_cost_usd`).
  - Retorna shape estável.

- **Painel de estatísticas** `<TranscriptionStatsPanel>`:
  - Cards Sálvia (4-6 cartões pequenos) com `caption-upper` label e número grande.
  - Sem gráfico complexo no MVP (PRD não pede); um pequeno barchart `Recharts` "Sessões processadas — últimos 6 meses" como opcional/stretch.

- **Empty state** quando ainda não há transcrições: card único informativo + CTA "Como começar" linkando para a doc/runbook ou primeiro paciente.

- **Validação de mudança crítica**:
  - Desligar a feature (enabled `true → false`): mostra `AlertDialog` explicando "Novas sessões não serão processadas; transcrições em andamento concluirão normalmente". Audit log entry.

## Capabilities

### New Capabilities

- `ai-transcription-settings-ui`: rota `/configuracoes/transcricao-ia`, Server Actions `updateTranscriptionSettings` / `getTranscriptionStats` / `getTranscriptionSettings`, formulário com Switch/Select/RadioGroup conforme RF-10.22, painel de estatísticas conforme RF-10.23, entrada em `settings-areas.ts`, audit logs para mudanças sensíveis.

### Modified Capabilities

- `settings-shell`: o índice em `/configuracoes` ganha uma nova entrada "Transcrição IA". A capability incorpora o requisito "settings index lista a área Transcrição IA com ícone Sparkles". Sem alteração estrutural do layout.

## Impact

- **Código** (novos arquivos):
  - `src/app/(app)/configuracoes/transcricao-ia/page.tsx` (Server Component).
  - `src/app/(app)/configuracoes/transcricao-ia/_components/transcription-settings-form.tsx` (Client).
  - `src/app/(app)/configuracoes/transcricao-ia/_components/transcription-stats-panel.tsx` (Server).
  - `src/modules/ai-transcription/server/get-transcription-settings.ts`
  - `src/modules/ai-transcription/server/update-transcription-settings.ts`
  - `src/modules/ai-transcription/server/get-transcription-stats.ts`
  - `src/modules/ai-transcription/lib/settings-schemas.ts` (Zod input + output).
  - `src/modules/ai-transcription/lib/stats-schemas.ts` (Zod output).
- **Código** (edits):
  - `src/app/(app)/configuracoes/settings-areas.ts` — nova entrada.
  - `src/app/(app)/configuracoes/breadcrumb-labels.ts` — label "Transcrição IA".
- **Banco**: nenhuma migração (tabela `ai_transcription_settings` já existe desde foundation).
- **Rotas**: 1 nova, gated por `/configuracoes*` (já classificado pelo middleware existente). Confirmar via integration test.
- **Realtime**: nenhum requisito Realtime nesta change.
- **Segurança**: cada Server Action: getUser + Zod + ownership pelo `auth.uid()`. Audit log em mudanças sensíveis (enable/disable, aumento de retenção).
- **LGPD**: settings têm impacto direto em retenção. `keepAudioHours > 24` requer aceitação do termo de IA já contemplar a possibilidade (template V1 menciona "24h por padrão"); se uma versão futura permitir retenção mais longa por consentimento extra, ajustar template. **Tarefa de PR**: confirmar com legal antes de habilitar valores > 24h.
