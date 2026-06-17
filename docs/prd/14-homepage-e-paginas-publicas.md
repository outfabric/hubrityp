# PRD 14 — Homepage e Páginas Públicas (Site Institucional)

> **Pré-requisitos:** PRD 00 (visão geral), PRD 01 (cadastro), PRD 02 (pacientes), PRD 03 (agenda), PRD 04 (WhatsApp), PRD 05 (prontuário), PRD 09 (telepsicologia), PRD 10 (transcrição IA), PRD 11 (onboarding e dashboard).
>
> **Escopo de versão:** este PRD cobre exclusivamente o MVP. Funcionalidades de cobrança/PIX (PRD 06), Receita Saúde (PRD 07) e recibos de reembolso (PRD 08) ainda não existem no MVP e **não devem ser comunicadas como funcionalidades disponíveis**. Podem ser mencionadas como "em breve" em seções secundárias (roadmap ou preços), sem destaque.
>
> **Design de referência (OBRIGATÓRIO):** As telas finais das páginas públicas já estão desenhadas no Figma, dentro do arquivo do **Design System** — [Hubrity Design System](https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System?t=VhQYwTHdwPGFVg1O-0) (páginas `Public · *`: Homepage desktop e mobile, Preços, Política de Privacidade, Termos de Uso, 404 e Banner de cookies). **A implementação deve reproduzir fielmente essas telas** — layout, tokens (cor, spacing, radius, tipografia), espaçamentos, estados e comportamento responsivo. Como **contexto de referência complementar**, siga o handoff técnico [`docs/design-system/public-pages-handoff.md`](../design-system/public-pages-handoff.md), que mapeia cada página/seção aos tokens, componentes, acessibilidade (WCAG 2.1 AA), logomarca e itens em aberto. Em caso de divergência entre este PRD e as telas do Figma, **as telas do Figma prevalecem** quanto à forma visual; este PRD prevalece quanto a regras de negócio e conteúdo.

---

## 1. Contexto e problema

Todas as funcionalidades do MVP estão prontas, mas o produto ainda não tem presença pública. Hoje, uma psicóloga que descobre o produto — por indicação de colega, busca orgânica ("prontuário eletrônico psicólogo") ou rede social — encontra diretamente a tela de login, sem nenhuma comunicação prévia sobre o que o sistema faz, para quem é, ou por que deveria confiar nele.

**Por que isso é crítico:**

- Psicólogas autônomas compram com o próprio dinheiro — a decisão é pessoal e emocional. Sem uma apresentação clara de valor, a maioria fecha a aba em menos de 15 segundos.
- A concorrência (Zero Papel, iClinic, Psicomanager, PsiNota AI) já tem páginas institucionais consolidadas. Entrar no mercado sem showcase é equivalente a não existir para quem pesquisa no Google.
- O diferencial do produto (ciclo completo agenda → vídeo → IA → prontuário, tudo em conformidade CFP/LGPD) precisa ser comunicado em menos de 3 minutos, ou a psicóloga assume que é "mais uma ferramenta genérica".

## 2. Objetivo da feature

Criar as páginas públicas (sem autenticação) que apresentam o produto à psicóloga que ainda não o conhece, comunicando o valor das funcionalidades do MVP de forma clara, persuasiva e em conformidade com a realidade brasileira (CFP, LGPD, PIX, WhatsApp), com o objetivo de convertê-la em cadastro dentro do período de trial (14 dias).

## 3. Escopo

### Dentro do escopo (MVP)

- Homepage (`/`) — página principal de apresentação do produto
- Página de preços (`/precos`) — planos, comparativo e CTA de cadastro
- Navegação pública (header e footer) compartilhada entre as páginas
- Banner de cookies / consentimento de analytics (LGPD)
- Screenshots reais do produto como material visual (carrossel interativo)
- Modo claro e escuro consistente com o restante do sistema

### Fora do escopo (versões futuras)

- Blog / artigos de SEO — pós-lançamento, quando houver dados de busca orgânica
- Página "Sobre" / "Quem somos" — lançar depois se necessário
- Vídeo de demonstração produzido (roteiro, edição, locução)
- Landing pages segmentadas por abordagem (TCC, psicanálise, etc.)
- Chat de suporte ao vivo — substituir por email visível no footer
- Página de funcionalidades separada (`/funcionalidades`) — features vivem em seções da homepage
- Programa de indicação / referral
- Comparativo público com concorrentes
- Versões traduzidas (inglês, espanhol)

