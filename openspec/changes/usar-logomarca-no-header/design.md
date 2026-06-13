## Context

A marca aparece hoje como texto puro `HubrityP` em sete superfícies (header autenticado, home, quatro layouts públicos de paciente, e ausente nas telas de auth). Os assets oficiais já existem em `public/brand/` (símbolo em 3 tons e lockups horizontal/vertical, todos SVG com texto vetorizado), mas nenhum é consumido pelo código. O nome canônico da marca é **"hubrity"** (decisão tomada na exploração; o wordmark oficial é minúsculo e sem "P").

Restrições relevantes:
- Padrão do projeto: "sempre `next/image`, nunca `<img>`". A logo é a exceção clássica — precisamos retintar via `currentColor` (tons mono/white) e evitar requests para marcas pequenas e estáticas.
- `src/shared/**` não pode importar de `src/modules/**`; o componente vive em `src/shared/ui/` (primitivos), sem dependência de domínio.
- Layouts são Server Components; a troca desktop/mobile do header precisa ser SSR-safe (sem `window`).
- O rename textual `HubrityP` → `Hubrity` (metadados, e-mails, copy) é **change separada**; aqui só muda apresentação da marca.

Geometria dos assets (confirmada): símbolo = 3 `<rect>` arredondados (hastes sálvia `#587355` / azul `#5B7A93` + elo teal `#3F6F63`); wordmark "hubrity" = 7 `<path>` em tinta `#21261F`. As variantes `-mono`/`-branco` são os mesmos shapes com `fill` `#21261F`/`#FFFFFF`.

## Goals / Non-Goals

**Goals:**
- Um único componente `<Logo>` em `src/shared/ui/logo.tsx` cobrindo as 3 variantes × 3 tons a partir de uma fonte única.
- Substituir o wordmark textual por logo no header autenticado, home e layouts públicos.
- Header responsivo: lockup horizontal no desktop, símbolo no mobile (regra de tamanho mínimo do manual).
- Acessibilidade preservada: nome acessível "Hubrity" em todas as variantes.
- Não regredir comportamento (logo permanece não-interativa) nem auth gating.

**Non-Goals:**
- Renomear "HubrityP" → "Hubrity" em metadados/titles/e-mails/copy/og-image (follow-up separado).
- Tornar a logo um link para `/dashboard` (decisão explícita: sem mudança de comportamento).
- Trocar a fonte de UI (Inter) ou introduzir a fonte Nunito (wordmark é vetorizado).
- Criar novos assets de marca.

## Decisions

### D1 — SVG inline escrito no componente, não `next/image` nem import de `.svg`

A geometria dos marks (3 rects + 7 paths) é embutida diretamente no JSX de `logo.tsx`. Para `tone="color"` os rects do símbolo usam os hex de marca e o wordmark usa tinta; para `mono`/`white` todos os `fill` resolvem para `currentColor`.

- **Por quê:** é a única forma de servir os 3 tons de uma fonte só (retinte via `currentColor`) e de garantir zero request extra. `next/image` rasteriza/serve o arquivo e não permite `currentColor`.
- **Alternativas consideradas:**
  - *`next/image` + 3 arquivos por variante* → multiplica arquivos, sem theming via CSS, request por variante. Rejeitado.
  - *Importar `.svg` como componente React (SVGR / `?react`)* → exige configurar loader no Next (não existe hoje) e ainda assim teríamos que reescrever fills para `currentColor`. Custo de build sem ganho. Rejeitado.
- **Custo:** verbosidade no componente (paths do wordmark). Aceitável: conjunto fixo e pequeno de marks. O comentário do arquivo documenta a exceção ao "sempre next/image".

### D2 — Matriz variant × tone

```
            tone="color"                tone="mono"        tone="white"
symbol      rects: sálvia/azul/teal     fill currentColor   fill currentColor (default text-white)
lockup-h    símbolo color + wordmark    tudo currentColor   tudo currentColor (default text-white)
            tinta #21261F
lockup-v    idem lockup-h (empilhado)   tudo currentColor   tudo currentColor (default text-white)
```

- `mono`: `fill="currentColor"` → herda a cor do texto do contêiner (caller decide).
- `white`: também `currentColor`, mas o componente aplica `text-white` por padrão para "funcionar pronto" sobre fundos escuros (vídeo, headers escuros futuros). Mantém a semântica de currentColor da spec e a flexibilidade.
- API: `<Logo variant="lockup-h" tone="color" className="h-8" />`. `className` passa para o `<svg>` (sizing por `h-*`, largura automática via `viewBox`). Defaults: `variant="lockup-h"`, `tone="color"`.

### D3 — Header responsivo SSR-safe (duas instâncias + CSS)

