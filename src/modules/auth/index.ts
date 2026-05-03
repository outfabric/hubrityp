// Public API of the `auth` module.
//
// Per the `reorganize-folder-structure` design decision, every module exposes
// its surface through a single `index.ts` barrel — consumers MUST import from
// `@/modules/auth`, never from internal paths like `@/modules/auth/lib/...`.
//
// `signIn` and `signOut` are re-exported here as the module's public action
// surface for **server-side consumers** (other route shells, server tests).
// The route shells in `src/app/(auth)/login/actions.ts` and
// `src/app/(app)/actions.ts` are thin `'use server'` wrappers that delegate
// to these implementations. The shells exist purely to mark the files as
// Server Action modules for the Next.js compiler — this `index.ts` MUST NOT
// carry `'use server'`, because then `loginInputSchema`/`safeRedirect`/etc.
// would be transformed into RPC stubs and break client-side imports.
//
// Client Components (`./components/login-form.tsx`) MUST NOT consume `signIn`
// from this barrel: doing so drags the `'server-only'` chain (logger,
// Supabase server client) into the browser bundle and the RSC boundary
// checker rejects the build. Instead, Client Components import the action
// from the route shell (`@/app/(auth)/login/actions`) which Next.js compiles
// into a client-safe RPC stub.

export { loginInputSchema, type LoginInput } from './lib/login-input-schema';
export { mapSupabaseUser, type AppUser } from './lib/map-supabase-user';
export { safeRedirect } from './lib/safe-redirect';

export { LoginForm, type LoginFormProps } from './components/login-form';

export { signInImpl as signIn, type SignInResult } from './server/login';
export { signOutImpl as signOut } from './server/logout';
