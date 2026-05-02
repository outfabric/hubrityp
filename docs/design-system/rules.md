# Design System — Sálvia

Sistema visual do SaaS para psicólogos. **Sempre seguir.** Sobre regras gerais, sempre prevalecem.

## Filosofia (4 regras)

1. **Calmo antes de bonito** — interface se faz invisível, paciente é a estrela
2. **Funcional antes de decorativo** — cada elemento justifica presença
3. **Consistência radical** — mesma ação = mesmo padrão visual
4. **Acessível por padrão** — WCAG 2.1 AA mínimo

## Proibições absolutas

- ❌ Gradientes (botões, fundos, cards — em nada)
- ❌ Sombras coloridas
- ❌ Mais de 3 cores funcionais por tela
- ❌ Glassmorphism, blur, glow, neon
- ❌ Cores saturadas como elemento principal (90% da UI é neutro)
- ❌ Emojis na UI do produto (exceto em mensagens enviadas a paciente)
- ❌ Ilustrações coloridas decorativas
- ❌ Animações dramáticas (>300ms ou bouncing)
- ❌ Pesos de fonte 700+ em texto longo
- ❌ Mais de 3 tamanhos de fonte por tela (excluindo h1/h2)
- ❌ Cards aninhados (mais de 1 nível)
- ❌ Tooltip para informação crítica ou erro de validação
- ❌ Underline em botão ou item de navegação

## Tokens — colar em `globals.css` e `tailwind.config.ts`

```css
:root {
  /* Backgrounds */
  --color-background: #fafaf9;
  --color-surface: #ffffff;
  --color-surface-muted: #f5f5f4;
  --color-surface-sunken: #f0efec;

  /* Borders */
  --color-border: #e7e5e4;
  --color-border-strong: #d6d3d1;
  --color-border-subtle: #efedeb;

  /* Text */
  --color-text-primary: #1c1917;
  --color-text-secondary: #57534e;
  --color-text-tertiary: #78716c;
  --color-text-disabled: #a8a29e;
  --color-text-inverse: #fafaf9;

  /* Brand — verde-sálvia */
  --color-brand-50: #f2f5f1;
  --color-brand-100: #e1e8de;
  --color-brand-200: #c2d1bc;
  --color-brand-300: #a0b89a;
  --color-brand-400: #7e9e78;
  --color-brand-500: #6b8a66;
  --color-brand-600: #587355;
  --color-brand-700: #475d45;
  --color-brand-800: #364937;
  --color-brand-900: #2a382b;

  /* Semânticas */
  --color-success-50: #f0f7f1;
  --color-success-500: #5c8c61;
  --color-success-700: #3f6644;
  --color-warning-50: #fbf6ec;
  --color-warning-500: #c28a3d;
  --color-warning-700: #8c6128;
  --color-danger-50: #fbf1ef;
  --color-danger-500: #b0594b;
  --color-danger-700: #813f33;
  --color-info-50: #eff3f6;
  --color-info-500: #5b7a93;
  --color-info-700: #3f5870;

  /* Tipografia */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  /* Espaçamento — base 4px */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --space-24: 6rem;

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.625rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 1rem;
  --radius-full: 9999px;

  /* Shadows — sutis, neutras, nunca coloridas */
  --shadow-xs: 0 1px 2px 0 rgb(28 25 23 / 0.04);
  --shadow-sm: 0 1px 3px 0 rgb(28 25 23 / 0.06), 0 1px 2px 0 rgb(28 25 23 / 0.04);
  --shadow-md: 0 4px 8px -2px rgb(28 25 23 / 0.08), 0 2px 4px -2px rgb(28 25 23 / 0.04);
  --shadow-lg: 0 12px 24px -4px rgb(28 25 23 / 0.1), 0 4px 8px -2px rgb(28 25 23 / 0.05);
  --shadow-focus: 0 0 0 3px rgb(107 138 102 / 0.2);

  /* Animação */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

[data-theme='dark'] {
  --color-background: #1c1917;
  --color-surface: #292524;
  --color-surface-muted: #1f1d1b;
  --color-surface-sunken: #14110f;
  --color-border: #3a3633;
  --color-border-strong: #4d4845;
  --color-border-subtle: #2d2a28;
  --color-text-primary: #fafaf9;
  --color-text-secondary: #d6d3d1;
  --color-text-tertiary: #a8a29e;
  --color-text-disabled: #6b6663;
  --color-text-inverse: #1c1917;
  --color-brand-50: #2a382b;
  --color-brand-100: #364937;
  --color-brand-500: #8aab85;
  --color-brand-600: #9dbe98;
  --color-brand-700: #b0d1ab;
  --color-success-50: #1f2d22;
  --color-success-500: #7da682;
  --color-warning-50: #2a2418;
  --color-warning-500: #d9a55a;
  --color-danger-50: #2a1814;
  --color-danger-500: #c97565;
  --color-info-50: #1a2330;
  --color-info-500: #7b97ae;
}
```