## 4. User stories

- **Como psicóloga que não conhece o produto**, quero entender em menos de 3 minutos o que ele faz e se é para mim, para decidir se vale testar.
- **Como psicóloga**, quero ver o sistema real (screenshots) antes de criar conta, para não perder tempo com promessas vazias.
- **Como psicóloga**, quero saber se o sistema respeita as normas do CFP e da LGPD, para ter confiança de que não vou criar um problema ético para mim.
- **Como psicóloga**, quero saber quanto custa antes de criar conta, para não ter surpresa depois.
- **Como psicóloga**, quero criar conta diretamente da homepage em 1 clique, sem preencher formulários na própria página.
- **Como psicóloga no celular**, quero navegar pela homepage com a mesma facilidade que no computador.
- **Como paciente ou visitante curioso**, quero entender que o sistema não é para mim (é para psicólogos), sem ficar confuso.

## 5. Requisitos funcionais

### 5.1. Navegação pública (header)

**RF-14.01.** Header fixo (sticky) no topo de todas as páginas públicas, contendo:
- Logo do produto (link para `/`)
- Links de navegação: "Funcionalidades" (âncora para seção na homepage), "Preços" (link para `/precos`)
- Botão "Entrar" (link para `/login`, estilo secundário)
- Botão "Começar grátis" (link para `/signup`, estilo primário)

**RF-14.02.** Em mobile, links de navegação colapsam em menu hamburger. Botão "Começar grátis" permanece sempre visível.

**RF-14.03.** Quando o visitante faz scroll para baixo, o header recebe **fundo sólido opaco** — superfície `bg/surface` com borda inferior `border/subtle` e sombra `Shadow/Light/xs` — para manter legibilidade. *Não usar backdrop-blur/glassmorphism (proibido pelo Design System).*

### 5.2. Homepage (`/`) — Seção 1: Hero

**RF-14.04.** Seção hero ocupa a viewport inicial (above the fold) e contém:
- Badge contextual: "Feito para psicólogos autônomos"
- Headline principal: comunica a proposta de valor central — substituição de múltiplas ferramentas por um sistema único (ex: "De 10 ferramentas espalhadas para um único sistema clínico.")
- Subheadline: lista concretamente as funcionalidades do MVP — agenda, prontuário, videochamada, WhatsApp automatizado, IA que transcreve e escreve a evolução. Deve mencionar conformidade com CFP e LGPD.
- CTA primário: "Começar grátis — 14 dias" → `/signup`
- CTA secundário: "Ver funcionalidades" → âncora para seção de funcionalidades
- Microcopy abaixo dos CTAs: "Sem cartão de crédito. Cancele quando quiser."
- Área visual: carrossel de screenshots do sistema real (ver RF-14.16)

**RF-14.05.** A headline deve passar o "teste dos 5 segundos": uma psicóloga que olha a tela por 5 segundos deve entender (a) que é um sistema para psicólogos, (b) que centraliza tudo, (c) que tem IA.

### 5.3. Homepage — Seção 2: Prova social

**RF-14.06.** Barra horizontal abaixo do hero com dado de mercado:
- **frase sobre a dor do mercado**, ex: "Psicólogos gastam até 5 horas por semana com burocracia que o sistema resolve em minutos." + dado complementar: "40–60% das sessões hoje são online ou híbridas"

**RF-14.07.** Nunca fabricar depoimentos ou métricas. Ausência de prova social é preferível a credibilidade falsa. Quando depoimentos reais estiverem disponíveis, substituir o dado de mercado.

### 5.4. Homepage — Seção 3: Problema ("espelho")

**RF-14.08.** Seção que espelha o dia a dia da psicóloga para gerar identificação. Contém:
- Título provocativo: "Você ainda faz isso?"
- Lista de 5 itens curtos (uma frase cada), cada um representando uma ferramenta/processo fragmentado que o produto substitui:
  1. Manda lembrete de sessão pelo WhatsApp na mão
  2. Registra evolução no Word (ou no caderno)
  3. Gerencia a agenda no Google Agenda
  4. Abre Google Meet com link que sempre expira
  5. Controla pacientes em planilha Excel
- Frase de fechamento: tom de reconhecimento (não julgamento), transferindo a culpa para o mercado de ferramentas. Ex: "Não é falta de organização. É excesso de ferramentas que nunca foram feitas para você."

