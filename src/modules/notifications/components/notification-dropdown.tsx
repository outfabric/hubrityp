'use client';

import {
  Bell,
  CalendarCheck,
  CalendarX,
  CheckCheck,
  FileClock,
  FileSignature,
  type LucideIcon,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import type { NotificationView } from '@/modules/notifications';
import { cn } from '@/shared/lib/utils';
import { DropdownMenuContent } from '@/shared/ui/dropdown-menu';

import { formatNotificationTime } from '../lib/relative-time';
// Runtime values (the type-meta resolver + the MVP enum type) are imported from
// the pure `lib/schemas` leaf, NOT the module barrel: the barrel re-exports
// server-only read actions, so importing a runtime VALUE through it would pull
// `server-only` into this client bundle and break the build.
import { getNotificationTypeMeta, type NotificationType } from '../lib/schemas';

/**
 * Maps each MVP notification type to its Lucide component.
 *
 * `schemas.ts` stays pure and React-free by storing icon *names*; this leaf is
 * the single place that resolves a name to a component. Keyed by the
 * `NotificationType` enum so the compiler enforces full coverage of the MVP
 * allowlist — adding a type without an icon here is a build error. There is
 * intentionally NO entry for post-MVP types (payments, Receita Saúde, WhatsApp
 * delivery): an unknown type can therefore never resolve to an icon/route, and
 * is rendered as an inert, non-actionable row.
 */
const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  session_confirmed: CalendarCheck,
  session_cancelled: CalendarX,
  evolution_pending: FileClock,
  consent_signed: FileSignature,
  ai_note_ready: Sparkles,
  ai_risk_alert: TriangleAlert,
  system_notice: Bell,
};

export interface NotificationDropdownProps {
  /** Notifications to list, newest-first. */
  notifications: NotificationView[];
  /** Marks a single notification read. */
  onMarkRead: (id: string) => void;
  /** Marks every notification read. */
  onMarkAllRead: () => void;
  /** Invoked after a row navigates, so the bell can close the menu. */
  onAfterNavigate?: () => void;
}

/**
 * Dropdown panel for the notification bell (RF-11.16).
 *
 * Lists notifications chronologically (the caller supplies them newest-first)
 * with a per-type Lucide icon, the PT-BR title, and a relative timestamp.
 * Clicking a row marks it read and routes to its action target. A header action
 * marks every notification read at once.
 *
 * Security / robustness:
 *   - Only MVP types render an icon and a clickable route. A post-MVP or
 *     tampered `type` resolves to `null` meta, so the row is shown as inert
 *     text with NO icon and NO navigation — it can never become a
 *     payment/Receita/WhatsApp affordance driven by an unexpected `type`.
 *   - The navigation target is the server-stored `actionUrl` when present, else
 *     the static per-type default route. Both are server-trusted path-relative
 *     values, never built from client input, so there is no open-redirect sink.
 */
export function NotificationDropdown({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onAfterNavigate,
}: NotificationDropdownProps) {
  const router = useRouter();

  const handleSelect = (notification: NotificationView, route: string) => {
    onMarkRead(notification.id);
    router.push(route);
    onAfterNavigate?.();
  };

  return (
    <DropdownMenuContent align="end" className="w-80 p-0" aria-label="Lista de notificações">
      <div className="border-border-subtle flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-text-primary text-sm font-semibold">Notificações</span>
        <button
          type="button"
          onClick={onMarkAllRead}
          className={cn(
            'text-brand-700 inline-flex items-center gap-1.5 rounded-md text-xs font-medium',
            'hover:text-brand-600 focus-visible:shadow-focus transition-colors focus-visible:outline-none',
          )}
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Marcar todas como lidas
        </button>
      </div>

      {notifications.length === 0 ? (
        <p className="text-text-tertiary px-4 py-8 text-center text-sm">
          Você não tem notificações.
        </p>
      ) : (
        <ul className="max-h-96 overflow-y-auto py-1">
          {notifications.map((notification) => {
            const meta = getNotificationTypeMeta(notification.type);

            // Unknown / post-MVP type: render inert text only — no icon, no
            // route, no click affordance.
            if (!meta) {
              return (
                <li
                  key={notification.id}
                  className="text-text-secondary px-4 py-3 text-sm"
                  data-notification-type={notification.type}
                >
                  <p className="text-text-primary font-medium">{notification.title}</p>
                  <span className="text-text-tertiary text-xs">
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </li>
              );
            }

            const Icon = TYPE_ICONS[notification.type as NotificationType];
            const route = notification.actionUrl ?? meta.route;
            const isUnread = notification.readAt === null;

            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(notification, route)}
                  data-notification-type={notification.type}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                    'hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none',
                    isUnread && 'bg-brand-50',
                  )}
                >
                  <Icon className="text-text-tertiary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="text-text-primary block truncate text-sm font-medium">
                      {notification.title}
                    </span>
                    <span className="text-text-tertiary mt-0.5 block text-xs">
                      {formatNotificationTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DropdownMenuContent>
  );
}
