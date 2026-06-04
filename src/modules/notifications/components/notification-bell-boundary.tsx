'use client';

import { useCallback, useState } from 'react';

import type { NotificationView } from '@/modules/notifications';

import { useNotificationsRealtime } from '../hooks/use-notifications-realtime';

import { NotificationBell } from './notification-bell';

export interface NotificationBellBoundaryProps {
  /**
   * Authenticated user id, resolved server-side in the layout and passed down.
   * Never client-controlled. When absent the realtime hook does not subscribe.
   */
  userId: string | null;
  /** Server-fetched notifications (newest-first) for the dropdown. */
  notifications: NotificationView[];
  /** Server-fetched unread count seeding the badge. */
  initialUnreadCount: number;
  /**
   * Fire-and-forget Server Action marking a single notification read. The id is
   * authorized server-side from the session; passing it here only identifies
   * which row to mark and can never widen access.
   */
  markRead: (id: string) => Promise<void>;
  /** Fire-and-forget Server Action marking every notification read. */
  markAllRead: () => Promise<void>;
}

/**
 * Client boundary that keeps `(app)/layout.tsx` a Server Component while owning
 * the live unread-count state and the realtime subscription for the bell.
 *
 * The server seeds `initialUnreadCount`; an INSERT on the owner's `notifications`
 * stream bumps the local count by one (RNF-11.04 — live counter without a
 * refresh). Marking read decrements optimistically and delegates the
 * authoritative mutation to the passed Server Actions, which authorize from the
 * session. The realtime channel is owner-filtered (`user_id=eq.<userId>`) and
 * RLS double-scopes it — a client never receives another user's rows.
 */
export function NotificationBellBoundary({
  userId,
  notifications,
  initialUnreadCount,
  markRead,
  markAllRead,
}: NotificationBellBoundaryProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  // Stable callback so the realtime effect does not resubscribe on every render.
  const handleInsert = useCallback(() => {
    setUnreadCount((current) => current + 1);
  }, []);

  useNotificationsRealtime(userId, handleInsert);

  const handleMarkRead = useCallback(
    (id: string) => {
      // Optimistic local decrement; the count floors at zero so a re-mark or a
      // stale row can never drive the badge negative.
      setUnreadCount((current) => Math.max(0, current - 1));
      void markRead(id);
    },
    [markRead],
  );

  const handleMarkAllRead = useCallback(() => {
    setUnreadCount(0);
    void markAllRead();
  }, [markAllRead]);

  return (
    <NotificationBell
      notifications={notifications}
      initialUnreadCount={unreadCount}
      onMarkRead={handleMarkRead}
      onMarkAllRead={handleMarkAllRead}
    />
  );
}