### 5.5. Homepage — Seção 4: Solução (fluxo visual)

**RF-14.09.** Seção que mostra o ciclo completo de valor do MVP em leitura de 20 segundos:
- Título: comunica centralização e integração entre módulos (ex: "Tudo o que o seu consultório precisa, num único lugar que conversa consigo mesmo.")
- Fluxo visual em 6 etapas conectadas (timeline horizontal em desktop, vertical em mobile):
  1. Paciente cadastrado
  2. Sessão agendada na agenda
  3. Lembrete automático via WhatsApp — paciente confirma em 1 clique
  4. Videochamada integrada — sem instalar nada
  5. Sessão finalizada → IA transcreve o áudio e gera a evolução
  6. Prontuário salvo, CFP cumprido
- Frase de fechamento: "De ponta a ponta — sem sair do sistema."
- Cada etapa tem ícone e 1 frase explicativa

**RF-14.10.** Animação sutil ao scroll (fade-in progressivo de cada etapa). Não usar animação pesada — respeitar preferência de reduced-motion (`prefers-reduced-motion: reduce`).

### 5.6. Homepage — Seção 5: Funcionalidades (pilares do MVP)

**RF-14.11.** Grade de 7 cards com as funcionalidades do MVP, layout 3×2 + 1 (desktop) ou 1 coluna (mobile). Cada card contém:
- Ícone representativo
- Título curto (2–3 palavras)
- Descrição (2–3 linhas, foco no benefício, não na feature técnica)
- Screenshot do sistema real associado à funcionalidade (thumbnail clicável que abre em modal ou lightbox)

Cards e conteúdo:

| # | Título | Descrição | Screenshot sugerido |
|---|---|---|---|
| 1 | Agenda | Semana, mês, dia. Recorrência em 1 clique. Arraste para remarcar. Status de confirmação em tempo real. | Vista semanal da agenda com sessões coloridas |
| 2 | Pacientes | Cadastro completo. Menor de idade, casal, tags. Termo de consentimento digital enviado e assinado pelo paciente. | Lista de pacientes com filtros ativos |
| 3 | WhatsApp Automático | Lembretes 24h antes, automaticamente. Paciente confirma com um botão no WhatsApp. Você vê o status em tempo real. | Tela de conversa entre Psicólogo e paciente que destaca lembrete de sessão enviado |
| 4 | Prontuário | Templates por abordagem (TCC, psicanálise, sistêmica). Escalas clínicas (PHQ-9, GAD-7). Documentos no padrão CFP. | Tela do prontuário de um paciente, com listagem de todas evoluções registradas |
| 5 | Telepsicologia | Sala de vídeo por sessão, criada automaticamente. Sala de espera virtual. Paciente entra sem instalar nada. | Tela de videochamada entre Psicólogo e paciente |
| 6 | IA Clínica | Sessão terminou? A IA transcreve o áudio e entrega a evolução pronta para você revisar e salvar. Áudio descartado após uso. | Tela de edição da evolução gerada pela IA no prontuário do paciente, onde o psicólogo revisa o conteúdo |
| 7 | Dashboard Operacional | O que acontece hoje: sessões do dia, confirmações via WhatsApp, prontuários pendentes. Tudo num olhar. | Dashboard com seção "Hoje" e "Pendências" |

**RF-14.12.** O card 7 (Dashboard) pode ter largura dupla (span 2 colunas em desktop) para acomodar screenshot mais amplo e fechar a grade visualmente.

### 5.7. Homepage — Seção 6: Destaque IA

**RF-14.13.** Seção com destaque visual diferenciado para a transcrição com IA — funcionalidade mais diferenciada do MVP. O contraste vem de uma **superfície sólida tom-sobre-tom da marca** (`brand/50`) — nunca de gradiente, glow ou blur (proibidos pelo Design System). Contém:
- Título quantificado: "10 minutos de registro → 1 minuto. Em 30 sessões por semana, você recupera até 5 horas."
- Subtítulo explicativo: "Ao finalizar a sessão, a IA transcreve o áudio e entrega a evolução pronta no prontuário. Você só revisa e salva."
- Comparativo antes/depois lado a lado:
  - **Antes:** screenshot do campo de evolução em branco com label "15 min escrevendo após cada sessão"
  - **Depois:** screenshot da evolução já preenchida pela IA no prontuário do paciente (template TCC com campos preenchidos) com label "1 min revisando e salvando"
