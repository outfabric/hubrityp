// Public API of the `oauth` module.
//
// This file is intentionally NEUTRAL — no `'use server'` directive. The
// barrel re-exports Server Action implementations, pure helpers/schemas,
// and Client Components. Route shells that need `'use server'` import the
// implementations from this barrel and re-export them.

// ---- Server Action implementations -----------------------------------------
export {
  completeOAuthProfileImpl as completeOAuthProfile,
  type CompleteOAuthProfileResult,
} from './server/complete-oauth-profile';
export {
  linkOAuthIdentityImpl as linkOAuthIdentity,
  type LinkOAuthIdentityResult,
} from './server/link-oauth-identity';
export {
  resolveOAuthCallback,
  type ResolveOAuthCallbackInput,
  type ResolveOAuthCallbackResult,
} from './server/resolve-oauth-callback';

// ---- Components ------------------------------------------------------------
export { GoogleButton } from './components/google-button';
export {
  CompleteProfileForm,
  type CompleteProfileFormProps,
  type CompleteProfileResult,
} from './components/complete-profile-form';
export {
  LinkAccountForm,
  type LinkAccountFormProps,
  type LinkAccountResult,
} from './components/link-account-form';

// ---- Schemas ---------------------------------------------------------------
export {
  completeProfileInputSchema,
  type CompleteProfileInput,
} from './lib/complete-profile-input-schema';
export { linkAccountInputSchema, type LinkAccountInput } from './lib/link-account-input-schema';
export { OAUTH_PROVIDERS, type OAuthProvider, OAUTH_PROVIDER_SET } from './lib/oauth-providers';
