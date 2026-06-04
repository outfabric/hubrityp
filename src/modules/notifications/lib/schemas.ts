import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input schemas (Zod is the single source of truth — types via z.infer)
// ---------------------------------------------------------------------------

/**
 * Input for `markNotificationRead`. The only accepted field is the
 * notification `id`; ownership is authorized server-side from the session
 * (`user_id = auth.uid()`), never from this input. A non-UUID `id` is rejected
 * at the boundary before any query runs.
 */
export const markReadInputSchema = z.object({
  id: z.string().uuid(),
});

export type MarkReadInput = z.infer<typeof markReadInputSchema>;

// ---------------------------------------------------------------------------
// MVP notification type allowlist
// ---------------------------------------------------------------------------

/**
 * Canonical allowlist of notification `type` discriminators shipped in the MVP.
 * Post-MVP kinds (Receita Saúde, cobranças/PIX, WhatsApp delivery, etc.) are
 * intentionally excluded here so that an unexpected or future `type` written to
 * the table never resolves to an icon/route and cannot drive client rendering
 * until it is explicitly added to this allowlist.
 */
export const notificationTypeSchema = z.enum([
  'session_confirmed',
  'session_cancelled',
  'evolution_pending',
  'consent_signed',
  'ai_note_ready',
  'ai_risk_alert',
  'system_notice',
]);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

// ---------------------------------------------------------------------------
// Per-type presentation map (pure: icon name + default route)
// ---------------------------------------------------------------------------

/**
 * Presentation metadata for a notification type.
 *
 * `icon` is the *name* of a Lucide icon (not the component) so this module
 * stays pure and free of React/client dependencies — the UI leaf maps the name
 * to a `lucide-react` component. `route` is a server-trusted, path-relative
 * default deep-link for the type (the per-notification `actionUrl`, when
 * present, takes precedence at render time). Routes are static literals, never
 * built from user input, so they cannot become an open-redirect sink.
 */
export interface NotificationTypeMeta {
  /** Lucide icon component name (e.g., 'CalendarCheck'). */
  icon: string;
  /** Path-relative default deep-link for this notification type. */
  route: string;
}

/**
 * Maps every MVP notification type to its icon name and default route.
 *
 * Declared `satisfies Record<NotificationType, NotificationTypeMeta>` so the
 * compiler enforces that the map covers EXACTLY the allowlist — adding a type
 * to the enum without a meta entry (or vice versa) is a build error.
 */
export const notificationTypeMeta = {
  session_confirmed: { icon: 'CalendarCheck', route: '/agenda' },
  session_cancelled: { icon: 'CalendarX', route: '/agenda' },
  evolution_pending: { icon: 'FileClock', route: '/pacientes' },
  consent_signed: { icon: 'FileSignature', route: '/pacientes' },
  ai_note_ready: { icon: 'Sparkles', route: '/pacientes' },
  ai_risk_alert: { icon: 'TriangleAlert', route: '/pacientes' },
  system_notice: { icon: 'Bell', route: '/dashboard' },
} satisfies Record<NotificationType, NotificationTypeMeta>;

/**
 * Resolves presentation metadata for a notification `type`. Returns `null` for
 * any value outside the MVP allowlist (post-MVP or tampered types), so the
 * caller can fall back to a neutral default rather than trusting the input.
 */
export function getNotificationTypeMeta(type: string): NotificationTypeMeta | null {
  const parsed = notificationTypeSchema.safeParse(type);
  return parsed.success ? notificationTypeMeta[parsed.data] : null;
}
