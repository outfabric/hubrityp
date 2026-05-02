// Same-origin redirect validator shared by Server Actions, Route Handlers,
// and root middleware. The rule is intentionally strict so a hostile actor
// cannot weaponize a `redirectTo` query parameter to bounce a freshly
// authenticated user off-origin (open-redirect / phishing pivot).
//
// Accepted shapes for `target`:
//   • A path that begins with a single `/` (so `/dashboard`, `/dashboard?x=1`,
//     `/foo/bar` are all fine).
//
// Rejected shapes (anything else falls back to `fallback`):
//   • `null`, `undefined`, or empty string.
//   • A value that does not start with `/` (e.g. `?next=true`, `dashboard`).
//   • A protocol-relative URL like `//evil.com/...` — the browser would
//     resolve the host as `evil.com`.
//   • A value containing a backslash `\\`, which some user agents normalise
//     into `/` and can be abused to disguise an off-origin URL.
//   • A value with a `:` before the first `/` after position 0, which would
//     introduce a scheme (`javascript:`, `data:`, `mailto:`, `https:`).
//
// The function is a pure string check — no URL parsing, no allocation of a
// `URL` object — so it is safe to call from middleware on the hot path.
export function safeRedirect(target: string | null | undefined, fallback: string): string {
  if (target === null || target === undefined || target === '') return fallback;
  if (!target.startsWith('/')) return fallback;
  if (target.startsWith('//')) return fallback;
  if (target.includes('\\')) return fallback;

  // Detect a scheme-like prefix: anything before the first internal `/` that
  // contains a `:` is treated as a scheme attempt. Position 0 is the leading
  // `/` we already required, so we slice from 1 and look for the next `/`.
  const firstSlash = target.indexOf('/', 1);
  const head = firstSlash === -1 ? target.slice(1) : target.slice(1, firstSlash);
  if (head.includes(':')) return fallback;

  return target;
}
