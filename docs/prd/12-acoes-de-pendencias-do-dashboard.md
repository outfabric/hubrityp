# PRD 12 — Ações de Pendências do Dashboard (deep-links que resolvem)

> **Pré-requisitos:** PRD 00 (visão geral), PRD 02 (gestão de pacientes), PRD 03 (agenda), PRD 05 (prontuário) e PRD 11 (onboarding e dashboard — define a seção "Pendências").
>
> **Escopo de versão:** este PRD cobre exclusivamente o MVP. Trata das **três pendências hoje exibidas no dashboard** (sessões sem evolução, pacientes sem consentimento, notas de IA para revisão). Pendências pós-MVP (Receita Saúde, cobranças PIX, WhatsApp) estão fora de escopo e **não devem** ser introduzidas aqui.
>
> **Natureza deste PRD:** é um PRD de **correção de comportamento**. A seção "Pendências" do dashboard já existe e calcula corretamente as contagens (ver PRD 11, RF-11.06 / Seção 2). O que está quebrado é o passo seguinte — o clique em **"Ver"**. Este documento especifica o contrato de navegação e os destinos filtrados que faltam.

---

## 1. Contexto e problema

A seção **"Pendências"** do dashboard (PRD 11) é a principal alavanca operacional diária do psicólogo: ela mostra, em contagens, o que precisa de atenção e oferece um link **"Ver"** para resolver cada item. Hoje a contagem está correta, mas **o clique não cumpre a promessa**: a página de destino abre sem aplicar nenhum filtro (ou abre a página errada). O psicólogo cai numa visão completa e tem que caçar manualmente o item que clicou.

### 1.1. Diagnóstico do estado atual (verificado no código)

A origem dos links está em `src/modules/dashboard/server/get-pendencias.ts` como constantes estáticas:

```ts
const OVERDUE_EVOLUTIONS_HREF      = '/agenda?filtro=sem-evolucao';
const PATIENTS_MISSING_CONSENT_HREF = '/pacientes?filtro=sem-consentimento';
const AI_NOTES_AWAITING_REVIEW_HREF = '/configuracoes/ia/transcricoes?status=ready';
```

Nenhum dos três destinos honra o parâmetro:

| Link "Ver" | Destino atual | Lê o parâmetro? | Resultado para o usuário |
|---|---|---|---|
| `/agenda?filtro=sem-evolucao` | `src/app/(app)/agenda/page.tsx` | **Não** — a página não recebe `searchParams`; sempre carrega a **semana corrente** no calendário | Abre o calendário da semana atual, sem destaque; sessões `done` de semanas anteriores (a regra é "+7 dias") **nem aparecem** na viewport |
| `/pacientes?filtro=sem-consentimento` | `src/app/(app)/pacientes/page.tsx` | **Parcial** — lê `searchParams`, mas só entende `page`, `search`, `status`, `tags`, `sort`, `order`. **Ignora `filtro`** | Abre a lista completa de pacientes, sem filtro |
| `/configuracoes/ia/transcricoes?status=ready` | **rota inexistente** — a tela de config é `configuracoes/transcricao-ia` e a lista real é `dashboard/transcricoes` | **Não** | Link quebrado/destino errado; mesmo o destino correto (`/dashboard/transcricoes`) não lê parâmetro e abre na aba padrão |

### 1.2. Por que isso importa (hipótese e métrica)

A seção Pendências existe para fechar o ciclo **ver → clicar → resolver**. Hoje ela quebra no passo do meio, o que tem dois custos:

- **Task success / time-to-value:** o caminho mais curto até a ação (registrar evolução, enviar termo, revisar nota) está cortado. O psicólogo desiste ou resolve por fora do fluxo guiado.
- **Confiança no produto:** para um usuário não-técnico, "o link não faz o que diz" lê como "o sistema está errado" ou "essa contagem não é confiável" — corrói a credibilidade do dashboard inteiro, justamente a tela aberta todo dia.

