# Handoff — Páginas Públicas (PRD 14)

Especificação de implementação das páginas públicas (homepage, preços, legais, 404)
para o **fullstack-developer**. Cobre estrutura, tokens, componentes, estados,
responsividade e acessibilidade. **Fonte de verdade visual:** o arquivo Figma do
Design System (Hubrity / Sálvia).

- **Figma:** `Hubrity Design System` — file key `HoLOEqq9PXlo6IwLkz3FQ9`
- **Páginas do arquivo:**
  - `Public · Homepage` — Homepage desktop (`node 105:2`) + Homepage mobile (`node 133:2`)
  - `Public · Pricing` — Pricing desktop (`node 128:2`)
  - `Public · Legal & 404` — Privacidade (`142:2`), Termos (`143:2`), 404 (`144:2`)
  - `Public · Library` — Banner de cookies (`132:2`)
  - `Public · Assets (scratch)` — screenshots importados (não usar em produção; ver abaixo)

> Tudo foi construído **vinculado a tokens** do DS (variáveis de cor, spacing, radius,
> estilos de texto e de efeito). Nenhum valor hardcoded. Ao implementar em código,
> use as classes/vars do DS (`globals.css` `--ds-*` + Tailwind), nunca hex literais.

---

## 1. Fundações do DS usadas

Todas existem no arquivo Figma (coleções `Color`, `Spacing`, `Radius`, estilos de texto/efeito)
e espelham `src/app/globals.css` + `docs/design-system/rules.md`.

| Categoria         | Tokens                                                                       |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------- | --------------------------- |
| Cor — superfícies | `color/bg/background`, `bg/surface`, `bg/surface-muted`, `bg/surface-sunken` |
| Cor — bordas      | `color/border/default`, `border/strong`, `border/subtle`                     |
| Cor — texto       | `color/text/primary`, `secondary`, `tertiary`, `disabled`, `inverse`         |
| Cor — brand       | `color/brand/50…900` (verde-sálvia)                                          |
| Cor — semânticas  | `color/{success,warning,danger,info}/{50,500,700}`                           |
| Spacing           | `space/1…24` (base 4px)                                                      |
| Radius            | `radius/sm,md,lg,xl,2xl,full`                                                |
| Tipografia        | `Heading/h1–h4`, `Body/lg                                                    | base                              | sm`, `Label/caption | caption-upper`, `Code/base` |
| Sombras           | `Shadow/Light                                                                | Dark/{xs,sm,md,lg}`, `Focus/Light | Dark/ring`          |

### 1.1. Extensão do DS — tipografia de marketing (NOVO, precisa entrar no DS)

A escala in-app vai até `Heading/h1` (28px), pequena para herói de landing. Foram criados
**4 estilos de texto novos** no Figma, dentro das regras do DS (apenas Inter, pesos 400/600):

| Estilo       | Tamanho | Peso | Line-height | Tracking | Uso                             |
| ------------ | ------- | ---- | ----------- | -------- | ------------------------------- |
| `Display/xl` | 52px    | 600  | 56px        | -0.5%    | Headline do herói (desktop)     |
| `Display/lg` | 40px    | 600  | 46px        | -0.4%    | Títulos de seção grandes        |
| `Display/md` | 32px    | 600  | 40px        | -0.2%    | Títulos de seção / herói mobile |
| `Lead`       | 20px    | 400  | 30px        | 0        | Subtítulo/leitura introdutória  |

> **Ação:** adicionar esses 4 tokens ao DS em código (`globals.css`/Tailwind) e ao
> `docs/design-system/rules.md` como "escala de marketing", já que hoje não existem lá.
> Sem isso, a homepage não tem como reproduzir o herói fielmente.

---

## 2. Reconciliações com o DS (decisões tomadas)

O PRD 14 pede alguns recursos que conflitam com as proibições do DS. Resolvidos assim:

1. **Sem gradientes** (proibição do DS). O PRD sugeria "gradiente sutil" nas seções de
   contraste. Substituído por **superfície sólida de marca**: a seção CTA final e a
   barra superior do destaque IA usam `brand/700` (sólido) / `brand/50` (tinta calma).
