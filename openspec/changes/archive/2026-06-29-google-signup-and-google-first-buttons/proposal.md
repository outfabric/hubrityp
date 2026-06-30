## Why

Today the Google OAuth entry point exists only on `/login`, so a new user landing on `/signup` has no way to discover that they can register with their existing Google account — even though the backend (callback branching, first-time-OAuth profile completion, email-collision linking) already fully supports Google sign-up. On top of that, the existing Google button renders text-only with no Google glyph, which both hurts recognizability and violates this capability's own spec requirement that the button "uses an icon from the design system's iconography map or shadcn-compatible Google glyph".

## What Changes

- Add a Google entry-point button to `/signup` ("Cadastrar com Google") that initiates the exact same OAuth flow used on `/login` — no backend, callback, or RLS changes.
- Add the official multi-color Google "G" glyph to the Google button as a new inline-SVG UI primitive (`GoogleIcon`), mirroring the existing `Logo` primitive pattern. The glyph keeps Google's brand colors fixed (it does NOT recolor to `currentColor`/tone), per Google brand guidelines.
- Make the shared `GoogleButton` parameterizable (`label`, `testid`) with defaults preserving the current login behavior, so `/login` and `/signup` reuse one component with page-appropriate copy and stable, distinct test ids.
- Reposition the Google button to the **top** ("Google-first") on BOTH `/login` and `/signup`: Google button → "ou" divider → form fields. This is a visible change to the existing production login page.
- Update the affected unit test that asserts the login Google button renders *below* the submit button; add unit coverage for the signup button and an E2E scenario for the Google entry point on `/signup`.

## Capabilities

### New Capabilities
<!-- None. The signup entry point is an extension of the existing oauth-google capability, not a new capability. -->

### Modified Capabilities
- `oauth-google`: The login-page entry-point requirement changes (button moves to the top and MUST render the Google glyph); a new requirement adds a Google sign-up entry point on `/signup` reusing the same flow.

## Impact

- **Code**:
  - `src/shared/ui/` — new `GoogleIcon` inline-SVG primitive (4-color brand glyph).
  - `src/modules/oauth/components/google-button.tsx` — add `label`/`testid` props (defaults preserved), render `GoogleIcon`.
  - `src/modules/auth/components/login-form.tsx` — move `GoogleButton` to the top, above the fields, with the "ou" divider below it.
  - `src/modules/registration/components/signup-form.tsx` — render `GoogleButton` at the top (import the leaf component directly, not the `@/modules/oauth` barrel, to avoid dragging server-only code into the client bundle), "ou" divider, then existing fields.
- **Tests**:
  - `src/__tests__/unit/modules/auth/components/login-form.test.tsx` — update the button-position assertion (below → top).
  - new unit coverage for the signup Google button (`data-testid="signup-form-google-button"`).
  - `src/__tests__/e2e/seeded/oauth/` — add/extend a scenario that the Google button is visible and clickable from `/signup`.
- **Unchanged (explicitly out of scope)**: `signInWithOAuth` invocation shape, `/auth/callback`, `resolveOAuthCallback`, `/onboarding/complete-profile`, `/auth/link-account`, `oauth_identities`/`profiles` writes, `auth_logs` events, RLS policies.
- **Dependencies**: none added (`lucide-react` has no Google brand glyph; the glyph is a custom inline SVG, consistent with the project's `Logo` primitive).