- Lista de 4 itens de confiança/segurança:
  1. Consentimento do paciente obrigatório antes de qualquer gravação
  2. Áudio descartado automaticamente após processamento (24h)
  3. Processamento via API — áudio não é armazenado pelo provedor
  4. Você revisa e edita antes de salvar — IA é assistente, não substituta
- CTA: "Comece grátis e experimente na primeira sessão" → `/signup`

### 5.8. Homepage — Seção 7: Confiança (CFP + LGPD + Segurança)

**RF-14.14.** Seção que aborda a preocupação com sigilo e conformidade regulatória. Contém:
- Título: "Construído para o jeito que psicólogos brasileiros precisam trabalhar."
- Lista de garantias regulatórias e de segurança com checkmarks:
  1. Prontuário conforme Resolução CFP nº 001/2009
  2. Documentos psicológicos no padrão da Resolução CFP nº 06/2019
  3. Telepsicologia conforme Resolução CFP nº 09/2024
  4. Gravação somente com consentimento (Res. CFP nº 13/2022)
  5. Dados em servidores no Brasil — São Paulo (LGPD)
  6. Criptografia AES-256 em repouso, TLS 1.3 em trânsito
  7. Guarda de prontuário por 20 anos (Lei 13.787/2018)
  8. Somente psicólogos com CRP ativo podem criar conta
- Frase de fechamento: "Você foca no paciente. A burocracia regulatória é problema nosso."

**RF-14.15.** Usar linguagem exata das resoluções (números e anos). Psicólogos reconhecem os códigos das normas — isso cria credibilidade técnica que concorrentes generalistas não conseguem replicar.

### 5.9. Carrossel de screenshots (componente reutilizado)

**RF-14.16.** Componente de carrossel interativo usado no hero e reutilizável nas seções de funcionalidades. Comportamento:
- 4–6 screenshots do sistema real, navegáveis por setas laterais (desktop) e swipe (mobile/touch)
- Cada screenshot tem legenda curta (1 linha) descrevendo o que está sendo mostrado
- Indicadores de posição (dots) visíveis abaixo do carrossel
- Auto-play desativado por padrão — só avança com interação do usuário
- Imagens em formato WebP com fallback PNG, otimizadas para web (< 200 KB cada)
- Lazy loading para imagens fora da viewport (`loading="lazy"`)

**RF-14.17.** Screenshots sugeridos para o carrossel do hero (ordem):
1. Dashboard operacional — visões "Hoje" com sessões do dia e "Pendências"
2. Agenda semanal com sessões coloridas e status de confirmação
3. Evolução gerada pela IA no prontuário — pronta para revisão
4. Lista de pacientes com filtros e tags
5. Sala de Videochamada

**RF-14.18.** Screenshots devem usar dados fictícios mas realistas (nomes brasileiros plausíveis, horários típicos de consultório, abordagem TCC/psicanálise). Nunca usar dados reais de pacientes, mesmo em capturas de tela.

### 5.10. Homepage — Seção 8: Preços (resumo)

**RF-14.19.** Seção com resumo dos planos, sem detalhamento completo (que vive em `/precos`). Contém:
- Título: "Simples. Sem surpresa."
- Cards de plano lado a lado (2 planos), somente mensal (sem toggle anual):
  - **Essencial — R$ 60/mês:** agenda, pacientes, prontuário, telepsicologia, dashboard
  - **Avançado — R$ 90/mês:** tudo do Essencial + lembretes automáticos via WhatsApp + transcrição com IA
- Badge "Mais popular" no plano Avançado (plano recomendado)
- Microcopy: "14 dias grátis para testar tudo. Sem cartão de crédito. Cancele quando quiser."
- Link: "Ver planos completos →" → `/precos`

**RF-14.20.** Os valores e nomes dos planos são definidos pela regra de negócio (RN-14.06) e devem ser facilmente alteráveis (variáveis em arquivo de configuração ou CMS, não hardcoded no JSX).

### 5.11. Homepage — Seção 9: FAQ

**RF-14.21.** Seção de perguntas frequentes em formato accordion (expandível). Mínimo de 5, máximo de 8 perguntas. Perguntas obrigatórias no MVP:

