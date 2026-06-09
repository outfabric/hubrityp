/**
 * Zod schemas and result types for the patient session-history read.
 *
 * Single source of truth (D8) for:
 *   - Server Action input validation (reject tampered requests before the DB)
 *   - Type derivation via `z.infer`
 *
 * The result is a discriminated union (`{ ok: true; … } | { ok: false; code }`)
 * so invalid combinations (e.g. data present alongside an error code) are
 * unrepresentable.
 *
 * Error messages are in pt-BR to match the product surface.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Branded patient id
// ---------------------------------------------------------------------------

/**
 * Branded `PatientId` — prevents accidental assignment of a raw `string`
 * where a validated patient UUID is expected (catches ID mix-ups at compile
 * time). Follows the branded-type convention used across the codebase.
 */
export const PatientIdSchema = z
  .string()
  .uuid({ message: 'ID de paciente inválido.' })
  .brand<'PatientId'>();

export type PatientId = z.infer<typeof PatientIdSchema>;

// ---------------------------------------------------------------------------
// History status filter
// ---------------------------------------------------------------------------

/**
 * The statuses a user can filter the history list by. Restricted to the
 * terminal states surfaced in the history tab (the future session and the
 * scheduled/confirmed lifecycle are handled separately).
 */
export const SESSION_HISTORY_STATUSES = ['done', 'cancelled', 'no_show'] as const;

export type SessionHistoryStatus = (typeof SESSION_HISTORY_STATUSES)[number];

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const HISTORY_LIMIT_MIN = 1;
const HISTORY_LIMIT_MAX = 50;
const HISTORY_LIMIT_DEFAULT = 12;

export const sessionHistoryInputSchema = z.object({
  patientId: PatientIdSchema,

  /** Opaque cursor encoding `(start_at, id)` of the last item of the prior page. */
  cursor: z.string().optional(),

  /** Optional terminal-status filter. Omitted = all history statuses. */
  status: z.enum(SESSION_HISTORY_STATUSES, { message: 'Status inválido.' }).optional(),

  /** Page size, clamped to the [1, 50] range; defaults to 12. */
  limit: z
    .number()
    .int({ message: 'O limite deve ser um número inteiro.' })
    .catch(HISTORY_LIMIT_DEFAULT)
    .transform((value) => Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, value)))
    .default(HISTORY_LIMIT_DEFAULT),
});

export type SessionHistoryInput = z.infer<typeof sessionHistoryInputSchema>;

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/** Session modality as stored in `sessions.modality`. */
export type SessionModality = 'in_person' | 'online';

/**
 * A single row of the history list (and the same shape used for the future
 * session). All timestamps are ISO-8601 strings so the result is serializable
 * across the RSC / client boundary.
 */
export interface SessionHistoryItem {
  id: string;
  patientId: PatientId;
  status: SessionHistoryStatus;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  modality: SessionModality | null;
  locationName: string | null;
  amount: number | null;
  isCouple: boolean;
  isLateRecord: boolean;
  rescheduledFromDate: string | null;
  evolutionId: string | null;
  evolutionFinalizedAt: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancellationNotice: string | null;
  chargeCancellation: boolean | null;
}

/** Aggregate summary computed by the single summary query (D3). */
export interface SessionHistorySummary {
  doneTotal: number;
  /** Integer percentage in `[0, 100]`; `0` when there are no countable sessions. */
  attendanceRate: number;
  doneWithoutEvolution: number;
  lastDoneAt: string | null;
}

// ---------------------------------------------------------------------------
// Result discriminated union
// ---------------------------------------------------------------------------

export type SessionHistoryErrorCode = 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR';

export type SessionHistoryResult =
  | {
      ok: true;
      summary?: SessionHistorySummary;
      futureSession?: SessionHistoryItem;
      sessions: SessionHistoryItem[];
      nextCursor: string | null;
    }
  | { ok: false; code: SessionHistoryErrorCode };
