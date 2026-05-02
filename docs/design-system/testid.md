# `data-testid` convention

This document is the authoritative source for the `data-testid` attribute used across the
HubrityP application. Treat it as a contract: every interactive element that participates in
an end-to-end or integration test gets one ID, the ID follows the convention below, and the
list of currently-issued IDs is kept in sync with the source.

## Why test IDs (and why not _only_ them)

Playwright's web-first locators (`getByRole`, `getByLabel`) are the preferred way to address
elements: they assert accessibility along the way and are resilient to most refactors. For a
pt-BR product like HubrityP they have two specific weaknesses, which `data-testid` fills:

- **Localized roles drift.** A button labelled "Sair" today may become "Encerrar sessão"
  tomorrow. `getByRole('button', { name: 'Sair' })` breaks; `getByTestId('dashboard-logout')`
  does not.
- **shadcn primitives wrap composition.** Some shadcn components compose multiple DOM nodes
  (e.g., `Button` with `asChild`). A role-based locator can match more than one node when the
  component is nested in a `<form>` or a `<DropdownMenu>`. A scoped `data-testid` removes the
  ambiguity.

`data-testid` is also the deterministic surface that the `qa-tester` agent relies on when it
explores the app via Playwright MCP — agent-driven testing without it is brittle.

## Locator preference order

When writing or reviewing a Playwright/RTL test, prefer locators in this order. Move down the
list only when the higher-priority locator is genuinely unstable:

1. `getByRole(role, { name })` — accessibility-first, catches a11y regressions.
2. `getByLabel(text)` — for form fields with a `<Label htmlFor>` association.
3. `getByPlaceholder(text)` — when there is no label and the placeholder is a stable label.
4. `getByText(text)` — for static read-only copy (e.g., headings).
5. `getByTestId(id)` — explicit fallback. Use when the element is interactive but the
   localized role/name is volatile, or when the element is a non-semantic container that
   nevertheless needs deterministic addressing (e.g., the inline error region on `/login`).

## Naming convention

The format is **`<surface>-<role>-<noun>`** in `kebab-case`. Each segment is a single concept.

| Segment   | What it is                                      | Examples                                     |
| --------- | ----------------------------------------------- | -------------------------------------------- |
| `surface` | The page or major section the element lives on. | `login-form`, `dashboard`, `patient-create`  |
| `role`    | What the element does in the UI.                | `form`, `input`, `button`, `submit`, `error` |
| `noun`    | The concrete subject the element acts on.       | `email`, `password`, `submit`, `greeting`    |

Rules:

- One `data-testid` per interactive element. Do not reuse the same ID on multiple nodes.
- No alphanumeric soup (`x1`, `btn2`). The ID has to read like English.
- Lowercase, dash-separated. Never camelCase, never snake_case.
- The `surface` prefix scopes the ID and makes it easy to locate in source (`grep
'login-form'`).
- For elements that are conceptually a single thing (e.g., the submit button of a form), the
  `role` segment can be omitted when it would just repeat the noun. Prefer
  `login-form-submit` over `login-form-button-submit`.

## Wave-3 IDs (smoke-health-feature)

These are the test IDs introduced by the smoke-health feature. Each one was placed by hand
in the source files cited and is exercised by at least one e2e or unit test.

| `data-testid`         | Surface                           | Element                                                                     |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `login-form-email`    | `app/(auth)/login/login-form.tsx` | E-mail `<input type="email">`.                                              |
| `login-form-password` | `app/(auth)/login/login-form.tsx` | Senha `<input type="password">`.                                            |
| `login-form-submit`   | `app/(auth)/login/login-form.tsx` | Submit `<Button>` ("Entrar" / "Entrando…" while pending).                   |
| `login-form-error`    | `app/(auth)/login/login-form.tsx` | Inline error region (`role="alert"`), rendered only on Server Action error. |
| `dashboard-greeting`  | `app/(app)/dashboard/page.tsx`    | `<span>` containing `Olá, {email}` on `/dashboard`.                         |
| `dashboard-logout`    | `app/(app)/layout.tsx`            | Submit `<Button>` inside the logout `<form action={signOut}>`.              |

Notes:

- `login-form-error` is **not always rendered**. Tests that assert its absence should use
  `await expect(page.getByTestId('login-form-error')).toHaveCount(0)` rather than waiting on
  it.
- `dashboard-logout` is intentionally on the layout, not the page. Every authenticated page
  inherits it (see `docs/design-system/route-layout.md`).

## Adding new IDs

A pull request introducing one or more new `data-testid` values must update this document in
the same change. The process:

1. Choose names that follow the `<surface>-<role>-<noun>` convention. If the surface does not
   yet exist in this document, add a new section header for it before listing the IDs.
2. Add a row to the wave's table with the testid, the file path, and a one-line description
   of the element.
3. Within a single PR, you may introduce multiple IDs as long as they share the same surface
   prefix (e.g., a new feature on `/patients` adding `patient-create-name`,
   `patient-create-cpf`, `patient-create-submit`).
4. **Cross-surface additions** (a single PR adding IDs across two unrelated surfaces) should
   pause and validate the convention is still scaling. If the answer is "yes, both surfaces
   genuinely need them", proceed; otherwise, split the change.
5. The `code-reviewer` agent treats a missing entry in this document as a `BLOCKER` issue.

## Anti-patterns

Avoid these. They appear in junior-engineer code and the `code-reviewer` should call them
out.

- IDs that describe **what the element looks like** instead of what it does:
  `red-button`, `big-input`, `card-with-icon`. The visual presentation will change; the role
  will not.
- IDs that **leak the implementation** of the underlying primitive: `login-shadcn-button`,
  `dashboard-radix-dialog-close`. Tests should not break when shadcn or Radix versions
  change.
- IDs that **encode the test scenario** rather than the element:
  `login-form-submit-when-disabled`. The element is `login-form-submit`; whether it is
  disabled is a state the test asserts, not a separate ID.
- IDs **on every node** "just in case". Only add an ID to elements you actually need to
  address from a test. Decorative wrappers do not need them.