| # | Pergunta | Ângulo de resposta |
|---|---|---|
| 1 | "Meus dados de paciente ficam seguros?" | Servidores em São Paulo, AES-256, LGPD, a psicóloga é controladora dos dados, nós somos operadores |
| 2 | "Funciona para atendimento presencial também?" | Sim — prontuário, agenda e WhatsApp funcionam igual. Para IA, basta fazer upload do áudio da sessão presencial |
| 3 | "Preciso cancelar o Google Agenda?" | Não — o sistema funciona independente. É possível importar pacientes via CSV e ir migrando no próprio ritmo |
| 4 | "A IA vai errar e inventar conteúdo?" | A nota gerada é sempre uma sugestão editável. Nada vai para o prontuário sem revisão e aprovação da psicóloga |
| 5 | "Quanto custa depois do período grátis?" | Resposta direta com valores e link para `/precos` |

**RF-14.22.** Cada item do accordion é um `<details><summary>`, com comportamento de fechar o anterior ao abrir o próximo (accordion exclusivo).

### 5.12. Homepage — Seção 10: CTA Final

**RF-14.23.** Seção de fechamento com chamada para ação antes do footer. Contém:
- Título motivador: "Comece hoje. Sem compromisso."
- CTA primário: "Criar conta grátis — 14 dias" → `/signup`
- Microcopy: "Configuração em 5 minutos. Sua primeira sessão registrada com IA ainda hoje."
- Fundo de **superfície sólida da marca** (`brand/700`, texto `text/inverse`) para se destacar do conteúdo acima. *Sem gradiente (proibido pelo Design System).*

### 5.13. Footer

**RF-14.24.** Footer presente em todas as páginas públicas (e nas páginas autenticadas do app). Contém:
- Logo do produto
- Colunas de links:
  - **Produto:** Funcionalidades (âncora), Preços
  - **Legal:** Política de Privacidade, Termos de Uso, LGPD
  - **Contato:** Email de suporte
- Linha inferior: "© 2026 [Nome do produto]. Dados armazenados no Brasil. Feito para psicólogos autônomos brasileiros."

**RF-14.25.** Links de Política de Privacidade e Termos de Uso devem apontar para páginas funcionais (mesmo que mínimas) — páginas legais são pré-requisito para banner de cookies e para o cadastro (PRD 01).

### 5.14. Página de preços (`/precos`)

**RF-14.26.** Estrutura da página:
- Título: "Investimento no seu consultório, não na burocracia."
- Cards de plano (2 planos) lado a lado, cada um com:
  - Nome do plano
  - Preço mensal
  - Lista completa de funcionalidades inclusas (checkmarks)
  - CTA: "Experimentar grátis — 14 dias" → `/signup?plano=[slug]`
  - Badge "Popular" no plano recomendado
- Tabela comparativa expandível abaixo dos cards com todas as funcionalidades discriminadas por plano
- Seção FAQ de cobrança (3–5 perguntas sobre pagamento, cancelamento, nota fiscal)
- CTA final: repetição do botão de cadastro

**RF-14.27.** Estrutura de planos (definida — ver RN-14.05):

| Funcionalidade | Essencial — R$ 60/mês | Avançado — R$ 90/mês |
|---|---|---|
| Agenda (dia, semana, mês, recorrência) | ✓ | ✓ |
| Gestão de pacientes (cadastro, tags, termos) | ✓ | ✓ |
| Prontuário (evoluções, templates por abordagem) | ✓ | ✓ |
| Dashboard operacional | ✓ | ✓ |
| Documentos CFP (declaração, atestado, laudo) | ✓ | ✓ |
| Escalas clínicas (PHQ-9, GAD-7, etc.) | ✓ | ✓ |
| Telepsicologia (videochamada integrada) | ✓ | ✓ |
| **Lembretes automáticos via WhatsApp** | — | ✓ |
| **Transcrição e nota com IA** | — | ✓ |

O plano **Avançado** se diferencia do **Essencial** exclusivamente por **duas** funcionalidades: integração com WhatsApp e transcrição com IA. Todo o restante do produto é idêntico nos dois planos.

**RF-14.28.** Ambos os planos incluem trial de 14 dias sem cartão de crédito. Cobrança exclusivamente mensal (plano anual poderá ser introduzido em versão futura). Ao final do trial, o psicólogo escolhe o plano ou perde acesso às funcionalidades exclusivas do Avançado (downgrade automático para Essencial, sem perda de dados).

