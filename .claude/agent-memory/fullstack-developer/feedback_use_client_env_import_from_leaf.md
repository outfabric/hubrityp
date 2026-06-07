---
name: use-client-env-import-from-leaf
description: 'use client' components must import clientEnv from @/shared/env/client (leaf), never @/shared/env (barrel) — the barrel has `import server-only`
metadata:
  type: feedback
---

A `'use client'` component that needs `clientEnv` MUST import it from `@/shared/env/client`, NOT from the `@/shared/env` barrel. The barrel `src/shared/env/index.ts` does `import 'server-only'`, so importing it into a client component pulls server-only into the client bundle and `next build` aborts (Turbopack server-only-in-client-bundle error), which blocks the entire e2e:seeded suite (no production build → webServer fails to start).

**Why:** This exact regression shipped on the disable-whatsapp-reminders-ui branch (sidebar-nav.tsx imported clientEnv from the barrel) and only surfaced in the end-of-sections sweep, because `next build` is not part of per-section scoped validation.

**How to apply:** When adding a client component (feature flags via `clientEnv.NEXT_PUBLIC_*`, etc.), import from `@/shared/env/client`. This is the runtime-VALUE-from-server-barrel trap — same root cause family as [[client_runtime_import_from_server_barrel]]. Grep for `from '@/shared/env'` in any file with `'use client'` at the top before merging.
