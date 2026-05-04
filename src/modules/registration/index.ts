// Public API of the `registration` module.
//
// Per the `reorganize-folder-structure` design decision, every module exposes
// its surface through a single `index.ts` barrel — consumers MUST import from
// `@/modules/registration`, never from internal paths like
// `@/modules/registration/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports both Server Actions, pure helpers, types, and
// Client/Server Components; if it carried `'use server'`, every export would
// be transformed into an RPC stub by the Next.js compiler and the schema /
// type / Client Component re-exports would break.
//
// The `'use server'` directives live on the route shells (`app/(auth)/signup/
// actions.ts`, `app/(app)/onboarding/pending/actions.ts`) which import the
// implementations from this barrel and re-export them as bona fide Server
// Actions for the Next.js compiler. This mirrors the contract enforced by
// `src/modules/auth/index.ts`.
//
// Internal helpers NOT re-exported (intentional):
//   - `server/log-auth-event.ts` — only consumed inside `server/**`; no caller
//     outside the module needs the writer.

// ---- Server Actions (delegated to by the route shells) -----------------------
export { signUpImpl as signUp, type SignUpResult } from './server/sign-up';
export {
  resendVerificationEmailImpl as resendVerificationEmail,
  type ResendVerificationResult,
} from './server/resend-verification';
export { getCurrentProfile } from './server/get-profile';

// ---- Pure validators / policies ---------------------------------------------
export { signupInputSchema, type SignupInput } from './lib/signup-input-schema';
export { passwordPolicy, PASSWORD_MIN_LENGTH, type PasswordRule } from './lib/password-validators';

// ---- Components --------------------------------------------------------------
export { SignupForm, type SignupFormProps } from './components/signup-form';
export {
  OnboardingPendingCard,
  type OnboardingPendingCardProps,
} from './components/onboarding-pending-card';
export {
  AuthCallbackError,
  type AuthCallbackErrorProps,
} from './components/auth-callback-error';

// ---- Types -------------------------------------------------------------------
export type { Profile } from './lib/profile';
export { ProfileStatus } from './lib/profile-status';