**Hipótese:** ao fazer cada "Ver" levar a uma visão **já filtrada** com CTA de resolução, aumentamos a taxa de resolução de pendências a partir do dashboard e reduzimos o tempo entre "ver a pendência" e "resolver a pendência".

**Métrica-alvo:** taxa de clique→resolução por tipo de pendência (sessão evoluída, termo enviado, nota revisada) dentro da mesma sessão de uso. **Guardrails:** não aumentar a taxa de saída (bounce) na página de destino; não introduzir vazamento de PII além do escopo do dono.

## 2. Objetivo da feature

Garantir que cada item da seção **Pendências** do dashboard leve o psicólogo a uma **visão de destino já filtrada exatamente pela mesma regra de negócio que gerou a contagem**, com indicação visível do filtro ativo e um CTA claro para resolver — fechando o ciclo ver → clicar → resolver para as três pendências do MVP.

## 3. Escopo

### Dentro do escopo (MVP)

- Definição de um **contrato de deep-link** padronizado entre o dashboard e os três destinos.
- Destino **"sessões sem evolução"**: uma **visão em lista filtrada** (decisão de produto — ver RN-12.01), não o calendário, acessível por `/agenda?filtro=sem-evolucao`.
- Destino **"pacientes sem consentimento"**: a lista de pacientes existente passa a entender `filtro=sem-consentimento`, com ações por linha para **copiar o link do termo** e **enviá-lo por WhatsApp (click-to-chat `wa.me`, pelo canal do próprio psicólogo)**.
- Destino **"notas de IA para revisar"**: corrigir o href para a rota real e fazê-la abrir já filtrada pelas notas prontas para revisão.
- Indicador visível e removível de filtro ativo em cada destino.
- Paridade de contagem entre dashboard e destino (mesma fonte de verdade).
- Estados vazios coerentes em cada destino quando não há (mais) itens.

### Fora do escopo (versões futuras)

- Redesenho do calendário da Agenda ou da listagem de pacientes além do necessário para o filtro.
- Novos tipos de pendência (Receita Saúde, cobranças, WhatsApp — pós-MVP).
- Mudança na **regra de negócio** das pendências (ex.: a janela de 7 dias para evolução em atraso permanece como está — ver PRD 11).
- Ações em lote (resolver várias pendências de uma vez) — pode ser avaliado em v2.
- Persistência/compartilhamento de filtros salvos.

## 4. User stories

- **Como psicóloga**, quando vejo "3 sessões sem evolução" no dashboard e clico em "Ver", quero cair direto numa lista só dessas 3 sessões, ordenadas da mais antiga, com um botão para registrar a evolução de cada uma — sem ter que procurar no calendário.
- **Como psicóloga**, quando clico em "pacientes sem consentimento", quero ver apenas esses pacientes, com atalhos para **copiar o link do termo** e para **enviá-lo pelo meu próprio WhatsApp** (mensagem já pronta), porque é assim que eu já mando esse tipo de coisa para os pacientes hoje.
- **Como psicóloga**, quando clico em "notas de IA para revisar", quero abrir a lista de transcrições já na aba das que aguardam minha revisão.
- **Como psicóloga**, quero perceber claramente que estou vendo uma lista filtrada e poder remover o filtro com um clique para voltar à visão completa.
- **Como psicóloga**, quando uma pendência já foi resolvida entre o carregamento do dashboard e o meu clique, quero ver uma confirmação de "tudo certo", não a lista completa sem explicação.

## 5. Requisitos funcionais

### 5.1. Contrato de deep-link (transversal)

**RF-12.01.** Os hrefs emitidos pelo dashboard (`get-pendencias.ts`) são a **fonte canônica** da rota de cada pendência. Cada destino DEVE interpretar o parâmetro correspondente. Contrato final:

