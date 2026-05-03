## ADDED Requirements

### Requirement: Auth domain code lives under `src/modules/auth/`

The system SHALL place the auth module at `src/modules/auth/` with this internal layout:

- `src/modules/auth/components/login-form.tsx` — the `<LoginForm/>` Client Component
- `src/modules/auth/server/login.ts` — the `signInImpl(formData)` server function (real action body)
- `src/modules/auth/server/logout.ts` — the `signOutImpl()` server function (real action body)
- `src/modules/auth/lib/login-input-schema.ts` — `loginInputSchema` (Zod)
- `src/modules/auth/lib/map-supabase-user.ts` — `mapSupabaseUser`
- `src/modules/auth/lib/safe-redirect.ts` — `safeRedirect` (validates `redirectTo`)
- `src/modules/auth/index.ts` — public API: re-exports `LoginForm`, `signIn`, `signOut`, `loginInputSchema`, `mapSupabaseUser`

Route shells under `src/app/(auth)/login/` and `src/app/(app)/` MUST delegate to these module entries (see the route-shell scenarios below). The Supabase clients consumed by `server/login.ts` and `server/logout.ts` MUST come from `@/shared/supabase/server` (not from a module-local helper).

#### Scenario: Module exposes the documented public API

- **WHEN** any code outside `src/modules/auth/` needs `signIn`, `signOut`, `LoginForm`, `loginInputSchema`, or `mapSupabaseUser`
- **THEN** it imports from `@/modules/auth` (the module's `index.ts`); no consumer imports from `@/modules/auth/server/*` or `@/modules/auth/components/*` directly

#### Scenario: Route shell wires `signIn` to the module implementation

- **WHEN** a contributor reads `src/app/(auth)/login/actions.ts`
- **THEN** the file declares `'use server'` and exports `signIn` (and any login-page actions) as wrappers around `signInImpl` imported from `@/modules/auth/server/login`; the wrapper is at most one or two lines that pass `formData` through

#### Scenario: Route shell wires `signOut` similarly

- **WHEN** a contributor reads `src/app/(app)/actions.ts`
- **THEN** the file declares `'use server'` and exports `signOut` as a wrapper around `signOutImpl` imported from `@/modules/auth/server/logout`

#### Scenario: Login page imports `<LoginForm/>` from the module

- **WHEN** a contributor reads `src/app/(auth)/login/page.tsx`
- **THEN** the page is a Server Component that imports `<LoginForm/>` from `@/modules/auth` and composes the route layout; no UI markup beyond layout-level composition lives in `page.tsx`