## Regras de uso de cor

**Brand (verde-sálvia) APENAS em:**

- Botão primário
- Item ativo de sidebar/nav
- Indicador de estado "ativo" (toggle on, checkbox checked)
- Anel de foco
- Logo
- Avatar fallback

**Brand NUNCA em:**

- Headers ou banners decorativos
- Cards normais
- Tabelas
- Texto comum
- Cor de fundo de página

**Semânticas (success/warning/danger/info) APENAS em:**

- Mensagens de feedback contextual
- Badges de status
- Alertas
- Ícones funcionais associados ao status

**Texto sobre fundo colorido:** sempre usar tom 700 da mesma família (ex: badge `success-50` bg + `success-700` text). Nunca preto puro nem cinza genérico.

## Tipografia

**Família única:** Inter via `next/font` (self-host).

**Escala (base 1.125 modular):**
| Token | Tamanho | Peso | Uso |
|---|---|---|---|
| h1 | 28px | 600 | Título de página dentro do app |
| h2 | 22px | 600 | Título de seção em página |
| h3 | 18px | 600 | Título de card / modal |
| h4 | 16px | 500 | Sub-título |
| body-lg | 17px | 400 | Leitura longa (prontuário) |
| body | 15px | 400 | Texto padrão |
| body-sm | 13px | 400 | Meta, helpers |
| caption | 12px | 500 | Labels, badges |
| caption-upper | 12px | 500 + tracking 0.06em + uppercase | Eyebrow, section labels |

**Pesos:** 400 (regular) e 600 (semibold). Apenas. Nunca 700+ em texto longo.

**Line-height:** 1.25 (headings), 1.5 (body), 1.65 (leitura longa).

**Linha máxima de leitura:** 72ch ou 720px em prontuário/evoluções.

**Italic:** apenas citações e termos técnicos. Underline: apenas links em texto corrido.

## Espaçamento

Tudo múltiplo de 4. Convenções:

- Padding interno input/botão (vertical): `space-2` a `space-3`
- Padding de card: `space-6`
- Padding de modal: `space-8` (mobile: `space-6`)
- Gap entre items de lista: `space-3` ou `space-4`
- Gap entre seções: `space-12`
- Gap label → input: `space-2`
- Padding lateral página (mobile): `space-4`
- Padding lateral página (desktop): `space-8`
- Largura máxima de conteúdo: 1200px (geral), 720px (leitura longa)

## Radius

| Token  | Tamanho | Uso                           |
| ------ | ------- | ----------------------------- |
| `sm`   | 4px     | Badges, tags pequenas         |
| `md`   | 8px     | Inputs, botões pequenos       |
| `lg`   | 10px    | Botões padrão, cards pequenos |
| `xl`   | 12px    | Cards padrão                  |
| `2xl`  | 16px    | Modais, painéis grandes       |
| `full` | 9999px  | Avatares, pills               |

## Animação

**Durações:** 150ms (hover), 200ms (default), 300ms (modal/drawer). Nunca >300ms.

**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out) é o default.

**Sempre respeitar `prefers-reduced-motion`:**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Componentes — variantes

### Button

