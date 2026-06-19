---
name: figma-sources
description: Canonical Figma files for HubrityP — Design System (Sálvia) and Brand Identity — with file keys and what each owns
metadata:
  type: reference
---

Two distinct Figma files are the visual source of truth for HubrityP. Reach them
via the Figma MCP (`get_metadata` / `get_screenshot` with the file key).

- **Design System "Sálvia"** — file key `HoLOEqq9PXlo6IwLkz3FQ9`. Owns the public
  pages, public chrome, tokens (color/spacing/radius/type), cookie banner. Note:
  the MCP page listing only returns the active page ("Cover"); to reach a screen
  frame you must already know its node id (you cannot enumerate the other pages),
  and `get_variable_defs` requires a manual selection in the desktop app — so
  rely on `get_screenshot`/`get_metadata` by node id. **Verified frame node ids
  (2026-06-19, reachable by id even though un-listed):** homepage desktop `105:2`
  / mobile `133:2`; pricing desktop `128:2` (header child `128:3`, footer child
  `131:32`); privacy `142:2`; terms `143:2`; 404 `144:2`; cookie banner `132:2`.
  These match the (obsolete) handoff's frame ids — only the containing page moved.
- **Brand Identity "Marca / Escuta"** — file key `4O3POARuvEYI1BCrxbOFg2`. Owns
  the logomark and its variants: `Logo / Símbolo` (`16:7`), `Lockup Horizontal`
  (`17:2`), `Lockup Vertical` (`17:8`). The symbol is **tricolor** (left stake
  sage/green, right stake slate/blue, center link teal) — NOT monochrome. On
  dark surfaces the symbol stays colored and only the wordmark goes light. If a
  change needs the logo, this file is the source — the code primitive lives at
  `src/shared/ui/logo.tsx` and mirrors `public/brand/*.svg`.

See [[public-pages-figma-source-of-truth]] for the rule that Figma (not the old
handoff doc) governs the public site.
