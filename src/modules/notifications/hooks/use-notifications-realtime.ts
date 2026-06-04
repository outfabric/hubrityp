'use client';

import { useEffect } from 'react';

import { createBrowserClient } from '@/shared/supabase/client';

// ---------------------------------------------------------------------------
// Realtime contract
//
// Mirrors the established `postgres_changes` subscription pattern used across
// the app: subscribe on mount, clean up on unmount. We listen to INSERTs on
// `public.notifications` scoped to the authenticated owner via the channel
// filter `user_id=eq.<userId>`. This is defense in depth WITH RLS — the RLS
// SELECT policy (`auth.uid() = user_id`) already prevents another user's rows
// from being streamed; the channel filter is a second, redundant scope so a
// client never even subscribes to another user's stream.
//
// `userId` always comes from the server-side session (resolved in the layout
// and passed down), never from client-controlled input — so the filter cannot
// be widened to read another tenant's notifications.
// ---------------------------------------------------------------------------

const NOTIFICATIONS_CHANNEL_PREFIX = 'notifications';
const NOTIFICATIONS_TABLE = 'notifications';
const NOTIFICATIONS_SCHEMA = 'public';

/** Per-user channel name. Derived from the session UUID, never from input. */
function notificationsChannelName(userId: string): string {
  return `${NOTIFICATIONS_CHANNEL_PREFIX}:${userId}`;
}

/** Owner-scoping Realtime filter for the `notifications` table. */
function ownerFilter(userId: string): string {
  return `user_id=eq.${userId}`;
}

/**
 * Subscribes to the authenticated user's `notifications` INSERT stream and
 * invokes `onInsert` for each new notification row, so the bell's unread count
 * can be bumped live without a page refresh.
 *
 * The subscription is created on mount and torn down on unmount (or when
 * `userId` changes). Passing an empty/falsy `userId` is a no-op — the hook does
 * not subscribe (e.g., before the session is known), so we never open a stray
 * unfiltered channel.
 *
 * `onInsert` receives no payload: the count is bumped by one per INSERT and the
 * authoritative count is re-fetched/served by the server. We intentionally do
 * NOT trust the streamed row for any authorization or rendering decision — it
 * is untrusted transport, and the only effect is incrementing a local counter.
 *
 * @param userId  Authenticated user id, resolved server-side. Never client input.
 * @param onInsert  Called once per delivered INSERT event for this user.
 */
export function useNotificationsRealtime(
  userId: string | null | undefined,
  onInsert: () => void,
): void {
  useEffect(() => {
    if (!userId) {
      return;
    }

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(notificationsChannelName(userId))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: NOTIFICATIONS_SCHEMA,
          table: NOTIFICATIONS_TABLE,
          filter: ownerFilter(userId),
        },
        () => {
          onInsert();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, onInsert]);
}
