## Why

A identidade visual da Hubrity (símbolo + lockups) já foi criada e está versionada em `public/brand/`, mas nenhuma superfície do produto a usa: o cabeçalho do app e todas as páginas públicas ainda mostram a marca como texto puro `HubrityP`. Além de não aproveitar a logomarca, esse texto contradiz o nome canônico da marca — o wordmark oficial soletra **"hubrity"** (minúsculo, sem "P"). Trocar o texto pela logomarca alinha o produto à sua identidade e elimina a inconsistência visual.

## What Changes

- **Novo componente `<Logo>`** em `src/shared/ui/logo.tsx`, renderizando os assets de marca como **SVG inline** (não `next/image`), com:
  - `variant`: `"lockup-h"` | `"lockup-v"` | `"symbol"`
  - `tone`: `"color"` | `"white"` | `"mono"` (mono/white via `currentColor`, sem multiplicar arquivos)
  - nome acessível embutido (`role="img"`, `<title>`/`aria-label="Hubrity"`)
- **Header autenticado** (`src/app/(app)/layout.tsx`): substitui `<span>HubrityP</span>` pela logo — **lockup horizontal no desktop, símbolo-só abaixo do breakpoint `md`** (regra do manual: lockup mín. 120px de largura; abaixo disso, só o símbolo). A logo **continua não-interativa** (não vira link) — preserva o comportamento atual.
- **Layouts públicos** que hoje exibem o texto centralizado passam a usar a logo (lockup vertical) centralizada: `src/app/termo/layout.tsx`, `src/app/escala/layout.tsx`, `src/app/confirmar-sessao/layout.tsx`, `src/app/v/[token]/layout.tsx`.
- **Home** (`src/app/page.tsx`): o `<h1>` de texto vira lockup vertical em destaque.
- **(auth) login/signup** (opcional, sem inflar escopo): adicionar a logo centralizada onde hoje não há marca.
- **Fora de escopo (follow-up separado):** o rename textual de `"HubrityP"` → `"Hubrity"` em `metadata`/titles, e-mails transacionais, copy e `og-image`. Esta change troca apenas a **apresentação da marca**, não renomeia o produto nos textos.

## Capabilities

### New Capabilities
- `brand-logo`: componente de marca reusável e as regras de uso dos assets de identidade — variantes (lockup horizontal/vertical, símbolo), tonalidades (color/white/mono), renderização como SVG inline, regra de tamanho mínimo (símbolo abaixo de 120px de largura) e requisitos de acessibilidade (nome acessível "Hubrity").

### Modified Capabilities
- `app-shell`: o cabeçalho do app autenticado passa a renderizar a logomarca (lockup no desktop, símbolo no mobile) no lugar do wordmark textual `HubrityP`, mantendo a marca não-interativa.

## Impact

- **Código (apresentação apenas):** novo `src/shared/ui/logo.tsx`; edições em `src/app/(app)/layout.tsx`, `src/app/page.tsx`, `src/app/termo/layout.tsx`, `src/app/escala/layout.tsx`, `src/app/confirmar-sessao/layout.tsx`, `src/app/v/[token]/layout.tsx` e, opcionalmente, `src/app/(auth)/layout.tsx`.
- **Assets:** consome os SVGs já existentes em `public/brand/` (`simbolo*.svg`, `lockup-horizontal*.svg`, `lockup-vertical.svg`); nenhum asset novo precisa ser criado.
- **Sem impacto em segurança/dados:** não cria rota nova, não toca `middleware.ts`, auth, RLS, Server Actions, banco ou integrações externas. O critério de negative-auth test não se aplica (nenhuma superfície gated nova). Validação cobre quality gates (`lint`/`typecheck`) + teste de presença/acessibilidade do componente `<Logo>`.
- **Fontes:** o wordmark do lockup é texto vetorizado — não introduz dependência da fonte Nunito.
- **Documentação:** o padrão "sempre `next/image`" do CLAUDE.md ganha uma exceção justificada (logo SVG inline) — a ser documentada no comentário do componente e no design.
