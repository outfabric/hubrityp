---
name: Module barrel server-only leakage pattern
description: Barris de módulo (index.ts) que co-exportam Server Action implementations (server-only, next/headers) e Client Components causam build error crítico no Next.js App Router
type: project
---

Este projeto usa barris de módulo (index.ts) para expor a API pública de cada módulo. Um padrão perigoso identificado em 2026-05-06:

Os barris de `oauth/index.ts` e `password-recovery/index.ts` re-exportam tanto implementações de Server Actions (`linkOAuthIdentityImpl`, `requestPasswordResetImpl`) quanto Client Components (`GoogleButton`, `ForgotPasswordForm`). Quando um Client Component importa apenas o componente do barrel, o bundler do browser puxa toda a árvore — incluindo o chain `import 'server-only'` + `import { headers } from 'next/headers'` — causando build error.

**Cadeia problemática confirmada:**
- `login-form.tsx` ('use client') → `@/modules/oauth` (barrel) → `./server/link-oauth-identity.ts` (server-only) → `log-auth-event.ts` → `next/headers` = BUILD ERROR
- `forgot-password/page.tsx` → `@/modules/password-recovery` (barrel) → `./server/request-password-reset.ts` (server-only) → `log-auth-event.ts` → `next/headers` = BUILD ERROR

**Por que é supreendente**: o barrel `auth/index.ts` tem comentário explícito alertando que Client Components não devem importar `signIn` diretamente (e `login-form.tsx` importa de `@/app/(auth)/login/actions` corretamente). Mas a mesma disciplina não foi aplicada ao barrel `oauth/index.ts` para `GoogleButton`.

**Correção**: Separar exportações de server implementations e client components nos barris, ou Client Components devem importar diretamente dos subpaths internos em vez do barrel.

**Why:** Padrão recorrente quando novos módulos são criados sem verificar se o barrel mistura server/client exports.
**How to apply:** Em cada QA session, verificar imediatamente se há build errors antes de tentar qualquer cenário de UI. Inspecionar os barris de novos módulos se build errors aparecerem.
