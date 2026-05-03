## MODIFIED Requirements

### Requirement: Route group layout is established

The system SHALL place the dashboard under `src/app/(app)/dashboard/` and the login page under `src/app/(auth)/login/`. Both route groups MUST have their own `layout.tsx` files: `src/app/(auth)/layout.tsx` is a centered minimal layout, `src/app/(app)/layout.tsx` is the authenticated shell containing the page header and content area.

#### Scenario: URLs are flat regardless of route group

- **WHEN** the app is built
- **THEN** the URLs `/login` and `/dashboard` are reachable without the `(auth)` or `(app)` segments appearing in any path

#### Scenario: Layouts apply only to their group

- **WHEN** a developer adds a sibling page under `src/app/(app)/<new>/page.tsx`
- **THEN** the new page automatically inherits the authenticated shell from `src/app/(app)/layout.tsx` without any additional wiring

### Requirement: `data-testid` convention is documented

The system SHALL document, in `docs/design-system/testid.md`, the `data-testid` naming convention (`<surface>-<role>-<noun>`, kebab-case) and the IDs introduced by this change. Future features MUST follow the same convention. The document MUST live under `docs/` (not at the repository root).

#### Scenario: Documentation lists the wave-3 IDs

- **WHEN** a contributor reads `docs/design-system/testid.md`
- **THEN** the document lists at least `login-form-email`, `login-form-password`, `login-form-submit`, `login-form-error`, `dashboard-greeting`, and `dashboard-logout` with a brief description of each

## ADDED Requirements

### Requirement: Dashboard logout delegates to the auth module

The system SHALL render the logout control on `/dashboard` as a `<form action={signOut}>` where `signOut` is the route-shell wrapper exported from `src/app/(app)/actions.ts`. The wrapper MUST delegate to `signOutImpl` from `@/modules/auth/server/logout`. The dashboard page itself MUST NOT contain logout business logic (Supabase calls, redirect computation).

#### Scenario: Dashboard page imports `signOut` from the route shell

- **WHEN** a contributor reads `src/app/(app)/dashboard/page.tsx`
- **THEN** the page imports `signOut` from `../actions` (the route shell at `src/app/(app)/actions.ts`); it does not import from `@/modules/auth/server/*` directly and does not call Supabase

#### Scenario: Logout still works without client JavaScript

- **GIVEN** a browser with JavaScript disabled
- **WHEN** the user submits the logout form
- **THEN** the route-shell wrapper invokes `signOutImpl`, the session cookies are cleared, and the redirect to `/login` still occurs (preserving the original behavior of this requirement)
