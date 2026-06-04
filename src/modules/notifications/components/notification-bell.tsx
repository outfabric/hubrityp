'use client';

import { Bell } from 'lucide-react';
import { useState } from 'react';

import type { NotificationView } from '@/modules/notifications';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';

import { NotificationDropdown } from './notification-dropdown';

/** Cap shown in the unread badge — keeps the pill from overflowing the bell. */
const MAX_BADGE_COUNT = 9;

export interface NotificationBellProps {
  /**
   * Notifications to render in the dropdown, newest-first. In the MVP this is
   * fetched server-side and passed in; the realtime hook (Section 3) will keep
   * it live.
   */
  notifications: NotificationView[];
  /**
   * Server-provided unread count for the badge. Decoupled from
   * `notifications.length` because the list is capped while the count is total.
   */
  initialUnreadCount: number;
  /** Marks a single notification read (wired to the Server Action by the consumer). */
  onMarkRead: (id: string) => void;
  /** Marks every notification read. */
  onMarkAllRead: () => void;
}

/**
 * App-header notification bell (RF-11.15).
 *
 * A `'use client'` leaf: it owns only the open/closed UI state and renders the
 * badge + dropdown. No data fetching, no secrets — all mutations are delegated
 * to the `onMark*` callbacks the consumer wires to authenticated Server Actions.
 *
 * Accessibility: the standalone icon trigger carries an `aria-label` (Sálvia
 * "ícones standalone: aria-label obrigatório") that reflects the unread count,
 * so screen-reader users hear how many notifications are pending.
 */
export function NotificationBell({
  notifications,
  initialUnreadCount,
  onMarkRead,
  onMarkAllRead,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);

  const hasUnread = initialUnreadCount > 0;
  const badgeText =
    initialUnreadCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(initialUnreadCount);

  const ariaLabel = hasUnread ? `Notificações, ${initialUnreadCount} não lidas` : 'Notificações';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={ariaLabel} className="relative">
          <Bell className="h-5 w-5" aria-hidden="true" />
          {hasUnread && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center',
                'bg-danger-500 text-text-inverse rounded-full px-1 text-[10px] leading-none font-medium',
              )}
            >
              {badgeText}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <NotificationDropdown
        notifications={notifications}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
        onAfterNavigate={() => setOpen(false)}
      />
    </DropdownMenu>
  );
}