| Variante    | Visual                                               | Uso                             |
| ----------- | ---------------------------------------------------- | ------------------------------- |
| `primary`   | bg `brand-500`, text `inverse`                       | Ação principal — 1 por contexto |
| `secondary` | bg `surface`, border `border-strong`, text `primary` | Ações secundárias               |
| `ghost`     | transparent, hover bg `surface-muted`                | Toolbars, ações terciárias      |
| `outline`   | transparent + border, text `primary`                 | Alternativa ao secondary        |
| `danger`    | bg `danger-500`, text `inverse`                      | Deletar, cancelar               |
| `link`      | sem fundo, text `brand-700`, underline em hover      | Navegação textual               |

**Tamanhos:** sm (32px h, 13px font), md (40px h, 15px font — default), lg (48px h, 16px font).

**Estados:** idle, hover (-600 brand / surface-muted), active (-700 / scale 0.98), focus (shadow-focus), disabled (50% opacity), loading (spinner substitui ícone esquerdo).

**Regra:** loading state obrigatório em ação assíncrona >300ms. Largura: hugs content por default; full-width em forms mobile.

### Input

- Idle: border `border`, bg `surface-sunken`
- Focus: border `brand-500`, bg `surface`, ring `shadow-focus`
- Error: border `danger-500`, mensagem em `danger-700` abaixo
- Validação inline em **blur** (nunca em onChange)
- Mensagem de erro inline com ícone `AlertCircle`, nunca em tooltip
- Label sempre presente, associado via `for`/`id`
- Helper text em `text-tertiary`, 12px, abaixo do input
- Máscaras BR: telefone `+55 (DDD) NNNNN-NNNN`, CPF `XXX.XXX.XXX-XX`, CEP

### Card

- `default`: bg `surface`, border `border`, radius `xl`, shadow `xs`, padding `space-6`
- `flat`: igual mas sem shadow
- `interactive`: igual default + hover (border `border-strong`, cursor pointer)
- **Mobile padding:** `space-4`
- **Nunca:** cards aninhados, cards com cores diferentes em sequência

### Badge / Pill

- Altura 22px, padding `2px 10px`, radius `full`, font 12px weight 500
- Variantes: `neutral` (surface-muted bg + text-secondary), `brand` (brand-100 + brand-700), `success` / `warning` / `danger` / `info` (cada um tom 50 bg + tom 700 text)
- Nunca usar como botão (use `<button>` real)

### Avatar

- Circular `radius-full`
- Tamanhos: 24/32/40/56/80px (xs/sm/md/lg/xl)
- Fallback: iniciais sobre bg `brand-100`, text `brand-700`
- Sem outline, sem sombra

### Modal

- Backdrop: `rgb(28 25 23 / 0.4)`
- Container: bg `surface`, radius `2xl`, shadow `lg`
- Padding: `space-8` desktop, `space-6` mobile
- Max-width: 480px (sm), 640px (md), 800px (lg)
- Mobile: full-screen com slide-up
- Botão close (X) no canto superior direito
- Escape fecha; click fora fecha (configurável); foco vai para primeiro elemento focável
- **Use modal para:** confirmações, forms simples
- **NÃO use modal para:** wizards multi-passo (use página), edição complexa (use página dedicada)

### Drawer / Sheet

- Lateral right (desktop), bottom-up (mobile)
- Mesma identidade do modal com transição lateral
- **Use para:** filtros avançados, detalhes expandidos sem perder contexto

### Toast (Sonner)

- Variantes: default, success, error, warning
- Border-left de 4px na cor semântica (success-500, danger-500, warning-500)
- Posição: topo direito (desktop), topo central (mobile)
- Auto-dismiss: 4s default; `0` (manual) para erros importantes
- Conteúdo: 1 título + 1 descrição + 1 ação opcional

### Sidebar nav

- Largura 240px (desktop), full overlay (mobile)
- bg `surface-muted`
- Item idle: text `secondary`, padding `space-2 space-3`, radius `md`
- Item hover: text `primary`, bg `surface`
- Item active: text `brand-700`, bg `brand-50`, border-left 3px `brand-500`
- Agrupamento com label em caption-upper

### Tabs