2. **Botão primário = `brand/600`** (não `brand/500`). `brand/500` (#6b8a66) com texto
   inverso resulta em contraste ~3.6:1 (reprova AA para texto normal). `brand/600`
   (#587355) dá ~4.7:1 (passa AA). **Recomendação:** alinhar o token de botão primário
   do DS para `brand/600` no contexto público, ou validar caso a caso.
3. **Planos somente mensais** (sem toggle anual) — conforme RF-14.28/RN-14.05. O item de
   critério de aceite que menciona "toggle mensal/anual" foi tratado como erro de
   redação do PRD.
4. **Cor funcional ≤ 3 por tela:** as landings usam `brand` (CTA/realce) + neutros. Os
   checkmarks de conformidade usam `brand/700` (não introduzem verde semântico extra).

---

## 3. Convenções de implementação

- **Largura de conteúdo:** 1200px máx. (geral), 720px (leitura longa — páginas legais).
  Herói/colunas de texto centralizadas com larguras menores (660–820px) para leitura.
- **Padding lateral:** desktop `space/8` (32px), mobile `space/4` (16px).
- **Gap entre seções:** seções full-bleed com padding vertical `space/24` (96px) desktop /
  `space/12`–`16` mobile. Veja cada seção no Figma para os valores exatos (todos `space/*`).
- **Cards:** `radius/xl` (12px), `bg/surface`, `border/default`, `Shadow/Light/xs`.
  Painéis grandes: `radius/2xl`. Pills/badges: `radius/full`.
- **Ícones:** Lucide, stroke 1.5. Mapa conceito→ícone em `rules.md`. Importados como SVG.
- **Imagens:** `next/image`, WebP com fallback, `loading="lazy"` fora da viewport,
  `width`/`height` explícitos (CLS < 0.1). Herói faz `preload` (provável LCP).

---

## 4. Componentes compartilhados

### Logomarca (marca oficial)

Fonte: arquivo de marca `Hubrity — Marca / Identidade Visual` (file key `4O3POARuvEYI1BCrxbOFg2`),
nós `Logo / Símbolo` (`16:7`), `Lockup Horizontal` (`17:2`), `Lockup Vertical` (`17:8`).

- **Símbolo** = "H" formado por 3 cápsulas arredondadas: haste esquerda `#587355`
  (`logo/presenca-a`, = sage/brand-600), haste direita `#5b7a93` (`logo/presenca-b`, = sky-500),
  elo central `#3f6f63` (`logo/encontro`, teal). Proporção 146×160 (ver geometria no arquivo).
- **Wordmark** = "hubrity" (minúsculas) em **Nunito SemiBold**, tracking ≈ -1%, cor `#21261f`
  (`logo/wordmark`) no claro / `#fafaf9` (inverso) no escuro.
- **Ação para o dev:** importar `Nunito` (Google Font) via `next/font` apenas para o wordmark;
  adicionar tokens `logo/*` (presenca-a/b, encontro, wordmark) ao DS; usar o SVG/lockup oficial
  do arquivo de marca em vez de recriar. Header usa o lockup horizontal; mobile/compacto pode
  usar só o símbolo.

### Header público (sticky) — desktop `dentro de 105:2`, mobile `dentro de 133:2`

- Logo (lockup horizontal da marca — ver acima), links `Funcionalidades`
  (âncora `#funcionalidades`) e `Preços` (`/precos`), botão `Entrar` (secundário → `/login`),
  botão `Começar grátis` (primário → `/signup`).
- Altura 72 (desktop) / 60 (mobile). `bg/surface` + `border/subtle` inferior + `Shadow/Light/xs`
  (estado "scrolled/opaco" — RF-14.03). Topo sobre o herói pode ser transparente.
- **Mobile (RF-14.02):** links colapsam em hambúrguer; `Começar` permanece sempre visível.
- **Estados:** hover/focus em todos os interativos (anel `Focus/Light/ring`), alvos ≥ 44px.
- **Visitante autenticado (edge case):** trocar `Entrar`/`Começar grátis` por
  `Acessar plataforma` → `/dashboard`. Não redirecionar a home.

### Footer — `dentro de 126:7`

- **Renderizado em modo escuro** (`bg/background` dark). Colunas: marca + tagline,
  `Produto` (Funcionalidades, Preços), `Legal` (Política de Privacidade, Termos de Uso,
  LGPD), `Contato` (suporte@hubrity.com.br). Linha de copyright.
- LGPD aponta para a seção LGPD da Política de Privacidade (decisão: não é página separada).
- Presente em todas as páginas públicas (e deve ser reutilizado no app autenticado).

### Banner de cookies (LGPD) — `132:2`

- Card (`radius/2xl`, `Shadow/Light/lg`, máx ~460px), canto inferior. Título, texto,
  link "Saiba mais" → Política de Privacidade, botões `Aceitar` (primário) e `Recusar`
  (secundário). Salvar preferência em cookie `cookie_consent`; analytics só após consentimento.

### Carrossel de screenshots — `dentro do herói (110:x)`

- Janela de produto (chrome com 3 pontos + screenshot), setas laterais (44px, circulares),
  legenda (1 linha), dots de posição (ativo = pill `brand/600`).
- **Sem auto-play** (RF-14.16). Swipe no mobile. `loading="lazy"`, WebP < 200KB.
- Sem JS: degrada para a 1ª imagem estática (edge case §8).

---

## 5. Homepage `/` — 10 seções (desktop `105:2` · mobile `133:2`)

Ordem e conteúdo conforme PRD §5.2–5.13. Resumo por seção:

| #   | Seção               | Notas de implementação                                                                                                                                                    |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Hero**            | Badge `brand/50`+`brand/700`; headline `Display/xl`; subhead `Lead`; 2 CTAs; microcopy `Body/sm`; carrossel abaixo. Passa o teste dos 5s.                                 |
| 2   | **Prova social**    | Barra `bg/surface-muted`, 2 stats (`Display/md` `brand/700` + `Body/base`). **Sem depoimentos fabricados** (RF-14.07).                                                    |
| 3   | **Problema**        | Título `Display/lg`; lista de 5 itens (ícone neutro + frase); fecho `Display/md`. Tom de reconhecimento.                                                                  |
| 4   | **Solução**         | 6 cards de passo em linha (desktop) / vertical (mobile), ícone `brand/700` em chip `brand/50`. Fecho `brand/700`. Fade-in no scroll (respeitar `prefers-reduced-motion`). |
| 5   | **Funcionalidades** | Grade 3×2 de 6 cards + card 7 (Dashboard) full-width. Cada card: ícone, título `Heading/h3`, descrição, thumbnail clicável (abre modal/lightbox).                         |
| 6   | **Destaque IA**     | Fundo `brand/50`. Antes/depois (editor vazio vs evolução gerada), seta `brand/600`, 4 itens de confiança, CTA.                                                            |
| 7   | **Confiança**       | Painel com **8 garantias** citando os números exatos das resoluções (ver §7 abaixo). Fecho.                                                                               |
| 8   | **Preços (resumo)** | 2 cards (Essencial R$60 / Avançado R$90 "Mais popular"), microcopy, link `Ver planos completos →` `/precos`.                                                              |
| 9   | **FAQ**             | Acordeão (`<details><summary>`), 5 itens, exclusivo (abrir um fecha o anterior). Item aberto com borda `brand/200`. Sem JS: todos abertos.                                |
| 10  | **CTA final**       | Fundo sólido `brand/700`, texto `text/inverse`, botão branco (`bg/surface` + texto `brand/700`), microcopy `brand/100`.                                                   |

**Mobile:** hambúrguer; seções empilhadas; timeline vertical; features em 1 coluna (7 cards);
antes/depois empilhado; preços empilhados; footer empilhado.

---

## 6. Pricing `/precos` (desktop `128:2`)

- Título `Display/lg` + subtítulo. 2 cards de plano (lista completa de features, CTA
  `/signup?plano=[slug]`, badge `Popular` no Avançado).
- **Tabela comparativa** (9 linhas × 2 planos) — coluna Avançado com tinta `brand/50`;
  ✓ = check `brand/700`, — = traço `border/strong`. Avançado difere do Essencial **apenas**
  por WhatsApp + IA.
- **FAQ de cobrança** (4 itens: cobrança, cancelamento, fim do teste/downgrade, nota fiscal).
- CTA final (`brand/700`) + footer.
- **Preços parametrizados (RN-14.05):** nomes/valores/composição em config central, não no JSX.
- Mobile: mesmo padrão de empilhamento da homepage (cards de plano e tabela viram blocos).

---

## 7. Seção de confiança — texto regulatório obrigatório (RF-14.15)

Usar a **redação exata** (números e anos). Critério de aceite valida as 8:

1. Prontuário conforme a **Resolução CFP nº 001/2009**
2. Documentos no padrão da **Resolução CFP nº 06/2019**
3. Telepsicologia conforme a **Resolução CFP nº 09/2024**
4. Gravação somente com consentimento (**Res. CFP nº 13/2022**)
5. Dados em servidores no Brasil — São Paulo (**LGPD**)
6. Criptografia **AES-256** em repouso e **TLS 1.3** em trânsito
7. Guarda de prontuário por 20 anos (**Lei 13.787/2018**)
8. Somente psicólogos com **CRP ativo** podem criar conta

---

## 8. Páginas legais + 404

- **Política de Privacidade** (`142:2`) — coluna de leitura 720px, 8 seções incluindo
  **base legal e direitos (LGPD)** e **cookies**. Banner `info/50` no topo: o texto é de
  referência e **deve ser revisado pelo jurídico** antes de publicar.
- **Termos de Uso** (`143:2`) — mesma estrutura, 8 seções (elegibilidade CRP, planos,
  cancelamento, IP, responsabilidade, lei aplicável/CDC).
- **404** (`144:2`) — `404` grande `brand/600`, mensagem, CTAs `Voltar para a homepage`
  (secundário) + `Criar conta grátis` (primário), footer.
- Privacidade e Termos são **pré-requisito** do banner de cookies e do cadastro (PRD 01).

---

## 9. Screenshots (ativo visual principal)

7 capturas reais do produto, importadas no Figma (`scaleMode` FILL/CROP). **Origem:**
`docs/screenshots/*.webp`. Em produção, servir via `next/image` (WebP < 200KB, dims explícitas).
Dados são fictícios mas verossímeis (RN-14.03) — não há dados reais de paciente.

| Arquivo               | Uso na landing                                      |
| --------------------- | --------------------------------------------------- |
| `dashboard.webp`      | Carrossel do herói; card 7 (Dashboard)              |
| `agenda.webp`         | Card Agenda                                         |
| `pacientes.webp`      | Card Pacientes                                      |
| `whatsapp.webp`       | Card WhatsApp (conversa com lembrete + confirmação) |
| `prontuario.webp`     | Card Prontuário                                     |
| `telepsicologia.webp` | Card Telepsicologia (sala de vídeo)                 |
| `evolucao.webp`       | Card IA; "depois" do destaque IA (evolução gerada)  |

> Nota técnica (Figma MCP): uploads em **WebP não renderizaram** no preview do Figma;
> foram convertidos para PNG só para o mock. Em produção, **WebP é o formato alvo**.

---

## 10. Acessibilidade (WCAG 2.1 AA) — checklist

- Contraste ≥ 4.5:1 (texto) / 3:1 (texto grande e UI). Botão primário usa `brand/600` por isso.
- Navegação por teclado completa; foco visível (`Focus/*/ring`) em todo interativo.
- Alt-text em todas as imagens/screenshots; landmarks ARIA `header`/`main`/`footer`; skip link.
- Alvos de toque ≥ 44×44px no mobile.
- Hierarquia de headings correta (1 `h1` por página).
- `prefers-reduced-motion`: desativa fade-in de scroll, transições de carrossel e auto-play.
- FAQ acessível via `<details>/<summary>` (funciona sem JS).

---

## 11. Modo escuro

Todas as telas foram construídas com **tokens cientes de modo** (`color/*` com modos
Light/Dark). Em código, o modo escuro já é dirigido por `[data-theme='dark']` sobre as
`--ds-*` em `globals.css` — portanto **as páginas públicas herdam dark mode automaticamente**
ao usar as classes/vars do DS (RNF-14.07). O footer foi desenhado nativamente em dark e
serve de referência de contraste.

> Observação: um preview estático de dark mode no Figma foi descartado por um _glitch_ de
> renderização do plugin em seções aninhadas (a API confirma o modo resolvido, mas o
> repaint de um fill específico não atualiza). Isso é exclusivo do preview do Figma e **não
> afeta o código** — os bindings de cor estão todos prontos para os dois modos.

---

## 12. Itens em aberto / decisões de stakeholder

- **Nome do produto:** usei **"Hubrity"** no header/footer/legais (repo, empresa, logomark).
  Confirmar se o nome público é Hubrity (e não "Sálvia", que é o nome do design system).
- **Estilos `Display/*` + `Lead`:** precisam ser adicionados ao DS em código + `rules.md`.
- **Token de botão primário:** recomendo padronizar `brand/600` (AA) para o contexto público.
- **SEO/Analytics:** `og:image`, sitemap, robots e o gate de analytics por consentimento são
  responsabilidade de implementação (não visuais) — ver RNF-14.06 e critérios de aceite.