**RF-14.29.** Menção a nota fiscal automática na seção de cobrança: "Todas as cobranças geram nota fiscal automaticamente." (dependente do provedor de pagamento — Asaas).

### 5.15. Banner de cookies (LGPD)

**RF-14.30.** Banner de consentimento de cookies exibido na primeira visita, com:
- Texto claro: "Usamos cookies para melhorar sua experiência e medir o desempenho do site."
- Botão "Aceitar" (aceita todos)
- Botão "Recusar" (aceita somente cookies essenciais)
- Link "Saiba mais" → Política de Privacidade
- Banner desaparece após escolha e salva preferência em cookie local (`cookie_consent`)

---

## 6. Requisitos não-funcionais

**RNF-14.01.** Homepage carrega em < 2 segundos no Lighthouse mobile (3G simulado). Score Lighthouse Performance ≥ 90.

**RNF-14.02.** Largest Contentful Paint (LCP) < 2,5 segundos. O screenshot do hero é o provável LCP — deve ser otimizado (WebP, tamanho adequado, preload).

**RNF-14.03.** Cumulative Layout Shift (CLS) < 0,1. Imagens do carrossel devem ter `width` e `height` explícitos ou aspect-ratio CSS para evitar layout shift.

**RNF-14.04.** Acessibilidade WCAG 2.1 AA: contraste mínimo 4.5:1 em texto, navegação por teclado funcional, alt-text em todas as imagens/screenshots, landmarks ARIA no header/main/footer.

**RNF-14.05.** Responsividade: layout funcional e legível em viewports de 320px (mobile) a 1920px (desktop). Breakpoints alinhados com o design system existente (Tailwind defaults).

**RNF-14.06.** SEO técnico mínimo:
- `<title>` e `<meta description>` únicos por página
- Open Graph tags (`og:title`, `og:description`, `og:image`) para preview em redes sociais e WhatsApp
- `<link rel="canonical">` em cada página
- Sitemap XML gerado automaticamente (`/sitemap.xml`)
- `robots.txt` configurado

**RNF-14.07.** Modo escuro: todas as páginas públicas devem respeitar a preferência do sistema (`prefers-color-scheme`) e o toggle de modo escuro, consistente com as páginas autenticadas do app.

**RNF-14.08.** Imagens servidas via `next/image` com otimização automática (formato, tamanho, lazy loading).

**RNF-14.09.** **Conformidade com o Design System (Sálvia).** Toda a forma visual segue os tokens e as proibições do DS — em caso de conflito, as telas no Figma e o `rules.md` do DS prevalecem sobre qualquer descrição visual deste PRD. Em particular:
- **Proibido:** gradientes, sombras coloridas, glassmorphism/blur/glow/neon, mais de 3 cores funcionais por tela, pesos de fonte 700+, emojis na UI (exceto em mensagens enviadas ao paciente, como na screenshot do WhatsApp).
- **Contraste de seções** (Destaque IA, CTA final) vem de **superfícies sólidas** da paleta (`brand/50`, `brand/700`), nunca de gradiente/glow.
- **Cor de marca** reservada a botão primário, item ativo, foco, logo e realces pontuais; ~90% da UI é neutra.
- **Tipografia:** Inter (pesos 400/600) via tokens de texto do DS; **Nunito** apenas no wordmark da logomarca. Ícones **Lucide** (stroke 1.5). Cantos, espaçamentos, raios e sombras sempre por tokens (`space/*`, `radius/*`, `Shadow/*`).
- **Botão primário** usa `brand/600` (atende contraste WCAG AA), não `brand/500`.

---

## 7. Regras de negócio

**RN-14.01.** Apenas funcionalidades que existem no MVP podem ser comunicadas como disponíveis nas páginas públicas. Funcionalidades pós-MVP (PRDs 06, 07, 08) podem aparecer apenas em contexto de "em breve" ou "roadmap", nunca no hero, nos cards de funcionalidades ou na tabela comparativa de planos.

**RN-14.02.** A CTA "Começar grátis" direciona para `/signup` (PRD 01). O fluxo de cadastro permanece como especificado no PRD 01 — a homepage não duplica campos de cadastro nem coleta dados além do clique.

**RN-14.03.** Screenshots do sistema devem usar dados fictícios mas verossímeis. Nomes de pacientes, datas, conteúdo de evoluções — tudo fabricado. Nunca usar dados reais, mesmo de contas de teste.

