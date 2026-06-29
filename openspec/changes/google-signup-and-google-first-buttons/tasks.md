## 1. Google glyph primitive

- [x] 1.1 Create `src/shared/ui/google-icon.tsx` — inline-SVG `GoogleIcon` primitive rendering the official 4-color Google "G" (blue `#4285F4`, green `#34A853`, yellow `#FBBC05`, red `#EA4335`), mirroring the `Logo` primitive shape (`React.SVGProps<SVGSVGElement>`, `viewBox`, `className` via `cn`). Colors are fixed brand hex — no `tone`/`currentColor`. Mark the glyph `aria-hidden="true"` (decorative beside the button text).
- [x] 1.2 Add a unit test `src/__tests__/unit/shared/ui/google-icon.test.tsx` asserting it renders an `<svg>` and is `aria-hidden`.

## 2. Parameterize the shared GoogleButton

- [ ] 2.1 In `src/modules/oauth/components/google-button.tsx`, add props `label?: string` (default `'Entrar com Google'`) and `testid?: string` (default `'login-form-google-button'`); keep the loading label `'Redirecionando...'` and the `signInWithOAuth(...)` call unchanged.
- [ ] 2.2 Render `<GoogleIcon />` before the label inside the button; keep `variant="outline"`, `type="button"`, full width.
- [ ] 2.3 Verify the `@/modules/oauth` barrel still exports `GoogleButton` and that the new props are part of its public type.

## 3. Login page — Google-first

- [ ] 3.1 In `src/modules/auth/components/login-form.tsx`, move `<GoogleButton />` (defaults preserved) to the top of the form, above the email/password fields, with the existing "ou" divider relocated to sit between the Google button and the credential fields.
- [ ] 3.2 Confirm `LoginForm` still imports `GoogleButton` from `@/modules/oauth/components/google-button` (leaf, not barrel).
- [ ] 3.3 Update `src/__tests__/unit/modules/auth/components/login-form.test.tsx` — change the assertion `renders the GoogleButton below the submit button` to assert the button renders above the credential fields (Google-first).

## 4. Signup page — Google-first

- [ ] 4.1 In `src/modules/registration/components/signup-form.tsx`, import `GoogleButton` directly from `@/modules/oauth/components/google-button` (NOT the `@/modules/oauth` barrel).
- [ ] 4.2 Render `<GoogleButton label="Cadastrar com Google" testid="signup-form-google-button" />` at the top of the form, followed by an "ou" divider (matching the login divider markup), then the existing fields. Ensure it is `type="button"` and does not submit the form.
- [ ] 4.3 Add unit coverage for `SignupForm` asserting a button with `data-testid="signup-form-google-button"` is rendered above the fields and is `type="button"`.
- [ ] 4.4 Add/extend a seeded E2E scenario under `src/__tests__/e2e/seeded/oauth/` asserting the Google button is visible on `/signup` (`signup-form-google-button`) and initiates the OAuth flow, mirroring the existing `/login` scenario.