| Pendência | Constante | Href canônico | Destino | Parâmetro interpretado |
|---|---|---|---|---|
| Sessões sem evolução | `OVERDUE_EVOLUTIONS_HREF` | `/agenda?filtro=sem-evolucao` | Agenda em **modo lista** | `filtro=sem-evolucao` |
| Pacientes sem consentimento | `PATIENTS_MISSING_CONSENT_HREF` | `/pacientes?filtro=sem-consentimento` | Lista de pacientes | `filtro=sem-consentimento` |
| Notas de IA para revisar | `AI_NOTES_AWAITING_REVIEW_HREF` | `/dashboard/transcricoes?status=ready` | Lista de transcrições | `status=ready` (abre aba "Pendentes") |

**RF-12.02.** A constante `AI_NOTES_AWAITING_REVIEW_HREF` DEVE ser corrigida de `/configuracoes/ia/transcricoes?status=ready` (rota inexistente) para `/dashboard/transcricoes?status=ready` (rota real da lista de transcrições).

**RF-12.03.** O valor do parâmetro de filtro é parte de uma **lista fechada (allowlist)** por destino. Valores fora da allowlist DEVEM ser ignorados com segurança (renderiza a visão padrão, sem erro), evitando filtros arbitrários injetados pela URL.

**RF-12.04.** A **regra de negócio** que define cada filtro no destino DEVE ser a mesma usada por `get-pendencias.ts` para a contagem (reaproveitar a query/predicado, não reimplementar). Definições de referência (já implementadas no cálculo da contagem):
- **Sessões sem evolução:** `sessions.status = 'done'` E `start_at < (agora − 7 dias)` E sem `evolutions` vinculada (anti-join por `session_id`) E `deleted_at IS NULL`, escopado por `user_id = auth.uid()`.
- **Pacientes sem consentimento:** `consent_signed_at IS NULL` E `archived_at IS NULL`, escopado por `user_id`.
- **Notas de IA para revisar:** `ai_transcriptions.status = 'ready'`, escopado por `user_id`.

### 5.2. Destino A — Sessões sem evolução (`/agenda?filtro=sem-evolucao`)

**RF-12.05.** Quando a Agenda for acessada com `filtro=sem-evolucao`, ela DEVE renderizar uma **visão em lista** (não o calendário semanal), contendo exclusivamente as sessões que atendem à regra de "evolução em atraso" (RF-12.04).

**RF-12.06.** A lista NÃO é limitada à semana corrente. Ela cobre todas as sessões elegíveis, independentemente da data (a regra já garante "+7 dias").

**RF-12.07.** Ordenação padrão: **da mais antiga para a mais recente** (a sessão há mais tempo sem evolução aparece primeiro — maior risco de descumprimento da obrigação CFP).

**RF-12.08.** Cada linha da lista exibe, no mínimo:
- Nome do paciente
- Data da sessão (e horário)
- Modalidade (presencial/online), se disponível
- Tempo decorrido sem evolução (ex.: "há 12 dias")
- CTA primário **"Registrar evolução"** que abre o prontuário/evolução daquela sessão (PRD 05)

```
Sessões sem evolução (3)            [Sem evolução · 3 ✕]
──────────────────────────────────────────────────────────
• Maria S.   — 22/05, 14h · Online      há 16 dias  [Registrar evolução]
• João P.    — 28/05, 09h · Presencial  há 10 dias  [Registrar evolução]
• Ana L.     — 30/05, 16h · Online      há  8 dias  [Registrar evolução]
```

**RF-12.09.** A visão exibe um **indicador de filtro ativo** (chip/badge) com a contagem e um controle para **remover o filtro** (✕). Ao remover, o usuário volta à visão padrão da Agenda (calendário), sem o parâmetro na URL.

**RF-12.10.** Ao registrar a evolução de uma sessão da lista, a sessão correspondente sai da lista (ou é marcada como resolvida) sem exigir recarregamento manual da página, e a contagem do indicador é decrementada.

### 5.3. Destino B — Pacientes sem consentimento (`/pacientes?filtro=sem-consentimento`)

**RF-12.11.** A página de pacientes (`/pacientes`) DEVE passar a interpretar `filtro=sem-consentimento`, aplicando o predicado de "paciente sem consentimento" (RF-12.04) sobre a listagem existente.

