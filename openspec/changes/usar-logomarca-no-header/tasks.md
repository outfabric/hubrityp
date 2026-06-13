## 1. Componente `<Logo>` (shared/ui)

- [x] 1.1 Criar `src/shared/ui/logo.tsx` como componente reusável de SVG inline. Props: `variant` (`"lockup-h"` | `"lockup-v"` | `"symbol"`, default `"lockup-h"`), `tone` (`"color"` | `"white"` | `"mono"`, default `"color"`) e `className` (repassado ao `<svg>` para sizing via `h-*`). Embutir a geometria dos assets de `public/brand/` (símbolo = 3 rects arredondados; wordmark "hubrity" = 7 paths). Comentar no topo do arquivo a exceção justificada ao padrão "sempre next/image" (necessidade de `currentColor` para mono/white e zero request) e apontar os arquivos-fonte em `public/brand/`.
- [x] 1.2 Implementar a matriz variant × tone: `tone="color"` → rects do símbolo em sálvia `#587355` / azul `#5B7A93` / teal `#3F6F63` e wordmark em tinta `#21261F`; `tone="mono"` → todos os fills em `currentColor`; `tone="white"` → fills em `currentColor` com `text-white` aplicado por padrão. `variant="symbol"` omite o grupo do wordmark.
- [x] 1.3 Acessibilidade: `<svg role="img" aria-label="Hubrity">` com `<title>Hubrity</title>` interno em todas as variantes (inclusive `symbol`). Garantir que o mark é não-interativo (sem `<a>`/`<button>` envolvente).
- [x] 1.4 Escrever teste unitário `src/__tests__/unit/shared/ui/logo.test.tsx` (Vitest + RTL): (a) `getByRole('img', { name: 'Hubrity' })` resolve para os 3 variants; (b) saída contém `<svg>` inline e nenhum `<img>`; (c) `variant="symbol"` mantém o nome acessível "Hubrity" e não renderiza o wordmark; (d) `tone="mono"` usa `currentColor`; (e) `tone="color"` preserva os hex de marca; (f) a logo não é um link.

## 2. Header autenticado

- [x] 2.1 Em `src/app/(app)/layout.tsx`, substituir `<span className="text-lg font-semibold">HubrityP</span>` por duas instâncias responsivas, SSR-safe via CSS: `<Logo variant="lockup-h" className="hidden h-7 md:block" />` (desktop) e `<Logo variant="symbol" className="h-7 md:hidden" />` (mobile). Usar `hidden` (`display:none`) para excluir a cópia oculta da árvore de acessibilidade. Preservar o layout/espaçamento existente (`pl-14 md:pl-6`) e o caráter não-interativo.
- [x] 2.2 Atualizar o e2e `src/__tests__/e2e/seeded/whatsapp/whatsapp-health-banner.spec.ts` (linha ~158): trocar `getByText('HubrityP')` por `getByRole('img', { name: 'Hubrity' })` para confirmar a presença da logo no header.

## 3. Home e layouts públicos

- [ ] 3.1 Em `src/app/page.tsx`, substituir o `<h1>HubrityP</h1>` pela `<Logo variant="lockup-v" />` em destaque (altura de DS, ex. `h-24`), mantendo a semântica de cabeçalho/centralização da página.
- [ ] 3.2 Substituir o `<span>HubrityP</span>` centralizado pela `<Logo variant="lockup-v" />` nos quatro layouts públicos: `src/app/termo/layout.tsx`, `src/app/escala/layout.tsx`, `src/app/confirmar-sessao/layout.tsx`, `src/app/v/[token]/layout.tsx`. Não alterar a classificação de auth dessas rotas (seguem públicas).
- [ ] 3.3 Atualizar o e2e `src/__tests__/e2e/seeded/smoke.spec.ts` (linha ~15): trocar `getByRole('heading', { name: 'HubrityP' })` por `getByRole('img', { name: 'Hubrity' })` na home; ajustar o título do teste se mencionar "HubrityP heading".

## 4. Telas de auth (opcional)

- [ ] 4.1 (Opcional) Em `src/app/(auth)/layout.tsx`, adicionar `<Logo variant="lockup-v" />` centralizada onde hoje não há marca. Cortável sem afetar o resto do escopo; se incluído, não introduzir link nem alterar gating.

## 5. Validação

- [ ] 5.1 Rodar `npm run lint` e `npm run typecheck` — ambos verdes.
- [ ] 5.2 Rodar `npm run test:unit` (inclui `logo.test.tsx`) e os e2e seeded afetados (`smoke.spec.ts`, `whatsapp-health-banner.spec.ts`) — verdes.
- [ ] 5.3 Conferência visual: header desktop (lockup) vs mobile (símbolo), home, layouts públicos e (se incluído) auth renderizam a logo corretamente nos tons esperados.
