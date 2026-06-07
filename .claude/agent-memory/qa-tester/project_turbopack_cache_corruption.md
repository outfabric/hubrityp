---
name: turbopack-cache-corruption
description: Next 16 Turbopack dev serves stale CSS + panics after partial .next deletes; clean-reset recipe for local Docker QA
metadata:
  type: project
---

The local Docker dev server runs `next dev` (Next.js 16, Turbopack) with the repo bind-mounted `.:/app`. Turbopack keeps a persistent cache at `.next/dev/cache/turbopack/<hash>/*.sst|*.meta`.

**Symptom:** after editing `globals.css` (or other CSS), the browser keeps getting a STALE compiled chunk (same chunk hash, missing the edit) and the app logs `FATAL ... TurbopackInternalError: Failed to restore task data (corrupted database or bug) ... Unable to open static sorted file ... 00000001.sst ... No such file or directory`. A plain `docker compose restart app` does NOT fix it; partial deletes (`rm -rf .next/static .next/server`) make it WORSE by corrupting the cache DB.

**Why:** the `.next` files are owned by the container's `node` user, so a HOST `rm -rf .next` hits `Permission denied` and only partially deletes, leaving a half-gutted Turbopack cache the running server then tries to restore → panic + stale serve.

**Clean-reset recipe (the only thing that worked):**
1. `docker compose stop app`
2. Remove `.next` as root via a transient container (host rm can't):
   `docker run --rm -v "$(pwd)":/app -w /app node:22-bookworm-slim sh -c "rm -rf /app/.next"`
3. `docker compose start app`
4. Wait for `/login` → 200 (first compile after a full wipe is slow, ~20-25s for a route).

**How to apply:** When QA-ing a CSS/visual change locally and the served output doesn't match source, suspect this BEFORE reporting a bug. Confirm by fetching the served chunk (`curl` the `/_next/static/chunks/...css` href) and grepping for the edit — CSS is pretty-printed (multi-line) in dev, so grep multi-line, not minified single-line. Related: [[design-token-space3-undefined]], [[playwright-cli-invocation]].