- Underline tabs (não pills)
- Tab idle: text `secondary`
- Tab active: text `primary`, border-bottom 2px `brand-500`
- Padding `space-3 space-4`

### Tabela

- Header: bg `surface-muted`, text `secondary`, font 11px, weight 500, uppercase, tracking-wide
- Linhas: separadas por `border-subtle` (sem borda full)
- Hover: bg `surface-muted`
- Selected: bg `brand-50`
- Sticky header em listas longas
- **Mobile:** transformar em cards stackados, nunca scroll horizontal forçado

## Iconografia

**Lucide React exclusivo.** Stroke 1.5px, tamanho 16px (inline), 20px (default), 24px (destaque). Cor herda `currentColor`.

**Mapa fixo conceito → ícone:**

| Conceito                      | Ícone                                                     |
| ----------------------------- | --------------------------------------------------------- |
| Paciente / Pacientes          | `User` / `Users`                                          |
| Sessão / Agenda               | `Calendar`                                                |
| Prontuário                    | `FileText`                                                |
| Financeiro                    | `Wallet`                                                  |
| Receita Saúde / Recibo        | `Receipt`                                                 |
| WhatsApp                      | `MessageCircle`                                           |
| Vídeo                         | `Video`                                                   |
| IA                            | `Sparkles`                                                |
| Configurações                 | `Settings`                                                |
| Notificações                  | `Bell`                                                    |
| Buscar / Filtrar              | `Search` / `SlidersHorizontal`                            |
| Editar / Deletar              | `Pencil` / `Trash2`                                       |
| Mais opções                   | `MoreHorizontal`                                          |
| Confirmar / Cancelar          | `Check` / `X`                                             |
| Voltar / Próximo              | `ArrowLeft` / `ArrowRight`                                |
| Expandir                      | `ChevronDown`                                             |
| Adicionar                     | `Plus`                                                    |
| Save / Download / Upload      | `Save` / `Download` / `Upload`                            |
| Aviso / Erro / Sucesso / Info | `AlertTriangle` / `AlertCircle` / `CheckCircle2` / `Info` |
| Privado / Sair / Ajuda        | `Lock` / `LogOut` / `HelpCircle`                          |

**Regras:**

- Nunca emoji em substituição a ícone funcional
- Nunca colorir ícones com cores não-semânticas
- Ícones decorativos: `aria-hidden="true"`
- Ícones standalone: `aria-label` obrigatório

## Microcopy

**Glossário fixo (não trocar):**

- "Sessão" — não "consulta", não "atendimento"
- "Paciente" — neutro (configurável para "cliente")
- "Evolução" — não "anotação clínica" no botão
- "Agendar" / "Marcar sessão" — não "criar evento"
- "Cobrar" — não "emitir cobrança"
- "Emitir Receita Saúde" — não "emitir RPA"
- "Recibo" — para reembolso (separado de "Receita Saúde")
- "Lembrete" — para WhatsApp, não "notificação"
- "Configurações" — não "preferências"

**Tom:**

- Direto, não burocrático ("Salvar" não "Confirmar e prosseguir")
- Humano, não corporativo ("Algo deu errado" não "Erro inesperado")
- Profissional, não infantil (sem emojis, sem gírias)

**Botões:** começam com verbo no infinitivo ("Salvar", "Adicionar paciente"). Confirmações destrutivas usam verbo específico ("Excluir definitivamente" não "Confirmar").

**Mensagens de erro humanas:**

- ❌ `ValidationError: field 'phone' invalid format`
- ✅ `Telefone inválido. Use o formato (11) 98765-4321.`

## Padrões UX

**Confirmação destrutiva:** ações irreversíveis exigem modal com input "EXCLUIR" digitado para confirmar.

**Auto-save:** forms grandes (prontuário, anamnese) auto-save a cada 10s, com indicador "Salvo às HH:MM" em `text-tertiary`. Forms pequenos: save manual.

**Dirty state:** ao tentar sair com mudanças não salvas, modal "Você tem alterações não salvas" [Continuar editando] [Descartar].

**Optimistic update:** atualizar UI imediatamente, reverter se backend falhar.