**RN-14.04.** O badge "Feito para psicólogos autônomos" no hero tem função de filtro intencional: visitantes que não são psicólogos devem entender rapidamente que o produto não é para eles, evitando cadastros não-qualificados.

**RN-14.05.** Os planos estão definidos: **Essencial (R$ 60/mês)** e **Avançado (R$ 90/mês)**. O Avançado se diferencia exclusivamente por duas funcionalidades — integração com WhatsApp e transcrição com IA. A implementação deve parametrizar preços, nomes e composição dos planos em arquivo de configuração ou constantes centralizadas (não hardcoded em JSX) para facilitar ajustes futuros e A/B tests.

**RN-14.06.** A homepage e a página de preços devem sempre exibir os valores de forma clara (R$ 60 e R$ 90/mês). Uma página sem preço visível perde cadastros.

**RN-14.07.** Funcionalidades pós-MVP podem ser mencionadas no passo 4 do wizard de onboarding (PRD 11) como "em breve" e na página de preços como roadmap, mas nunca nas seções de funcionalidades da homepage.

---

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Visitante acessa `/` já autenticado | Header substitui "Entrar" / "Começar grátis" por "Acessar plataforma" → `/dashboard`. Homepage continua acessível (não redireciona — psicólogo pode querer compartilhar o link com colega). |
| Visitante acessa `/precos` sem planos definidos | Página não deve ser publicada sem pelo menos 1 plano com preço. Se por erro de deploy os preços estiverem vazios, exibir "Entre em contato para saber mais" com email e esconder cards vazios. |
| Visitante com JavaScript desativado | Carrossel de screenshots degrada para imagem estática (primeiro screenshot). FAQ accordion abre todos os itens (estado expandido). Navegação hamburger não funciona — exibir links inline em mobile como fallback via `<noscript>`. |
| Visitante acessa URL inexistente sob `/` (ex: `/funcionalidades`) | Página 404 pública com visual consistente, CTA "Voltar para a homepage" e "Criar conta grátis". |
| Visitante vem de campanha paga com UTM params | Preservar UTMs na URL ao clicar em CTA → `/signup?utm_source=...`. Analytics deve capturar origem. |
| Visitante com `prefers-reduced-motion: reduce` | Desativar animações de scroll (fade-in), auto-play do carrossel, e qualquer transição não-essencial. |
| Visitante em tela muito pequena (< 320px) | Layout não quebra — texto pode sofrer overflow com ellipsis, screenshots reduzem, mas a página permanece usável. |
| Screenshot do sistema muda após redesign | Screenshots devem ser tratados como assets versionados. Quando uma tela do app muda significativamente, atualizar o screenshot correspondente na homepage na mesma release. |

---

## 9. Critérios de aceitação

- [ ] Homepage carrega em < 2s no Lighthouse mobile (3G simulado), score Performance ≥ 90
- [ ] Todas as 10 seções da homepage renderizam corretamente em desktop (1440px) e mobile (375px)
- [ ] CTA "Começar grátis" em todas as ocorrências (hero, destaque IA, CTA final) navega para `/signup`
- [ ] CTA "Entrar" navega para `/login`
- [ ] Carrossel de screenshots navega por setas (desktop) e swipe (mobile) sem quebrar layout
- [ ] Screenshots usam dados fictícios — nenhum dado real de paciente
- [ ] Seção FAQ accordion abre/fecha corretamente; apenas um item aberto por vez
- [ ] Página `/precos` exibe planos com preços (cobrança **somente mensal** — sem toggle anual), tabela comparativa correta
- [ ] Header sticky funciona com scroll; fundo sólido opaco ativo (sem backdrop-blur)
- [ ] Footer links de Política de Privacidade e Termos de Uso apontam para páginas funcionais
- [ ] Banner de cookies aparece na primeira visita, salva preferência, não reaparece
- [ ] Analytics só carrega após consentimento de cookies (ou sem consentimento se Plausible sem cookies)
- [ ] Modo escuro funciona em todas as páginas públicas, consistente com o app
- [ ] Meta tags SEO presentes (title, description, og:image, canonical)
- [ ] Visitante autenticado vê "Acessar plataforma" no header em vez de "Entrar"/"Começar grátis"
- [ ] Animações de scroll respeitam `prefers-reduced-motion: reduce`
- [ ] Navegação por teclado funcional: Tab percorre todos os CTAs e links, Enter ativa
- [ ] Seção de confiança CFP/LGPD lista todas as 8 garantias com números de resolução corretos

