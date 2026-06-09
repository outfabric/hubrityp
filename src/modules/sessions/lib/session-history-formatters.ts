/**
 * Client-safe presentation helpers for the patient session-history tab.
 *
 * Every date display and the month/year grouping go through
 * `formatInTimeZone(..., 'America/Sao_Paulo', …)` with the `pt-BR` locale
 * (design.md D6), so the December→January boundary lands in the right month
 * regardless of the viewer's machine timezone.
 *
 * These are pure, dependency-free formatters and lookup maps — no `server-only`
 * import — so the history list/cards may render them in a client component.
 */

import type { VariantProps } from 'class-variance-authority';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  MapPin,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { badgeVariants } from '@/shared/ui/badge';

import type { SessionModality } from './session-history-schema';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/** Variant accepted by the Salvia `Badge` primitive. */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

// ---------------------------------------------------------------------------
// Month/year grouping (SP timezone)
// ---------------------------------------------------------------------------

/**
 * Stable grouping key for a session, derived from its São Paulo wall-clock
 * month. `yyyy-MM` sorts lexicographically in chronological order and keeps the
 * year-boundary unambiguous (`2025-12` vs `2026-01`), so a December session and
 * a January session never collapse into the same divider.
 */
export function monthGroupKey(isoDate: string): string {
  return formatInTimeZone(isoDate, SAO_PAULO_TZ, 'yyyy-MM');
}

/**
 * Human-readable divider label for a month group, e.g. `"dezembro de 2025"`.
 * Rendered upper-cased by the divider component (`caption-upper`), so the
 * lower-case `pt-BR` month name is intentional here.
 */
export function monthGroupLabel(isoDate: string): string {
  return formatInTimeZone(isoDate, SAO_PAULO_TZ, "MMMM 'de' yyyy", { locale: ptBR });
}

// ---------------------------------------------------------------------------
// Date / time display (SP timezone)
// ---------------------------------------------------------------------------

/**
 * Full date with weekday for a session row, e.g.
 * `"segunda-feira, 15 de dezembro de 2025"`.
 */
export function formatFullDateWithWeekday(isoDate: string): string {
  return formatInTimeZone(isoDate, SAO_PAULO_TZ, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

/** São Paulo wall-clock time, e.g. `"14:30"`. */
export function formatTime(isoDate: string): string {
  return formatInTimeZone(isoDate, SAO_PAULO_TZ, 'HH:mm', { locale: ptBR });
}

/** Time range across start/end, e.g. `"14:30 – 15:20"` (en-dash separator). */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

// ---------------------------------------------------------------------------
// Status → badge variant / icon / label (RF-13.06)
// ---------------------------------------------------------------------------

/** Full session lifecycle status (matches the `sessions.status` CHECK). */
export type SessionDisplayStatus = 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';

export interface StatusPresentation {
  badgeVariant: BadgeVariant;
  lucideIcon: LucideIcon;
  label: string;
}

/**
 * Status → `{ badgeVariant, lucideIcon, label }` (RF-13.06). The map is the
 * single source of truth for how every session status is surfaced; components
 * read from it rather than branching on the raw status string.
 */
export const STATUS_PRESENTATION: Record<SessionDisplayStatus, StatusPresentation> = {
  scheduled: { badgeVariant: 'info', lucideIcon: Calendar, label: 'Agendada' },
  confirmed: { badgeVariant: 'info', lucideIcon: CheckCircle2, label: 'Confirmada' },
  done: { badgeVariant: 'success', lucideIcon: CheckCircle2, label: 'Realizada' },
  cancelled: { badgeVariant: 'neutral', lucideIcon: X, label: 'Cancelada' },
  no_show: { badgeVariant: 'warning', lucideIcon: AlertTriangle, label: 'Não compareceu' },
};

// ---------------------------------------------------------------------------
// Modality → icon (RF-13.06)
// ---------------------------------------------------------------------------

/** Modality → Lucide icon: `MapPin` for in-person, `Video` for online. */
export const MODALITY_ICON: Record<SessionModality, LucideIcon> = {
  in_person: MapPin,
  online: Video,
};

// ---------------------------------------------------------------------------
// Finalized-evolution read-only hint (RN-13.05)
// ---------------------------------------------------------------------------

const FINALIZED_READ_ONLY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether a finalized evolution is past its 30-day edit window and must be
 * shown as a read-only "Finalizada" hint (RN-13.05).
 *
 * `true` only when `finalizedAt` is set AND strictly older than 30 days.
 * A `null` finalized timestamp (never finalized) returns `false`.
 *
 * @param finalizedAt ISO-8601 timestamp the evolution was finalized, or `null`.
 * @param now Reference instant (injectable for deterministic tests).
 */
export function isFinalizedReadOnly(finalizedAt: string | null, now: Date = new Date()): boolean {
  if (finalizedAt === null) return false;
  const finalizedMs = new Date(finalizedAt).getTime();
  if (Number.isNaN(finalizedMs)) return false;
  const ageMs = now.getTime() - finalizedMs;
  return ageMs > FINALIZED_READ_ONLY_DAYS * MS_PER_DAY;
}
