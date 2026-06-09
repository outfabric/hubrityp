'use client';

/**
 * useSessionHistoryFilter — the hybrid (client ≤50 / server >50) status filter
 * for the patient session-history tab (D5, RF-13.10–13.14).
 *
 * The loaded pages are held client-side by a TanStack Query `useInfiniteQuery`.
 * The status filter is applied two different ways depending on how much history
 * is loaded:
 *
 *   - **≤ 50 loaded** — the filter is a *pure client-side selector* over the
 *     already-loaded list. No refetch happens: changing the chip just narrows
 *     what is rendered. The query key does NOT carry the status, so the cache is
 *     shared across filters and scroll position is preserved.
 *
 *   - **> 50 loaded** — the filter is pushed into the query as a `status`
 *     parameter. This changes the query key, so TanStack Query resets pagination
 *     and refetches the first page server-filtered. Keeping >50 rows of every
 *     status in memory and re-filtering client-side is wasteful, so above the
 *     threshold the server does the narrowing.
 *
 * The nearest-future session is OUTSIDE this list entirely (it lives on the
 * first page's `futureSession`, surfaced separately by the container) and is
 * therefore always visible regardless of the active filter — `visibleSessions`
 * never contains it.
 *
 * The fetcher is injected (`fetchPage`) so the hook can be unit-tested without
 * touching the Server Action; the container passes the real Server Action.
 */

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type {
  SessionHistoryItem,
  SessionHistoryResult,
  SessionHistoryStatus,
} from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Hybrid-filter decision (pure — unit-tested in isolation)
// ---------------------------------------------------------------------------

/**
 * Above this many loaded sessions the status filter moves from a client-side
 * selector to a server query parameter (D5). At or below it, filtering is a
 * pure selector over the loaded list with no refetch.
 */
export const CLIENT_FILTER_THRESHOLD = 50;

/** `true` once enough history is loaded that the server should do the filtering. */
export function shouldFilterServerSide(totalLoaded: number): boolean {
  return totalLoaded > CLIENT_FILTER_THRESHOLD;
}

/**
 * The `status` value that actually reaches the query key / Server Action.
 *
 * Below the threshold it is always `undefined` (the server returns every
 * status and the client narrows), so toggling the chip never changes the key
 * and never triggers a refetch. Above the threshold the active filter is the
 * server parameter, so changing it resets pagination and refetches.
 */
export function resolveServerStatus(
  filter: SessionHistoryStatus | undefined,
  totalLoaded: number,
): SessionHistoryStatus | undefined {
  return shouldFilterServerSide(totalLoaded) ? filter : undefined;
}

/**
 * The sessions to render given the loaded pages and the active filter.
 *
 * - When the server is already filtering (>50 loaded), the loaded list is
 *   returned as-is — every row already matches the active status.
 * - Otherwise the active status (when set) narrows the loaded list client-side;
 *   `undefined` ("Todas") returns everything loaded.
 *
 * The future session is never part of `loaded`, so it is never returned here.
 */
export function selectVisibleSessions(
  loaded: readonly SessionHistoryItem[],
  filter: SessionHistoryStatus | undefined,
): SessionHistoryItem[] {
  if (filter === undefined) return [...loaded];
  if (shouldFilterServerSide(loaded.length)) return [...loaded];
  return loaded.filter((session) => session.status === filter);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** A successful page of the session history (the `ok: true` arm of the union). */
type SessionHistoryPage = Extract<SessionHistoryResult, { ok: true }>;

/** Minimal shape of TanStack's `InfiniteData` cache we read for the loaded count. */
interface CachedInfiniteData {
  pages: SessionHistoryPage[];
}

/** Total history rows held by a cached infinite query (0 when absent). */
function countLoadedSessions(data: unknown): number {
  const pages = (data as CachedInfiniteData | undefined)?.pages;
  if (!pages) return 0;
  return pages.reduce((total, page) => total + page.sessions.length, 0);
}

/** Fetches one page of history. Injected so the hook is testable in isolation. */
export type FetchSessionHistoryPage = (input: {
  patientId: string;
  cursor?: string;
  status?: SessionHistoryStatus;
}) => Promise<SessionHistoryResult>;

export interface UseSessionHistoryFilterParams {
  /** Owner-scoped server-side; passed through only to fetch the right patient. */
  patientId: string;
  /** Active chip filter; `undefined` = "Todas". */
  filter: SessionHistoryStatus | undefined;
  /** Page fetcher — the real Server Action in the app, a fake in tests. */
  fetchPage: FetchSessionHistoryPage;
}

/** A thrown marker so TanStack Query's `error` state carries the server code. */
export class SessionHistoryFetchError extends Error {
  constructor(readonly code: string) {
    super(`session-history fetch failed: ${code}`);
    this.name = 'SessionHistoryFetchError';
  }
}

export function useSessionHistoryFilter({
  patientId,
  filter,
  fetchPage,
}: UseSessionHistoryFilterParams) {
  const queryClient = useQueryClient();

  // How many history rows are already loaded under the *client-side* key (status
  // omitted). This count decides whether the active filter stays a client
  // selector (≤50) or flips the query into server-filtering mode (>50).
  //
  // Reading it from the cache (rather than from `query.data`) avoids a
  // use-before-declaration cycle and lets the key be computed before the query
  // is created. While ≤50, `serverStatus` is `undefined` → the key is stable
  // across filter changes → toggling a chip never refetches. Once >50 rows are
  // loaded, `serverStatus` becomes the active filter → the key changes →
  // TanStack Query resets pagination and refetches the first page server-filtered.
  const clientModeKey = ['patient-session-history', patientId, undefined] as const;
  const clientModeLoaded = countLoadedSessions(queryClient.getQueryData(clientModeKey));
  const serverStatus = resolveServerStatus(filter, clientModeLoaded);

  const query = useInfiniteQuery({
    queryKey: ['patient-session-history', patientId, serverStatus] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, queryKey }) => {
      const [, , status] = queryKey;
      const result = await fetchPage({ patientId, cursor: pageParam, status });
      if (!result.ok) throw new SessionHistoryFetchError(result.code);
      return result;
    },
    getNextPageParam: (lastPage: SessionHistoryPage) => lastPage.nextCursor ?? undefined,
    // The summary + future session only come on the first page; downstream reads
    // them off `pages[0]`. Retain the cache briefly so tab re-opens are instant.
    staleTime: 30_000,
    retry: 1,
  });

  const pages = useMemo<SessionHistoryPage[]>(() => query.data?.pages ?? [], [query.data]);

  const loadedSessions = useMemo<SessionHistoryItem[]>(
    () => pages.flatMap((page) => page.sessions),
    [pages],
  );

  const visibleSessions = useMemo(
    () => selectVisibleSessions(loadedSessions, filter),
    [loadedSessions, filter],
  );

  const firstPage = pages[0];

  return {
    /** Sessions to render under the active filter (never includes the future one). */
    visibleSessions,
    /** Aggregate summary — only present once the first page has loaded. */
    summary: firstPage?.summary,
    /** Nearest future session — outside the filter, always shown when present. */
    futureSession: firstPage?.futureSession,
    /** Whether the active filter is currently being applied server-side (>50 loaded). */
    isServerFiltered: serverStatus !== undefined,
    /** Total currently-loaded historical sessions (pre-filter). */
    totalLoaded: loadedSessions.length,
    // ---- Pass-through TanStack Query state ----
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
