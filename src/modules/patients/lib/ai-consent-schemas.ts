import { z } from 'zod';

/**
 * Zod schemas for AI consent term operations.
 *
 * Single source of truth for:
 *   - Server Action input validation (reject tampered requests before touching the DB)
 *   - Type derivation via `z.infer`
 *
 * Branded `PatientId` prevents accidental assignment of a raw `string`
 * where a validated patient UUID is expected.
 */

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

export const PatientIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const GenerateAiConsentInputSchema = z.object({
  patientId: PatientIdSchema,
});
export type GenerateAiConsentInput = z.infer<typeof GenerateAiConsentInputSchema>;

export const RevokeAiConsentInputSchema = z.object({
  patientId: PatientIdSchema,
  reason: z.string().max(500).nullable(),
});
export type RevokeAiConsentInput = z.infer<typeof RevokeAiConsentInputSchema>;

export const GetAiConsentStatusInputSchema = z.object({
  patientId: PatientIdSchema,
});
export type GetAiConsentStatusInput = z.infer<typeof GetAiConsentStatusInputSchema>;

// ---------------------------------------------------------------------------
// Output types (discriminated unions)
// ---------------------------------------------------------------------------

export type GenerateAiConsentResult =
  | { ok: true; publicUrl: string; expiresAt: Date }
  | { ok: false; error: 'UNAUTHORIZED' }
  | { ok: false; error: 'NOT_FOUND' }
  | { ok: false; error: 'ALREADY_ACTIVE' }
  | { ok: false; error: 'VALIDATION_ERROR'; message: string }
  | { ok: false; error: 'INTERNAL_ERROR' };

export type RevokeAiConsentResult =
  | { ok: true }
  | { ok: false; error: 'UNAUTHORIZED' }
  | { ok: false; error: 'NOT_FOUND' }
  | { ok: false; error: 'VALIDATION_ERROR'; message: string }
  | { ok: false; error: 'INTERNAL_ERROR' };

export type AiConsentStatusView =
  | { state: 'none' }
  | { state: 'pending'; publicUrl: string; expiresAt: Date; createdAt: Date }
  | { state: 'active'; signedAt: Date; templateVersion: number }
  | { state: 'revoked'; revokedAt: Date; reason: string | null };

export type GetAiConsentStatusResult =
  | { ok: true; consent: AiConsentStatusView }
  | { ok: false; error: 'UNAUTHORIZED' }
  | { ok: false; error: 'NOT_FOUND' }
  | { ok: false; error: 'VALIDATION_ERROR'; message: string };