**RF-12.12.** O filtro `filtro=sem-consentimento` convive com os parâmetros já suportados (`search`, `status`, `tags`, `sort`, `order`, `page`). Quando presente, ele restringe o conjunto antes da paginação. (Implementação pode mapear para o mecanismo de filtro nativo da lista, desde que o resultado seja equivalente ao predicado de contagem.)

**RF-12.13.** A lista exibe um **indicador de filtro ativo** removível em 1 clique (mesmo padrão da RF-12.09). Remover o filtro retorna à listagem completa.

**RF-12.14.** Cada paciente na lista filtrada oferece ações para **compartilhar o termo de consentimento** (PRD 02), encurtando o caminho até a resolução. O compartilhamento no MVP é feito pelo **próprio WhatsApp/canais do psicólogo** (não há envio automatizado pela plataforma). As ações por linha são:

- **RF-12.14a — Copiar link do termo.** Botão que copia para a área de transferência a URL pública e token-gated do termo daquele paciente (`/termo/{token}`), com feedback visual de "copiado". Se ainda não houver termo pendente gerado para o paciente, a ação primeiro gera o termo (reaproveitando o Server Action existente de geração de consentimento) e então copia o link — sem criar termos duplicados (reusar token pendente, conforme já feito na ficha do paciente).
- **RF-12.14b — Enviar por WhatsApp.** Botão que abre o WhatsApp via **click-to-chat (`wa.me`)** no número do paciente, com mensagem **pré-preenchida** contendo o link do termo. DEVE reutilizar o helper já existente na ficha do paciente (`buildConsentWhatsAppHref(phone, consentUrl)`), incluindo a regra de **usar o telefone do responsável quando o paciente for menor** (`child`/`adolescent`). A mensagem padrão segue o texto já adotado no produto: _"Olá! Segue o link para assinatura do termo de consentimento: {consentUrl}"_.

**RF-12.14c.** A ação "Enviar por WhatsApp" só fica habilitada quando há telefone disponível (do paciente, ou do responsável no caso de menor). Sem telefone, o botão fica **desabilitado** com tooltip explicativo ("Cadastre um telefone para enviar pelo WhatsApp"), mas **"Copiar link" permanece disponível** como alternativa.

**RF-12.14d.** O envio **automatizado** do termo pela plataforma (WhatsApp Business API via Twilio) está **fora de escopo** neste PRD — depende do módulo de WhatsApp (PRD 04, pós-MVP). No MVP, o link sai pelo canal do próprio psicólogo (copiar/colar ou click-to-chat).

### 5.4. Destino C — Notas de IA para revisar (`/dashboard/transcricoes?status=ready`)

**RF-12.15.** A lista de transcrições (`/dashboard/transcricoes`) DEVE interpretar `status=ready` e abrir já na aba/segmento das notas **prontas para revisão** (status `ready`), em vez da aba padrão.

**RF-12.16.** Valores de `status` fora da allowlist (`ready` no MVP) DEVEM ser ignorados, abrindo a aba padrão sem erro (consistente com RF-12.03).

**RF-12.17.** A aba aberta deixa visualmente claro qual recorte está sendo exibido (rótulo da aba ativa serve como indicador de filtro). Não é necessário chip removível adicional, pois a navegação por abas já permite voltar.

### 5.5. Paridade e consistência

**RF-12.18.** A contagem exibida no destino (cabeçalho da lista/aba) DEVE ser idêntica à contagem do card de Pendências para o mesmo usuário no mesmo instante (mesma fonte de verdade — RF-12.04).

**RF-12.19.** Se, ao chegar ao destino, o conjunto filtrado estiver vazio (a pendência foi resolvida ou expirou entre o carregamento do dashboard e o clique), o destino DEVE exibir um **estado vazio positivo e específico**, não a lista completa:
- Sessões: "Nenhuma sessão sem evolução. Tudo em dia. 🎉"
- Pacientes: "Nenhum paciente sem consentimento pendente."
- Notas IA: "Nenhuma nota aguardando revisão."