**Empty state:** sempre 3 partes — o que está faltando, por que importa, o que fazer agora. Ícone Lucide em `text-tertiary`, headline h4, descrição em `text-secondary`, 1 CTA primário.

**Quando usar:**

- **Página dedicada:** listas, edição complexa, wizards, visualização de dados
- **Modal:** confirmações, forms simples, edição rápida
- **Drawer:** detalhes sem perder contexto, filtros avançados, comparações lado-a-lado

## Acessibilidade — checklist obrigatório

- Contraste 4.5:1 (texto normal), 3:1 (texto grande, ≥18px)
- Foco visível em todo elemento interativo (anel `shadow-focus`)
- Navegação por teclado completa (Tab, Shift+Tab, Enter, Escape, setas)
- Skip link "Pular para conteúdo" no topo
- Labels associados a inputs via `for`/`id` ou `aria-labelledby`
- `aria-label` em ícones standalone
- `aria-live` em regiões dinâmicas (toasts, alertas)
- Heading hierarchy correta (h1 único, sem pular níveis)
- Tamanho mínimo de área clicável: 44×44px em mobile
- Funciona com zoom 200%
- `prefers-reduced-motion` respeitado

## Responsividade

**Breakpoints (Tailwind defaults):** sm 640, md 768, lg 1024, xl 1280, 2xl 1536.

**Mobile-first sempre.** CSS escrito do menor para o maior:

```html
<!-- ❌ ruim -->
<div class="text-2xl lg:text-xl">
  <!-- ✅ bom -->
  <div class="text-lg md:text-xl lg:text-2xl"></div>
</div>
```

**Padrões de adaptação:**

- Sidebar fixa → bottom nav ou hamburger
- Tabela → cards stackados
- Modal → sheet bottom-up
- Multi-coluna form → coluna única
- Tooltip → texto inline

## Tailwind config — base mínima

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          muted: 'var(--color-surface-muted)',
          sunken: 'var(--color-surface-sunken)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
          subtle: 'var(--color-border-subtle)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          disabled: 'var(--color-text-disabled)',
          inverse: 'var(--color-text-inverse)',
        },
        brand: {
          50: 'var(--color-brand-50)',
          100: 'var(--color-brand-100)',
          200: 'var(--color-brand-200)',
          300: 'var(--color-brand-300)',
          400: 'var(--color-brand-400)',
          500: 'var(--color-brand-500)',
          600: 'var(--color-brand-600)',
          700: 'var(--color-brand-700)',
          800: 'var(--color-brand-800)',
          900: 'var(--color-brand-900)',
        },
        success: {
          50: 'var(--color-success-50)',
          500: 'var(--color-success-500)',
          700: 'var(--color-success-700)',
        },
        warning: {
          50: 'var(--color-warning-50)',
          500: 'var(--color-warning-500)',
          700: 'var(--color-warning-700)',
        },
        danger: {
          50: 'var(--color-danger-50)',
          500: 'var(--color-danger-500)',
          700: 'var(--color-danger-700)',
        },
        info: {
          50: 'var(--color-info-50)',
          500: 'var(--color-info-500)',
          700: 'var(--color-info-700)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        focus: 'var(--shadow-focus)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};

export default config;
```

## Componentes shadcn/ui — instalar

```bash
npx shadcn-ui@latest add button input textarea select checkbox radio-group switch label form
npx shadcn-ui@latest add toast tooltip alert dialog alert-dialog sheet separator
npx shadcn-ui@latest add card scroll-area tabs accordion table badge avatar
npx shadcn-ui@latest add dropdown-menu navigation-menu breadcrumb command popover calendar
```

## Decisão de quando aplicar

Toda nova UI deve:

1. Usar tokens (CSS vars / Tailwind classes) — nunca cores hardcoded
2. Verificar contraste WCAG 2.1 AA antes de commitar
3. Implementar dark mode em paralelo (não depois)
4. Usar componente do shadcn/ui customizado ao tema, não criar do zero
5. Usar ícone Lucide do mapa fixo, não escolher livremente
6. Seguir glossário de microcopy
7. Testar com teclado-only navigation
8. Testar em mobile 375px width
