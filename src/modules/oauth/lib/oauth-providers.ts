/**
 * Canonical set of supported OAuth providers.
 *
 * This is the single source of truth for which OAuth providers the
 * platform supports. Any code that checks or dispatches on a provider
 * name should reference `OAUTH_PROVIDERS` or the `OAuthProvider` type.
 *
 * Pure module — no I/O.
 */
export const OAUTH_PROVIDERS = ['google'] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Set form — for fast membership checks. */
export const OAUTH_PROVIDER_SET: ReadonlySet<OAuthProvider> = new Set(OAUTH_PROVIDERS);