Em todos os casos, oferecer um link para a visão completa ("Ver toda a agenda" / "Ver todos os pacientes" / "Ver todas as transcrições").

## 6. Requisitos não-funcionais

**RNF-12.01.** O destino aplica o filtro no **primeiro paint** (server-side, via `searchParams`), sem flash da lista completa antes de filtrar.

**RNF-12.02.** O tempo de carregamento da visão filtrada respeita o orçamento de performance das telas correspondentes (Agenda, Pacientes, Transcrições) — sem regressão perceptível.

**RNF-12.03.** Acessibilidade (WCAG 2.1 AA): o indicador de filtro ativo é anunciável por leitor de tela; o controle de remover filtro é acessível por teclado; a mudança de conteúdo da lista é comunicada (ex.: região "live").

**RNF-12.04.** Responsividade: no mobile, a visão em lista de sessões sem evolução e o indicador de filtro permanecem usáveis (o destino de sessões é lista, não calendário, o que favorece o mobile).

**RNF-12.05.** Os parâmetros de filtro são validados contra allowlist no servidor (defesa contra injeção de filtro/redirecionamento). O href do dashboard continua sendo um valor estático e seguro.

## 7. Regras de negócio

**RN-12.01.** O destino de "sessões sem evolução" é uma **visão em lista**, decisão de produto tomada porque (a) os itens são distribuídos no tempo ("+7 dias") e o calendário semanal os esconderia, e (b) a lista oferece o caminho mais curto até a ação de registrar evolução. O href canônico (`/agenda?filtro=sem-evolucao`) é preservado para não quebrar a constante do dashboard; o que muda é o modo de renderização quando o filtro está ativo.

**RN-12.02.** Os filtros de pendência são **escopados ao psicólogo logado** (`user_id = auth.uid()`). Nenhum destino pode, sob nenhum parâmetro de URL, exibir dados de outro profissional. (Defesa em profundidade — o filtro de UI nunca substitui o escopo de dono no servidor/RLS.)

**RN-12.03.** A regra de negócio de cada pendência é definida em um único lugar e reutilizada tanto na contagem quanto no filtro do destino. Divergência entre contagem e lista é considerada bug (ver RF-12.18).

**RN-12.04.** A janela de 7 dias para "evolução em atraso" NÃO é alterada por este PRD. Permanece conforme PRD 11 / implementação atual.

**RN-12.05.** Valores de parâmetro fora da allowlist não geram erro nem tela em branco — degradam graciosamente para a visão padrão do destino.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Pendência resolvida entre o load do dashboard e o clique | Destino mostra estado vazio positivo e específico (RF-12.19), com link para a visão completa. |
| Contagem do dashboard "envelhecida" (cache/aba antiga) maior que a lista real | A lista é a verdade no momento da abertura; o cabeçalho do destino reflete a contagem real. Não exibir a contagem antiga. |
| URL com `filtro` desconhecido (ex.: `?filtro=xyz`) | Ignorar o filtro; renderizar visão padrão sem erro (RF-12.03). |
| `filtro=sem-consentimento` combinado com `status=archived` | Predicados convivem; como pacientes arquivados são excluídos da regra de consentimento (RF-12.04), o resultado será vazio — exibir estado vazio coerente. |
| Sessão sem evolução cujo paciente foi arquivado/excluído depois | Mantém a regra de contagem como fonte; se a sessão ainda é elegível, aparece na lista. (Sessões não são hard-deleted — soft delete via `deleted_at` já é excluído pela regra.) |
| Usuário acessa o deep-link diretamente (sem passar pelo dashboard) | Funciona igual — o destino é stateless quanto à origem; depende só do parâmetro + escopo de dono. |
| Acesso não autenticado ao deep-link | Middleware de auth (gating de rota) redireciona para login, como qualquer rota `(app)`. O parâmetro é preservado no retorno pós-login (desejável, não bloqueante). |
| Lista de sessões sem evolução muito longa | Paginação/scroll conforme padrão das outras listas; ordenação mais-antiga-primeiro garante que os itens de maior risco fiquem no topo. |
| Remover o filtro de sessões | Volta para o calendário (visão padrão da Agenda), removendo o parâmetro da URL (RF-12.09). |
| Paciente (ou responsável, se menor) sem telefone cadastrado | Botão "Enviar por WhatsApp" desabilitado com tooltip; "Copiar link" continua disponível (RF-12.14c). |
| Paciente menor sem responsável vinculado | Sem telefone de responsável, "Enviar por WhatsApp" fica desabilitado; orientar a cadastrar responsável. "Copiar link" disponível. |
| Paciente ainda sem termo gerado ao clicar em copiar/enviar | Gera o termo pendente primeiro (reusa token pendente, sem duplicar) e então copia/abre o WhatsApp (RF-12.14a). |
| Telefone em formato inconsistente | Normalizar para dígitos (reusar `extractPhoneDigits`); presumir DDI Brasil quando ausente, conforme padrão atual da ficha do paciente. |

