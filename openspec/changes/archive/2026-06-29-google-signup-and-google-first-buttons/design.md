## Context

The Google OAuth capability (`oauth-google`) is fully implemented end-to-end: the `GoogleButton` Client Component calls `supabase.auth.signInWithOAuth`, `/auth/callback` exchanges the code, and `resolveOAuthCallback` branches a first-time Google user to `/onboarding/complete-profile` (CRP + UF + 3 LGPD consents), a returning user to `/dashboard` or `/onboarding/pending`, and an email collision to `/auth/link-account`. The only gaps are on the presentation surface:

1. The Google entry point exists only on `/login`, not `/signup` — new users can't discover Google sign-up.
2. `GoogleButton` is text-only ("Entrar com Google") with no Google glyph — this also breaks the existing spec scenario that requires an icon (`spec.md` line 21).
3. `GoogleButton` hardcodes its label and `data-testid="login-form-google-button"`, so it can't be reused on `/signup` without a misleading label and a colliding test id.
4. On `/login` the button sits at the bottom (after the submit button). The user wants both pages Google-first (button at the top).

Constraints from the codebase:
- Client Components must not import the `@/modules/oauth` barrel (it re-exports server-only Server Actions). `LoginForm` already imports `GoogleButton` directly from `components/google-button.tsx` for this reason; `SignupForm` must do the same.
- The project renders brand marks as inline SVG primitives (`src/shared/ui/logo.tsx`), explicitly avoiding `next/image`/imported `.svg` for zero-network, no-FOUT rendering. The Google glyph follows this pattern.
- `lucide-react` (the project's icon set) has no Google brand glyph.

## Goals / Non-Goals

**Goals:**
- Surface a Google entry point on `/signup` that reuses the existing OAuth flow with zero backend change.
- Render the official multi-color Google "G" glyph on the Google button on both pages.
- Position the Google button first ("Google-first") on both `/login` and `/signup`.
- Keep one shared `GoogleButton`, parameterized for label and test id, with defaults preserving current login behavior.
- Keep tests green: fix the login button-position unit assertion, add signup coverage, add an E2E scenario for the signup button.

**Non-Goals:**
- No changes to `signInWithOAuth` options, `/auth/callback`, `resolveOAuthCallback`, `/onboarding/complete-profile`, `/auth/link-account`, `oauth_identities`/`profiles` writes, `auth_logs`, or RLS.
- No new npm dependency.
- No change to the `complete-profile` data collected (CRP/UF/consents remain required for Google sign-up — Google only saves the email/password step).
- No redesign of the button beyond adding the glyph and repositioning.

## Decisions

### Decision 1: New `GoogleIcon` inline-SVG primitive in `src/shared/ui/`

Add `src/shared/ui/google-icon.tsx` as a small presentational inline SVG of the official 4-color Google "G" (blue `#4285F4`, green `#34A853`, yellow `#FBBC05`, red `#EA4335`), mirroring the `Logo` primitive's structure (`React.SVGProps<SVGSVGElement>`, `viewBox`, `<title>`, `role="img"`/`aria-hidden` as appropriate, `className` merge via `cn`).

- **Why fixed colors, not `tone`/`currentColor`:** Google brand guidelines require the "G" to keep its colors. Unlike `Logo`, this primitive does not accept a `tone` prop and does not collapse fills to `currentColor`. The literal hex values are the canonical brand colors — the same "literal hex allowed here" exception already documented in `logo.tsx`.
- **Why inline SVG over `next/image`/imported asset:** consistency with the established `Logo` pattern (zero network request, no flash), and the glyph is tiny.
- **Why not lucide:** lucide ships no Google brand glyph.
- **Accessibility:** the glyph is decorative next to the button's text label, so it carries `aria-hidden="true"` (the button text "Entrar/Cadastrar com Google" is the accessible name). It MUST remain visible (not `display:none`) so the brand mark renders.

**Alternative considered:** put the SVG inline inside `GoogleButton`. Rejected — a reusable `src/shared/ui` primitive matches the repo's `Logo` convention and keeps `GoogleButton` focused on behavior.

### Decision 2: Parameterize `GoogleButton` with `label` and `testid` props (defaults preserved)

`GoogleButton({ label = 'Entrar com Google', testid = 'login-form-google-button' })`. The loading label stays `'Redirecionando...'`. The button renders `<GoogleIcon />` before the label. The `signInWithOAuth` call is unchanged.

- **Why defaults:** `LoginForm` keeps calling `<GoogleButton />` with no props → identical login copy and test id → zero behavioral regression on login except the repositioning (Decision 4). `SignupForm` passes `label="Cadastrar com Google"` and `testid="signup-form-google-button"`.
- **Why distinct test id for signup:** QA/E2E must be able to address each page's button independently; the existing E2E suite keys off `login-form-google-button`.

**Alternative considered:** two separate button components. Rejected — duplicates the `signInWithOAuth` logic and the loading-state handling; a single parameterized component is the existing intent (the component already lives in the shared `oauth` module).

### Decision 3: `SignupForm` imports `GoogleButton` from the leaf, not the barrel

`SignupForm` imports `import { GoogleButton } from '@/modules/oauth/components/google-button'`, exactly as `LoginForm` does, to avoid pulling the `@/modules/oauth` barrel (which re-exports server-only Server Actions) into the client bundle.

### Decision 4: Google-first layout on both pages, with an "ou" divider

Both forms render, top to bottom: `GoogleButton` (type="button") → "ou" divider → fields → submit. The existing "ou" divider markup in `LoginForm` is reused/relocated; `SignupForm` gains the same divider. The Google button must stay `type="button"` so it never submits the surrounding `<form>`.

- **Why inside the form (vs. page shell):** the button already lives inside `LoginForm`; keeping both buttons inside their forms keeps the spec's "button MUST live inside `LoginForm`" wording true and centralizes the divider with the fields it separates.

### Decision 5: Test updates

- `src/__tests__/unit/modules/auth/components/login-form.test.tsx`: the existing test `renders the GoogleButton below the submit button` (≈ line 220) is updated to assert the button renders **above** the credential fields. The existing `GoogleButton` mock in that file is unaffected (it already keys off the test id).
- Add unit coverage asserting `SignupForm` renders a button with `data-testid="signup-form-google-button"`.
- `src/__tests__/e2e/seeded/oauth/`: add/extend a seeded scenario asserting the Google button is visible on `/signup` (`signup-form-google-button`) and initiates the flow, mirroring the existing `/login` scenario.

## Risks / Trade-offs

- **[Visible change to the production login page]** Moving the login Google button to the top changes a live screen. → Mitigation: the change is purely positional and explicitly requested; the OAuth behavior, test id, and copy are unchanged. The repositioning is covered by the updated unit assertion.
- **[Google brand-guideline compliance]** An incorrectly drawn/colored "G" risks brand non-compliance. → Mitigation: use the official 4-color geometry with the canonical hex values and keep the glyph on the light `variant="outline"` surface (sufficient contrast); never recolor to a single tone.
- **[Test id collision / brittle E2E]** Reusing one component across two pages could let a shared default test id leak onto signup. → Mitigation: signup passes an explicit distinct `testid`; the E2E suite addresses each page's button by its own id.
- **[Client-bundle leak]** Importing the oauth barrel into `SignupForm` would drag server-only modules into the browser build. → Mitigation: import the leaf component directly (Decision 3), matching `LoginForm`.
