---
name: figma-ds-build-gotchas
description: Non-obvious Figma Plugin API gotchas hit while building the Sálvia design system library, with fixes
metadata:
  type: reference
---

Technical gotchas encountered building the Sálvia Figma library via `use_figma` (figma-generate-library skill). Check these before debugging from scratch.

1. **Re-binding a cloned node's fill to the SAME variable as the base silently drops the binding** → the paint renders its placeholder color (gray `rgb(128,128,128)` from `{r:.5,g:.5,b:.5}`) instead of the resolved value, even though `boundVariables.color` is still set and `resolveForConsumer()` returns the correct color. **Fix:** clear first, then assign — `node.fills=[]; node.fills=[boundPaint];`. Changing to a *different* variable applies fine; only same-variable re-assignment on a clone is affected. Hit on Button Primary variants (kept brand/500 from base → gray) while Destructive (changed to danger/500) was fine.

2. **`resize(W, 1)` on a hug (auto-layout) frame collapses `primaryAxisSizingMode` to FIXED at height 1**, clipping all children to a 1px sliver. The figma-generate-library doc snippets do this for doc-page roots and swatch cells. **Fix:** after `resize`, set `primaryAxisSizingMode='AUTO'` (or `layoutSizingVertical='HUG'`).

3. `setPluginData`/`getPluginData` are **not** supported in `use_figma`; use `setSharedPluginData('dsb', key, val)` (the figma-generate-library scripts use the unsupported form — rewrite inline).

4. `findAll(n => n.type==='INSTANCE')` inside a component instance also returns **nested** icon/sub instances — when binding fills on a row of button instances it will also hit the leading/trailing icon instances. Filter by name or use direct children only.

5. Effect styles can't be mode-aware → build separate `Shadow/Light/*` and `Shadow/Dark/*` style sets; apply per frame mode.

**Why:** these cost real debugging time and will recur on every component built in this file.
**How to apply:** when a bound color renders gray, suspect #1 first (clear-then-set); when a doc frame renders as a thin line, suspect #2.