## 9. Critérios de aceitação

- [ ] Clicar em "Ver" em **sessões sem evolução** abre uma **lista** (não o calendário) contendo exatamente as sessões que compõem a contagem, ordenadas da mais antiga.
- [ ] A lista de sessões inclui sessões `done` de semanas anteriores (não se limita à semana corrente).
- [ ] Cada item da lista de sessões tem CTA "Registrar evolução" que abre a evolução daquela sessão.
- [ ] Clicar em "Ver" em **pacientes sem consentimento** abre a lista de pacientes filtrada apenas pelos pacientes sem `consent_signed_at` (e não arquivados).
- [ ] Cada paciente da lista filtrada tem ação "Copiar link do termo" que copia a URL token-gated (`/termo/{token}`) com feedback de "copiado".
- [ ] Cada paciente da lista filtrada tem ação "Enviar por WhatsApp" que abre `wa.me` no número correto (do responsável, se menor) com mensagem pré-preenchida contendo o link do termo.
- [ ] "Enviar por WhatsApp" fica desabilitado quando não há telefone, mantendo "Copiar link" disponível.
- [ ] Copiar/enviar quando não há termo pendente gera o termo sem duplicar (reusa token pendente).
- [ ] Clicar em "Ver" em **notas de IA para revisar** abre `/dashboard/transcricoes` já na aba das notas `ready`.
- [ ] A constante `AI_NOTES_AWAITING_REVIEW_HREF` aponta para `/dashboard/transcricoes?status=ready` (rota existente), não mais para `/configuracoes/ia/transcricoes`.
- [ ] Em cada destino, a contagem exibida bate exatamente com a contagem do card de Pendências.
- [ ] Cada destino com filtro de URL exibe indicador de filtro ativo; nos destinos A e B, o filtro é removível em 1 clique e volta à visão completa.
- [ ] O filtro é aplicado no primeiro paint (sem flash da lista completa).
- [ ] Parâmetro fora da allowlist degrada para a visão padrão, sem erro.
- [ ] Chegar a um destino sem itens (pendência já resolvida) mostra estado vazio positivo específico, não a lista completa.
- [ ] Nenhum parâmetro de URL expõe dados de outro psicólogo (teste negativo de escopo/RLS).
- [ ] Teste E2E cobre os três fluxos: dashboard → clique em "Ver" → destino filtrado correto, para cada pendência.

## 10. Dependências