---

## 10. Dependências

- **Telas de referência no Figma (fonte de verdade visual):** arquivo do Design System, páginas `Public · *` — [Hubrity Design System](https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System?t=VhQYwTHdwPGFVg1O-0). Handoff técnico complementar (mapeamento de tokens, componentes, acessibilidade e itens em aberto): [`docs/design-system/public-pages-handoff.md`](../design-system/public-pages-handoff.md)
- **Screenshots reais do sistema:** presentes em formato webp na pasta ´docs/screenshots/´
- **PRD 01** (cadastro — destino dos CTAs de `/signup`)
- **PRD 02** (pacientes — conteúdo de screenshot e copy)
- **PRD 03** (agenda — conteúdo de screenshot e copy)
- **PRD 04** (WhatsApp — conteúdo de screenshot, copy e card de funcionalidade)
- **PRD 05** (prontuário — conteúdo de screenshot e copy)
- **PRD 09** (telepsicologia — conteúdo de screenshot e copy)
- **PRD 10** (transcrição IA — conteúdo de screenshot, copy e seção destaque)
- **PRD 11** (onboarding/dashboard — conteúdo de screenshot)

---

## 11. Referências regulatórias

- **LGPD (Lei 13.709/2018)** — banner de cookies com consentimento (art. 7º), política de privacidade acessível (art. 9º), dados em servidores no Brasil mencionados na seção de confiança
- **Marco Civil da Internet (Lei 12.965/2014)** — termos de uso devem estar disponíveis antes do cadastro
- **Resolução CFP nº 001/2009** — mencionada na seção de confiança (prontuário)
- **Resolução CFP nº 06/2019** — mencionada na seção de confiança (documentos psicológicos)
- **Resolução CFP nº 09/2024** — mencionada na seção de confiança (telepsicologia)
- **Resolução CFP nº 13/2022** — mencionada na seção de confiança e no destaque IA (gravação com consentimento)
- **Lei 13.787/2018** — mencionada na seção de confiança (guarda de prontuário digital por 20 anos)
- **CDC (Lei 8.078/1990)** — preços devem ser exibidos de forma clara e completa na página de preços

---

## Apêndice A — Mapa de seções da homepage

```
┌──────────────────────────────────────────────────────┐
│  HEADER (sticky)                                     │
│  Logo | Funcionalidades | Preços | Entrar | [CTA]    │
├──────────────────────────────────────────────────────┤
│  1. HERO                                             │
│     Badge + Headline + Subheadline + 2 CTAs          │
│     + Carrossel de screenshots                       │
├──────────────────────────────────────────────────────┤
│  2. PROVA SOCIAL                                     │
│     Dados de mercado                                 │
├──────────────────────────────────────────────────────┤
│  3. PROBLEMA ("Você ainda faz isso?")                │
│     5 bullets de espelho + frase de fechamento       │
├──────────────────────────────────────────────────────┤
│  4. SOLUÇÃO (fluxo visual)                           │
│     Timeline 6 etapas: paciente → agenda →           │
│     WhatsApp → vídeo → IA → prontuário salvo         │
├──────────────────────────────────────────────────────┤
│  5. FUNCIONALIDADES (7 cards)                        │
│     Agenda | Pacientes | WhatsApp | Prontuário |     │
│     Telepsicologia | IA Clínica | Dashboard          │
├──────────────────────────────────────────────────────┤
│  6. DESTAQUE IA                                      │
│     Antes/depois + 4 garantias de segurança          │
├──────────────────────────────────────────────────────┤
│  7. CONFIANÇA (CFP + LGPD)                           │
│     8 checkmarks regulatórios                        │
├──────────────────────────────────────────────────────┤
│  8. PREÇOS (resumo)                                  │
│     2 cards + link "Ver planos completos"            │
├──────────────────────────────────────────────────────┤
│  9. FAQ                                              │
│     5–8 perguntas em accordion                       │
├──────────────────────────────────────────────────────┤
│  10. CTA FINAL                                       │
│     "Comece hoje" + botão cadastro                   │
├──────────────────────────────────────────────────────┤
│  FOOTER                                              │
│  Logo | Links produto/legal/contato | Copyright      │
└──────────────────────────────────────────────────────┘
```