O header renderiza **duas** instâncias e alterna por classes Tailwind, sem JS:
```tsx
<Logo variant="lockup-h" className="hidden h-7 md:block" />   {/* desktop */}
<Logo variant="symbol"   className="h-7 md:hidden" />          {/* mobile  */}
```
- **Por quê:** Server Component não acessa viewport; CSS resolve no first paint, sem layout shift nem flash.
- **A11y:** usar `hidden` (`display:none`) remove a cópia fora do breakpoint da árvore de acessibilidade → o nome "Hubrity" é anunciado **uma** vez. (Não usar `visibility`/`opacity`, que mantêm o nó acessível e duplicariam o anúncio.)
- Respeita o `pl-14 md:pl-6` já existente (espaço do toggle do sidebar no mobile) e a regra do manual (lockup ≥ 120px; abaixo, símbolo).

### D4 — Acessibilidade

`<svg role="img" aria-label="Hubrity">` + `<title>Hubrity</title>` interno. A variante `symbol` (sem wordmark visível) carrega o mesmo nome acessível — assistive tech anuncia "Hubrity", nunca vazio nem "H". Decorativa em todo lugar (sem link), conforme comportamento atual.

### D5 — Superfícies e variantes

| Superfície | Arquivo | Variante | Tom |
|---|---|---|---|
| Header app (desktop) | `src/app/(app)/layout.tsx` | lockup-h | color |
| Header app (mobile) | idem | symbol | color |
| Home | `src/app/page.tsx` | lockup-v (destaque) | color |
| Termo / Escala / Confirmar-sessão / Vídeo | `src/app/{termo,escala,confirmar-sessao,v/[token]}/layout.tsx` | lockup-v centralizado | color |
| (auth) login/signup | `src/app/(auth)/layout.tsx` | lockup-v centralizado | color | *(opcional, ver Open Questions)* |

### D6 — Plano de testes

- **Unit (Vitest + RTL)** em `src/__tests__/unit/shared/ui/logo.test.tsx`: nome acessível "Hubrity" (`getByRole('img', { name: 'Hubrity' })`); presença de `<svg>` inline e ausência de `<img>`; `variant="symbol"` não renderiza o wordmark mas mantém o nome acessível; `tone="mono"` usa `currentColor`; logo não é link.
- **E2E (Playwright seeded)** — atualizar asserções existentes que quebram:
  - `src/__tests__/e2e/seeded/smoke.spec.ts:15` — `getByRole('heading', { name: 'HubrityP' })` → `getByRole('img', { name: 'Hubrity' })` na home.
  - `src/__tests__/e2e/seeded/whatsapp/whatsapp-health-banner.spec.ts:158` — `getByText('HubrityP')` (header) → asserção da logo (`getByRole('img', { name: 'Hubrity' })`).

## Risks / Trade-offs

- **[Testes e2e existentes quebram]** dois specs afirmam o texto "HubrityP" (home e header) → Mitigação: atualizá-los na mesma change (listados em D6); sem isso a suíte fica vermelha. O delta de `app-shell` já reflete a nova asserção.
- **[Anúncio duplicado de "Hubrity" no header]** duas instâncias no DOM → Mitigação: alternância via `hidden`/`display:none`, que exclui o nó oculto da árvore de acessibilidade.
- **[Verbosidade do SVG inline]** os 7 paths do wordmark engordam `logo.tsx` → Mitigação: isolado num único arquivo de UI; geometria copiada fielmente dos assets versionados; comentário explica a origem.
- **[Drift visual asset ↔ componente]** se os `.svg` em `public/brand/` mudarem, o componente não atualiza sozinho → Mitigação: comentário apontando os arquivos-fonte; assets de marca raramente mudam (manual no Figma).
- **[CSP / inline SVG]** SVG inline é markup, não script — não afeta a CSP existente (sem `style`/`script` inline). Sem impacto.

## Migration Plan

1. Criar `src/shared/ui/logo.tsx` + teste unitário.
2. Trocar o `<span>` do header (`(app)/layout.tsx`) pelas duas instâncias responsivas.
3. Trocar home (`page.tsx`) e os 4 layouts públicos.
4. (Opcional) Adicionar logo aos layouts `(auth)`.
5. Atualizar os 2 specs e2e que asseguravam "HubrityP".
6. Quality gates: `lint` + `typecheck`; rodar unit + e2e seeded afetados.

**Rollback:** mudança puramente de apresentação, sem migração de dados nem schema. Reverter é `git revert` do commit — nenhum estado persistido muda.

## Open Questions

- **(auth) login/signup:** incluir a logo agora (hoje não têm marca) ou deixar para depois? Default proposto: incluir lockup-v centralizado, por ser baixo custo e coerente — mas é o único item "novo elemento" (não é substituição). Pode ser cortado sem afetar o resto se quiser manter o escopo mínimo.
- **Tamanho exato na home:** lockup-v em qual altura (ex.: `h-24`)? Detalhe de DS a definir na implementação, sem impacto de arquitetura.