- **PRD 11** — seção "Pendências" do dashboard e cálculo das contagens (`src/modules/dashboard/server/get-pendencias.ts`).
- **PRD 03** — Agenda (introdução do modo lista filtrada por `filtro=sem-evolucao`).
- **PRD 05** — Prontuário/evolução (destino do CTA "Registrar evolução").
- **PRD 02** — Pacientes (listagem que recebe `filtro=sem-consentimento`; CTA de envio de termo).
- **PRD 10** — Transcrição IA (lista `/dashboard/transcricoes` e estados de status).
- Arquivos atuais relevantes (referência, sujeitos a verificação pelo dev):
  - `src/modules/dashboard/server/get-pendencias.ts` (hrefs)
  - `src/app/(app)/agenda/page.tsx` + `src/modules/agenda/` (modo lista)
  - `src/app/(app)/pacientes/page.tsx` + `src/modules/patients/` (filtro de consentimento)
  - `src/app/(app)/dashboard/transcricoes/page.tsx` + `src/modules/ai-transcription/` (aba por status)

## 11. Referências regulatórias

- **Resolução CFP nº 001/2009** — obrigação de registrar evolução de cada atendimento. O caminho "sessões sem evolução → registrar" reduz o risco de descumprimento; por isso a ordenação prioriza as pendências mais antigas.
- **LGPD (Lei 13.709/2018)** — dados clínicos são sensíveis. As contagens e deep-links do dashboard carregam apenas números e rotas estáticas (sem PII); o detalhamento (quem/qual) só ocorre no destino, já protegido por autenticação e escopo de dono. Este PRD não altera esse princípio: filtros de UI nunca substituem o escopo de dono no servidor (RN-12.02).
- **LGPD — compartilhamento do termo por WhatsApp (RF-12.14b):** o envio ocorre pelo **canal do próprio psicólogo** (click-to-chat), não pela plataforma — não há tratamento de dados do paciente por nós nesse passo. A mensagem pré-preenchida DEVE conter **apenas o link do termo**, sem dado clínico ou diagnóstico. O link é **token-gated e sensível** (permite assinar o termo): não deve ser logado por inteiro nem exposto além do necessário, e o token segue o ciclo de vida já definido para consentimento (PRD 02). Compartilhar o link é coerente com a base legal de execução do contrato terapêutico.
- **Resolução CFP nº 13/2022 / 06/2019** — aplicáveis ao conteúdo das telas de destino (consentimento, prontuário), não a este contrato de navegação em si.

---

## Apêndice A — Resumo do contrato (visão do desenvolvedor)

```
DASHBOARD (get-pendencias.ts)                 DESTINO (lê searchParams + aplica predicado de contagem)
─────────────────────────────────            ───────────────────────────────────────────────────────
overdueEvolutionsHref                         /agenda?filtro=sem-evolucao
  = '/agenda?filtro=sem-evolucao'      ──────►  → renderiza LISTA filtrada (não calendário)
                                                 → predicado: done + start_at < now-7d + sem evolução
                                                 → ordena mais-antiga-primeiro; CTA "Registrar evolução"
                                                 → chip de filtro removível

patientsMissingConsentHref                    /pacientes?filtro=sem-consentimento
  = '/pacientes?filtro=sem-consentimento' ──►   → lista de pacientes filtrada
                                                 → predicado: consent_signed_at IS NULL + archived_at IS NULL
                                                 → chip de filtro removível
                                                 → por linha: [Copiar link do termo] + [Enviar por WhatsApp (wa.me)]
                                                   • reusa buildConsentWhatsAppHref(phone, consentUrl)
                                                   • menor → telefone do responsável
                                                   • sem telefone → WhatsApp desabilitado, copiar link disponível
                                                   • envio automatizado (Twilio/WABA) = fora de escopo (PRD 04)

aiNotesAwaitingReviewHref                     /dashboard/transcricoes?status=ready   (href CORRIGIDO)
  = '/dashboard/transcricoes?status=ready' ─►   → lista de transcrições, aba "Pendentes"/ready
                                                 → predicado: status = 'ready'

REGRAS GERAIS:
- predicado do destino == predicado da contagem (fonte única)  → contagens batem
- valor de filtro fora da allowlist → visão padrão, sem erro
- conjunto vazio → estado vazio positivo e específico (não a lista completa)
- escopo de dono (user_id = auth.uid()) sempre no servidor, nunca só na UI
```
