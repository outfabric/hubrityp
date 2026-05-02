# Route layout convention

This document defines how HubrityP organises files under `app/`. It is the authoritative
source for the `(auth)` / `(app)` split — every authenticated feature page MUST live under
`app/(app)/<domain>/`, and every public auth page MUST live under `app/(auth)/`.

## Why route groups

Next.js [route groups](https://nextjs.org/docs/app/building-your-application/routing/route-groups)
are folders whose name is wrapped in parentheses, e.g., `app/(app)`. They are present in the
filesystem but **do not appear in URLs**. Their job is to scope a layout, loading state, or
error boundary to a subset of routes without polluting the URL hierarchy.

Without route groups, gating a section of the app behind a layout would force ugly URLs like
`/dashboard/(layout)/...` or duplicate layout boilerplate on every page. With them, the
layout file lives once at the group root and applies to every descendant.

We use exactly two groups:

- **`app/(auth)/`** — public auth surface. Pages a logged-out user is allowed to see while
  attempting to authenticate. Layout is a minimal centered container with no navigation.
- **`app/(app)/`** — authenticated surface. Pages a logged-in user sees after authentication.
  Layout is the application shell (header, logout, future navigation).

Outside these two groups, `app/<route>/` is reserved for **public marketing or landing
pages** (the root `app/page.tsx`, `/about`, `/pricing`, etc.). They render with the root
`app/layout.tsx` and have no special gating.

## URLs are flat

Route group folder names are **erased** from the URL. The two groups produce identical URLs
to a flat `app/` layout:

| Filesystem path                | Resolves at  | Layout chain                               |
| ------------------------------ | ------------ | ------------------------------------------ |
| `app/(auth)/login/page.tsx`    | `/login`     | `app/layout.tsx` → `app/(auth)/layout.tsx` |
| `app/(app)/dashboard/page.tsx` | `/dashboard` | `app/layout.tsx` → `app/(app)/layout.tsx`  |
| `app/page.tsx`                 | `/`          | `app/layout.tsx`                           |

Future routes:

- `app/(app)/patients/page.tsx` → `/patients`
- `app/(app)/calendar/page.tsx` → `/calendar`
- `app/(auth)/forgot-password/page.tsx` → `/forgot-password`

The `(auth)` and `(app)` segments NEVER appear in the user-facing URL. Routing, redirects,
and `next/link` `href` props all use the flat path (`/login`, `/dashboard`).

## The rule

> **Every authenticated feature page MUST live under `app/(app)/<domain>/`.**

> **Every public auth page MUST live under `app/(auth)/`.**

> **Public marketing/landing pages live under `app/<route>/` directly (no group).**

If a new page does not obviously fit one of these three buckets, the proposal needs to argue
explicitly which group it belongs to. The default answer for any feature surfaced to a
logged-in psychologist is `(app)`.

## Layouts and where they live

| File                    | Applies to                                        | Responsibility                                                                                                       |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`        | Every page in the tree.                           | `<html>`, `<body>`, global font, base providers (Sonner, theme). Nothing surface-specific.                           |
| `app/(auth)/layout.tsx` | `/login`, future `/signup`.                       | Minimal centered container. No navigation. Anonymous-only chrome.                                                    |
| `app/(app)/layout.tsx`  | `/dashboard` and every future authenticated page. | App shell: header with HubrityP wordmark and the logout `<form action={signOut}>`. Renders `{children}` in `<main>`. |

The authenticated shell renders the logout control once, at the layout level, instead of in
every page. This is why `dashboard-logout` is a layout-scoped `data-testid`, not a
page-scoped one.

## Server Action co-location

Server Actions consumed by a layout MUST live at the **group root**, not in a page
subdirectory. Concretely:

| Action    | Lives at                      | Reason                                                                                                                                |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `signOut` | `app/(app)/actions.ts`        | Imported by `app/(app)/layout.tsx`. Placing it in `app/(app)/dashboard/actions.ts` would couple the layout to a specific child route. |
| `signIn`  | `app/(auth)/login/actions.ts` | Imported by `app/(auth)/login/login-form.tsx`. Page-scoped because only the login page consumes it.                                   |

Heuristic for new Server Actions:

- **Used by a layout?** Place at `app/(group)/actions.ts`.
- **Used by a single page or its co-located components?** Place at `app/(group)/<page>/actions.ts`.
- **Shared across pages within the same group?** Place at `app/(group)/actions.ts`.

This keeps imports inside the group and avoids the cross-group import chain
`app/(app)/layout.tsx → app/(app)/dashboard/actions.ts`, which would be both confusing and a
regression risk if `/dashboard` is ever moved or removed.

## Adjacent invariants

Two project-wide rules that interact with the route layout:

- **Server Components by default.** Pages and layouts are RSCs unless they need React hooks
  or browser APIs. Mark a leaf `'use client'` only when interactivity demands it (e.g.,
  `login-form.tsx` uses `useActionState` / `useForm`).
- **Auth gating lives in `middleware.ts`, not in pages.** The middleware redirects:
  - anonymous request to `/dashboard*` → `/login?redirectTo=<encoded path+search>`,
  - authenticated request to `/login` → `/dashboard`.

  Pages should defensively handle the (rare) case where a request bypasses middleware
  (e.g., return `null` if `getUser()` is null on a `/dashboard` render), but they must NOT
  duplicate redirect logic — that is the middleware's job.

## Anti-patterns

- **Nesting feature folders without a group.** `app/dashboard/patients/` would couple the
  patients section to the dashboard route. Instead, use sibling groups:
  `app/(app)/dashboard/`, `app/(app)/patients/`. They share the same authenticated layout
  without being children of each other.
- **A third route group** (`(public)`, `(billing)`, …) without a clear scope. Two groups
  cover the auth boundary; adding a third should require a design discussion. Public
  marketing pages live at `app/<route>/` directly.
- **Putting Server Actions in `lib/`.** Server Actions are a Next.js feature with framework
  semantics (form action, transition, revalidation). They live in `app/`. `lib/` is reserved
  for framework-agnostic helpers and shared modules.
- **Marking a page or layout `'use client'`.** Almost always wrong; it disables RSC for the
  entire subtree. Push the boundary down to the leaf component that actually needs it.
