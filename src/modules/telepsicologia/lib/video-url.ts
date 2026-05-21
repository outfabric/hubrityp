/**
 * Generates the public patient video URL from a base URL and a 64-char hex token.
 *
 * URL pattern: `${baseUrl}/v/${token}` — mirrors the existing `confirmar-sessao/[token]`
 * and `termo/[token]` public URL patterns.
 *
 * Edge-safe — no Node-only deps.
 */

const HEX_64_REGEX = /^[0-9a-f]{64}$/;

/**
 * Build the patient-facing video URL for a telepsychology session.
 *
 * @param baseUrl - Application base URL (e.g. `https://app.hubrityp.com.br`).
 *   A single trailing slash is stripped to avoid a double slash in the output.
 * @param token  - 64-character lowercase hex lookup token (`patient_token`).
 * @returns The full URL: `${baseUrl}/v/${token}`.
 * @throws {Error} If `token` is not exactly 64 lowercase hex characters.
 */
export function generatePatientVideoUrl(baseUrl: string, token: string): string {
  if (!HEX_64_REGEX.test(token)) {
    throw new Error(
      `Invalid patient token: expected a 64-character lowercase hex string, got "${token.length > 80 ? token.slice(0, 20) + '...' : token}" (length ${token.length}).`,
    );
  }

  // Normalize: strip a single trailing slash from baseUrl so we never produce "//v/".
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBase}/v/${token}`;
}
