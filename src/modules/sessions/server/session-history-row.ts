import 'server-only';

import { sql } from 'drizzle-orm';

import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';

import {
  type PatientId,
  type SessionHistoryItem,
  type SessionHistoryStatus,
  type SessionModality,
} from '../lib/session-history-schema';

/**
 * Shared row projection + mapper for the patient session-history reads
 * (`getNearestFutureSession` and `getPatientSessionHistoryList`).
 *
 * Couple-safe projection (LGPD-13.03, RN-13.06): the SELECT exposes only the
 * boolean presence of `patient_ids` (`isCouple`) — it NEVER selects the partner
 * patient id, name, or any join to the partner row. There is intentionally no
 * way to surface a partner identifier through this projection.
 *
 * The "Remarcada de [data]" original date is resolved by an owner-scoped,
 * `start_at`-only correlated subquery against the source session referenced by
 * `rescheduled_from_session_id`. It selects exactly one column (`start_at`), so
 * no other field of the original session can leak.
 */
export const sessionHistoryColumns = {
  id: sessions.id,
  patientId: sessions.patientId,
  status: sessions.status,
  startAt: sessions.startAt,
  endAt: sessions.endAt,
  durationMinutes: sessions.durationMinutes,
  modality: sessions.modality,
  locationName: locations.name,
  amount: sessions.amount,
  // Couple presence only — never the partner id/name (LGPD-13.03, RN-13.06).
  isCouple: sql<boolean>`(${sessions.patientIds} is not null)`,
  isLateRecord: sessions.isLateRecord,
  // Original date of the most-recent reschedule, owner-scoped, start_at only.
  rescheduledFromStartAt: sql<Date | null>`(
    select orig.start_at
    from ${sessions} as orig
    where orig.id = ${sessions.rescheduledFromSessionId}
      and orig.user_id = ${sessions.userId}
    limit 1
  )`,
  evolutionId: evolutions.id,
  evolutionFinalizedAt: evolutions.finalizedAt,
  cancellationReason: sessions.cancellationReason,
  cancelledBy: sessions.cancelledBy,
  cancellationNotice: sessions.cancellationNotice,
  chargeCancellation: sessions.chargeCancellation,
} as const;

/** Raw shape returned by a `select(sessionHistoryColumns)` query. */
export interface SessionHistoryRow {
  id: string;
  patientId: string | null;
  status: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  modality: string | null;
  locationName: string | null;
  amount: string | null;
  isCouple: boolean;
  isLateRecord: boolean;
  rescheduledFromStartAt: Date | string | null;
  evolutionId: string | null;
  evolutionFinalizedAt: Date | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancellationNotice: string | null;
  chargeCancellation: boolean | null;
}

/** Normalizes a driver timestamp (Date or string) to a stable ISO-8601 instant. */
function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Maps a raw DB row to the serializable `SessionHistoryItem` returned across the
 * RSC / client boundary. All timestamps become ISO strings; `amount` (stored as
 * text for decimal safety) is parsed to a number, or `null` when absent/invalid.
 */
export function mapSessionRow(row: SessionHistoryRow): SessionHistoryItem {
  const amount = row.amount === null ? null : Number.parseFloat(row.amount);

  return {
    id: row.id,
    patientId: row.patientId as PatientId,
    status: row.status as SessionHistoryStatus,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: row.durationMinutes,
    modality: row.modality as SessionModality | null,
    locationName: row.locationName,
    amount: amount === null || Number.isNaN(amount) ? null : amount,
    isCouple: row.isCouple,
    isLateRecord: row.isLateRecord,
    rescheduledFromDate: toIso(row.rescheduledFromStartAt),
    evolutionId: row.evolutionId,
    evolutionFinalizedAt: toIso(row.evolutionFinalizedAt),
    cancellationReason: row.cancellationReason,
    cancelledBy: row.cancelledBy,
    cancellationNotice: row.cancellationNotice,
    chargeCancellation: row.chargeCancellation,
  };
}
