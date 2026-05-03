// Pinned versions of the LGPD legal documents the user accepts at signup.
//
// The signup flow stores these strings alongside each consent timestamp in
// `psychologist_profiles.{terms,privacy,sensitive_data_consent}_version`. The
// pinned identifier lets us replay later which document text the user agreed
// to, even after the docs are revised in the public site.
//
// `as const` is load-bearing — it preserves the literal types so consumers
// (signup form, factories, tests) can pin the exact version string at the
// type level. Bump the version here when a document changes; the schema
// columns are NOT NULL strings so missing entries fail at type-check.
export const documentVersions = {
  terms: '2026-05',
  privacy: '2026-05',
  sensitiveData: '2026-05',
} as const;

// Stable name for the document keys. Useful for typed accessors and for
// rendering the consent labels in the signup form without stringly-typing the
// keys at the call site.
export type DocumentKind = keyof typeof documentVersions;

// Typed accessor consumed by `signUpImpl` and the bloqueante pages. Mirroring
// the spec scenario "All three consents are persisted at signup", returning
// the literal type means the inserted row carries the exact string the form
// labelled the checkbox with.
export function getDocumentVersion<K extends DocumentKind>(kind: K): (typeof documentVersions)[K] {
  return documentVersions[kind];
}
