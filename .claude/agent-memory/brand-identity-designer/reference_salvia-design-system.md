---
name: salvia-design-system
description: Âncora visual da logo Hubrity — tokens e proibições do design system Sálvia que a marca deve respeitar
metadata:
  type: reference
---

A logo do Hubrity deve nascer dentro do design system **Sálvia** (verde-sálvia). Fontes de verdade: `src/app/globals.css` (`@theme inline` + `--ds-*`) e `docs/design-system/rules.md`. A memória do ui-ux-designer tem o detalhe completo (`.claude/agent-memory/ui-ux-designer/project_salvia-design-system.md`).

**Paleta brand (light):** 50 #f2f5f1 · 100 #e1e8de · 200 #c2d1bc · 300 #a0b89a · 400 #7e9e78 · 500 #6b8a66 · 600 #587355 · 700 #475d45 · 800 #364937 · 900 #2a382b.
**Info/azul (candidato a acento de confiança):** info-500 #5b7a93 · info-700 #3f5870.
**Tipografia:** Inter (sans) + JetBrains Mono. Pesos permitidos só 400 e 600.

**Proibições duras (valem para a logo):** sem gradientes, sem sombras coloridas, sem glassmorphism/blur/glow/neon, sem emojis, sem animações >300ms/bounce. Cor de marca reservada para botão primário / nav ativa / foco / **logo** / avatar fallback. Ícones do produto: Lucide stroke 1.5 (a logo é exceção — vetor próprio).

**Filosofia:** calmo antes de bonito; funcional antes de decorativo; consistência radical; acessível por padrão (WCAG 2.1 AA).
**How to apply:** verificar contraste AA (logo legível em fundo claro/escuro), bind de tokens ao construir no Figma, desenhar light+dark em paralelo. Ver [[hubrity-brand-brief]] e [[hubrity-logo-decisions]].
