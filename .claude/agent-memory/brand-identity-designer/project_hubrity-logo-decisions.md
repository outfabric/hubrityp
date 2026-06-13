---
name: hubrity-logo-decisions
description: Decisões de discovery travadas para a logo/identidade do Hubrity (tipo, cor, alma do símbolo, nome)
metadata:
  type: project
---

Decisões confirmadas pelo fundador em 2026-06-13 (sessão de discovery da logo):

- **Origem do nome "Hubrity":** escolhido por sonoridade/disponibilidade — **sem trocadilho literal pré-definido**. Tenho liberdade para atribuir o conceito visual (não forçar narrativa "Hub = central" como obrigatória, embora possa explorar).
- **Tipo de logo:** **combinação** (símbolo + wordmark). Símbolo isolado deve funcionar como favicon/avatar; combinação completa no header.
- **Cor:** **verde-sálvia como âncora (brand-500 #6b8a66) + um acento de confiança** (ex: azul-sereno). Cuidar para não violar a regra Sálvia de ≤3 cores funcionais por tela.
- **Alma do símbolo (prioridade nº1):** **cuidado / humano / psicologia**. Se houver trade-off, sacrificar "centralização/hub" e "escudo/proteção" em favor de acolhimento/escuta/presença. Evitar clichês: cérebro, cabeça com engrenagem, lótus, borboleta, coração.

**DIREÇÃO FINAL APROVADA (2026-06-13, após pivô): "Escuta" (a dupla terapêutica).**

Histórico: a Direção 3 "Sálvia" (folha que cura) foi construída no Figma e **rejeitada** ao ver pronta — fundador pediu para abortar e ir pela Direção 2 "Escuta" em arquivo novo. Lição: a narrativa do **vínculo psi↔paciente** conecta mais com a alma do produto do que a metáfora de cura/folha (que arriscava clichê wellness). Arquivo da folha (rejeitado): `QvRO1K3BfQrRRmwnN4ylNq`.

**SÍMBOLO FINAL ESCOLHIDO (2026-06-13): "Elo (H)".** Após esboçar 3 execuções da "Escuta" (Elo-H / Diálogo "( • )" / Escuta-ondas), o fundador escolheu **Elo (H)**. Execuções rejeitadas dentro da Direção 2: figuras tipo peça-de-xadrez (cabeça+corpo) e sobreposição de duas elipses (Venn genérico).
- Símbolo: **monograma "H"** = duas presenças verticais (haste esquerda em sálvia `presenca-a`, direita em azul `presenca-b`) unidas por uma **ponte/travessa em teal** (`logo/encontro`) = o vínculo terapêutico / a empatia / o "feito por psi para psi". É a inicial de Hubrity + a dupla.
- Por que ganhou: ownable (amarra ao nome), brandável, ótimo favicon, conta a história do vínculo. Hastes com pontas arredondadas (cápsula) = calma.
- Arquivo: `4O3POARuvEYI1BCrxbOFg2`.
- Token novo criado: `logo/encontro` (teal) — Primitivos `encontro/500 #3f6f63`, `encontro/300 #8fb8ad`.

**Direção 2 "Escuta" (contexto do conceito):**
- Símbolo: **duas presenças arredondadas** (formas verticais/gota) inclinadas uma para a outra, com um vão calmo entre elas = o *espaço relacional* da terapia. Uma em sálvia, a outra no acento azul → a dupla / a aliança. Vão negativo pode insinuar um "H" (Hubrity).
- Conceito: escuta, presença, vínculo, "feito por psi para psi". Liderar pelo cuidado/humano (atributo nº1).
- Cor: presença esquerda `brand-600 #587355`, direita `acento/info-500 #5b7a93`. ≤3 cores (sálvia + azul + tinta).
- Wordmark: "Hubrity" em Inter Semi Bold (84/-2.5% tracking funcionou bem no teste anterior).
- **Anti-clichê:** evitar duas pessoas literais/ícone de "contato", coração, balão de fala óbvio. Manter geométrico, calmo, abstrato.
- Reaproveitar abordagem de tokens (coleções Primitivos + Cor da Marca com Claro/Escuro) já validada.

**ENTREGUE (2026-06-13).** Identidade visual completa construída no Figma.
- **fileKey:** `4O3POARuvEYI1BCrxbOFg2` (arquivo "Hubrity — Marca & Identidade Visual (Escuta)").
- **Componentes** (página "Marca · Componentes"): `Logo / Símbolo` (id 16:7), `Logo / Lockup Horizontal` (17:2), `Logo / Lockup Vertical` (17:8). Todos com fills ligados a tokens.
- **Tokens:** coleção `Primitivos` (sálvia 50–900, acento/azul 400/500/700, encontro/teal 300/500, tinta/papel/papel-suave) + `Cor da Marca` (semânticos com modos Claro/Escuro: logo/presenca-a, logo/presenca-b, logo/encontro, logo/wordmark, fundo/*, texto/*). Code syntax WEB `var(--ds-*)` para round-trip com globals.css.
- **Manual (páginas):** Capa, A Marca, Logo & Construção (versões, espaço livre, tamanho mínimo), Cor, Tipografia, Aplicações (ícone de app, favicon 16/32/48, avatar, header do produto, fundos cor/invertido/mono, usos incorretos).
- Símbolo "H": haste A em `brand-600`, haste B em `acento/info-500`, travessa (elo) em `encontro/teal`. Pontas em cápsula. Lê a 16px.
- Wordmark: **Nunito SemiBold, em minúsculas ("hubrity"), tracking -1%**. Decisão após o fundador rejeitar o Inter Semi Bold ("Hubrity") — a tipografia não compunha com o símbolo. Diagnóstico: (1) "stutter" do H (símbolo é um H + wordmark começava com H maiúsculo); (2) descompasso de forma (Inter reto vs. símbolo arredondado). Solução: minúsculas (símbolo vira o "H" inicial da palavra) + Nunito (terminais arredondados conversam com a cápsula). Explorei 16 tipografias lado a lado com o símbolo antes da escolha. Inter segue como fonte do PRODUTO/UI; Nunito é exceção exclusiva do wordmark da marca.

**ASSETS EXPORTADOS (2026-06-13):** em `public/brand/` (simbolo.svg / -branco / -mono, lockup-horizontal.svg / -branco, lockup-vertical.svg — texto vetorizado, transparentes; og-image.png 1200×630) e em `src/app/` (icon.svg favicon, apple-icon.png 360², opengraph-image.png + twitter-image.png — auto-detectados pelo Next App Router). README em `public/brand/README.md`. Página "Export" no Figma guarda os artboards-fonte. Gotcha: `download_assets` injeta um `<rect fill="#F5F5F5">` (fundo da página) — removido via sed nos SVGs.

**Pendências/futuro:** mapear tokens via Code Connect para `globals.css`; adicionar `--ds-encontro-*` (teal) ao código se adotado no produto; aplicar lockup no header real (PRD 14).
**GOTCHA Figma (logo/componentes):** os filhos vetoriais/retângulos do componente `Símbolo` DEVEM ter `constraints = {horizontal:'SCALE', vertical:'SCALE'}`. Com o default `MIN/MIN`, ao dar `rescale` numa instância de LOCKUP (que aninha uma instância do símbolo), o símbolo aninhado NÃO escala junto e sobrepõe o wordmark. Sintoma: "Hhubrity" colado no header/tiles. Correção: setar SCALE nos filhos do símbolo e re-instanciar os lockups (instância nova nasce limpa). Símbolos instanciados direto (sem aninhar) já escalavam ok.

**How to apply:** reusar os componentes do fileKey acima; manter execução geométrica e tokens; garantir SCALE constraints antes de escalar lockups. Ver [[hubrity-brand-brief]] e [[salvia-design-system]].
