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

6. **`resize(w,h)` on an auto-layout frame resets BOTH sizing modes to FIXED** — silently overriding any `layoutSizingHorizontal/Vertical="HUG"|"FILL"` you set *before* it. This caused dozens of collapsed buttons/columns (a 48px-tall button resized to width 10 stayed 10px wide; a hug-height column resized for width collapsed to 10px tall). **Fix:** ALWAYS set `layoutSizing*="HUG"|"FILL"` as the LAST operation, AFTER `resize()`. Pattern for a fixed-width-hug-height frame: append to parent → `resize(w, node.height)` → then re-assert `layoutSizingVertical="HUG"`.

7. **`setExplicitVariableModeForCollection(col, mode)` does NOT cascade to descendants** in `use_figma`. A child frame without its own explicit mode resolves at the collection's DEFAULT mode (here `Light`), regardless of an ancestor's explicit Dark. So a Dark wrapper renders Dark, but its un-flagged child sections render Light. Building light-mode screens "works" only because Light is the default. To build a Dark screen, set the mode on EVERY frame in the subtree (`node.findAll(()=>true)` + set on each). `node.resolvedVariableModes[colId]` confirms what actually applies. Even then, a nested section's already-bound bg fill may not repaint (clone/rebind freeze) — building light-mode + relying on code's `[data-theme=dark]` flip is the reliable path; a static Figma dark preview is fragile.

8. **Figma MCP `upload_assets` silently fails to render WebP** (the POST returns `success:true` + an imageHash, but the fill shows the missing-image placeholder). **Convert to PNG first** (`PIL ... .convert('RGB').save(png)`), then upload. Also: the `nodeId` upload path commits the hash to the MCP service but NOT the file's image store (renders blank); use the **no-`nodeId`** path (it returns `placedOnNodeId`), read the working hash, then apply via `fills=[{type:'IMAGE',imageHash,scaleMode:'FILL'}]`. `imageTransform` row must be non-degenerate (`[[1,0,0],[0,1,0]]` = identity; `[...,[0,0,0]]` collapses the image to blank).

9. **`counterAxisAlignItems` does NOT accept `'STRETCH'`** (only MIN/MAX/CENTER/BASELINE). For equal-height cells/cards in a row, give each child `layoutSizingVertical="FILL"` instead — they stretch to the tallest hug-sized sibling.

10. **`figma.createAutoLayout()` / `createFrame()` default to a SOLID WHITE fill (#ffffff, unbound).** Structural containers you don't explicitly fill (content columns, button groups, footer inner, carousel wrappers) keep that white → opaque white rectangles patching over the page background. Caused 377 stray white boxes across a landing build (user-visible). **Fix:** set `frame.fills=[]` on every transparent-intent container at creation. **Detection/cleanup:** a fill is the unintended default iff `fills[0].type==='SOLID' && !fills[0].boundVariables?.color` (all intentional fills go through `setBoundVariableForPaint`, so they're BOUND) — sweep `wrapper.findAll(...)` clearing those, leaving token-bound fills intact.

11. **Image fill distortion ("flattened" screenshots):** `scaleMode:'CROP'` with a non-identity `imageTransform` y-scale (e.g. `[[1,0,0],[0,0.62,0]]`) stretches the image vertically. For an undistorted thumbnail that covers the frame, use `scaleMode:'FILL'` (uniform scale + crop) with NO transform, and size the frame near the image's native aspect ratio.

12. **Real logos:** pull the official mark from the brand Figma file via `get_design_context` (returns geometry + colors + font). The Hubrity mark = 3 rounded-capsule "H" (sage `#587355`, sky `#5b7a93`, teal elo `#3f6f63`) + "hubrity" wordmark in **Nunito SemiBold** `#21261f` (light `#fafaf9` on dark). Brand file key `4O3POARuvEYI1BCrxbOFg2` (Símbolo `16:7`, Lockup Horizontal `17:2`). Reproduce with literal brand hex (logo colors are fixed brand assets, exempt from the token rule — or add `logo/*` tokens to the DS).

**Why:** these cost real debugging time and will recur on every component built in this file.
**How to apply:** when a bound color renders gray, suspect #1 first (clear-then-set); when a doc frame renders as a thin line, suspect #2.
