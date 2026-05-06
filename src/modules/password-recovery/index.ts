// Public API of the `password-recovery` module.
//
// Per the codebase convention, every module exposes its surface through a
// single `index.ts` barrel — consumers MUST import from
// `@/modules/password-recovery`, never from internal paths.
//
// This file MUST NOT carry `'use server'`. The `'use server'` directives
// live on the route shells (`app/(auth)/forgot-password/actions.ts`,
// `app/(auth)/reset-password/actions.ts`) which import the implementations
// from this barrel and re-export them as bona fide Server Actions for the
// Next.js compiler.

// ---- Server Actions (delegated to by the route shells) ----------------------
export {
  requestPasswordResetImpl as requestPasswordReset,
  type RequestPasswordResetResult,
} from './server/request-password-reset';

export {
  resetPasswordImpl as resetPassword,
  type ResetPasswordResult,
} from './server/reset-password';

// ---- Schemas ----------------------------------------------------------------
export {
  forgotPasswordInputSchema,
  type ForgotPasswordInput,
} from './lib/forgot-password-input-schema';

export {
  resetPasswordInputSchema,
  type ResetPasswordInput,
} from './lib/reset-password-input-schema';

// ---- Components -------------------------------------------------------------
export {
  ForgotPasswordForm,
  type ForgotPasswordFormProps,
} from './components/forgot-password-form';

export { ResetPasswordForm, type ResetPasswordFormProps } from './components/reset-password-form';
