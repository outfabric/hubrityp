import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Hash an email for audit/log metadata. Never log the raw email — only
 * the truncated SHA-256 hash is stored so ops can correlate attempts
 * without exposing PII (LGPD compliance).
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
}
