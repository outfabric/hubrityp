// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CLIENT_FILTER_THRESHOLD,
  resolveServerStatus,
  selectVisibleSessions,
  shouldFilterServerSide,
  useSessionHistoryFilter,
  type FetchSessionHistoryPage,
} from '@/modules/sessions/hooks/use-session-history-filter';
import type {
  PatientId,
  SessionHistoryItem,
  SessionHistoryResult,
  SessionHistoryStatus,
} from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

/** Builds a terminal-status history item with the fields the hook touches. */
function makeSession(
  id: number,
  status: SessionHistoryStatus,
  overrides: Partial<SessionHistoryItem> = {},
): SessionHistoryItem {
  const idStr = String(id).padStart(12, '0');
  return {
    id: `00000000-0000-0000-0000-${idStr}`,
    patientId: PATIENT_ID as PatientId,
    status,
    startAt: '2025-12-15T14:30:00.000Z',
    endAt: '2025-12-15T15:20:00.000Z',
    durationMinutes: 50,
    modality: 'online',
    locationName: null,
    amount: null,
    isCouple: false,
    isLateRecord: false,
    rescheduledFromDate: null,
    evolutionId: null,
    evolutionFinalizedAt: null,
    cancellationReason: null,
    cancelledBy: null,
    cancellationNotice: null,
    chargeCancellation: null,
    ...overrides,
  };
}

const FUTURE_SESSION = makeSession(9999, 'done', {
  id: '00000000-0000-0000-0000-future0000',
  startAt: '2099-01-01T14:30:00.000Z',
});

function okPage(
  sessions: SessionHistoryItem[],
  nextCursor: string | null,
  extras: { withFuture?: boolean } = {},
): Extract<SessionHistoryResult, { ok: true }> {
  return {
    ok: true,
    sessions,
    nextCursor,
    ...(extras.withFuture ? { futureSession: FUTURE_SESSION } : {}),
  };
}

function wrapperWith(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// ---------------------------------------------------------------------------
// Pure decision helpers
// ---------------------------------------------------------------------------

describe('hybrid-filter decision helpers', () => {
  it('treats exactly the threshold as client-side and above it as server-side', () => {
    expect(shouldFilterServerSide(CLIENT_FILTER_THRESHOLD)).toBe(false);
    expect(shouldFilterServerSide(CLIENT_FILTER_THRESHOLD + 1)).toBe(true);
  });

  it('resolveServerStatus stays undefined at/below the threshold (client-side)', () => {
    expect(resolveServerStatus('done', CLIENT_FILTER_THRESHOLD)).toBeUndefined();
    expect(resolveServerStatus('cancelled', 0)).toBeUndefined();
  });

  it('resolveServerStatus passes the filter through above the threshold (server-side)', () => {
    expect(resolveServerStatus('done', CLIENT_FILTER_THRESHOLD + 1)).toBe('done');
  });

  it('selectVisibleSessions narrows client-side at/below the threshold', () => {
    const loaded = [makeSession(1, 'done'), makeSession(2, 'cancelled'), makeSession(3, 'done')];
    const visible = selectVisibleSessions(loaded, 'done');
    expect(visible.map((s) => s.status)).toEqual(['done', 'done']);
  });

  it('selectVisibleSessions returns everything when the filter is "Todas"', () => {
    const loaded = [makeSession(1, 'done'), makeSession(2, 'no_show')];
    expect(selectVisibleSessions(loaded, undefined)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Hook behavior
// ---------------------------------------------------------------------------

describe('useSessionHistoryFilter', () => {
  it('filters client-side when ≤50 are loaded (no refetch on filter change)', async () => {
    const loaded = [
      makeSession(1, 'done'),
      makeSession(2, 'cancelled'),
      makeSession(3, 'done'),
      makeSession(4, 'no_show'),
    ];
    const fetchPage = vi
      .fn<FetchSessionHistoryPage>()
      .mockResolvedValue(okPage(loaded, null, { withFuture: true }));

    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SessionHistoryStatus | undefined }) =>
        useSessionHistoryFilter({ patientId: PATIENT_ID, filter, fetchPage }),
      {
        wrapper: wrapperWith(client),
        initialProps: { filter: undefined as SessionHistoryStatus | undefined },
      },
    );

    await waitFor(() => expect(result.current.isPending).toBe(false));

    // First page fetched once, with no status (client-side mode).
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenLastCalledWith({
      patientId: PATIENT_ID,
      cursor: undefined,
      status: undefined,
    });
    expect(result.current.visibleSessions).toHaveLength(4);

    // Change the filter to "done" — must NOT trigger another fetch (≤50 loaded).
    rerender({ filter: 'done' });

    await waitFor(() =>
      expect(result.current.visibleSessions.every((s) => s.status === 'done')).toBe(true),
    );
    expect(fetchPage).toHaveBeenCalledTimes(1); // still no refetch
    expect(result.current.isServerFiltered).toBe(false);
    expect(result.current.visibleSessions).toHaveLength(2);
  });

  it('switches to a server-parameterized query and resets pagination when >50 are loaded', async () => {
    // 51 loaded rows (> threshold) forces server-side filtering on the next
    // filter change. Statuses alternate so a "done" filter is meaningful.
    const bigLoaded = Array.from({ length: 51 }, (_, i) =>
      makeSession(i + 1, i % 2 === 0 ? 'done' : 'cancelled'),
    );

    const fetchPage = vi
      .fn<FetchSessionHistoryPage>()
      // First call (no status): the 51-row unfiltered page.
      .mockResolvedValueOnce(okPage(bigLoaded, 'cursor-unfiltered', { withFuture: true }))
      // Second call (server-filtered "done"): a fresh first page.
      .mockResolvedValueOnce(okPage([makeSession(1, 'done')], 'cursor-done'));

    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SessionHistoryStatus | undefined }) =>
        useSessionHistoryFilter({ patientId: PATIENT_ID, filter, fetchPage }),
      {
        wrapper: wrapperWith(client),
        initialProps: { filter: undefined as SessionHistoryStatus | undefined },
      },
    );

    await waitFor(() => expect(result.current.totalLoaded).toBe(51));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenLastCalledWith({
      patientId: PATIENT_ID,
      cursor: undefined,
      status: undefined,
    });

    // Now > 50 loaded: changing the filter must refetch with the status param,
    // starting pagination over from the first page (cursor: undefined).
    rerender({ filter: 'done' });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage).toHaveBeenLastCalledWith({
      patientId: PATIENT_ID,
      cursor: undefined, // pagination reset
      status: 'done', // server-parameterized
    });

    await waitFor(() => expect(result.current.isServerFiltered).toBe(true));
    expect(result.current.visibleSessions.map((s) => s.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
    ]);
  });

  it('keeps the future session out of the filtered list', async () => {
    const loaded = [makeSession(1, 'done'), makeSession(2, 'cancelled')];
    const fetchPage = vi
      .fn<FetchSessionHistoryPage>()
      .mockResolvedValue(okPage(loaded, null, { withFuture: true }));

    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SessionHistoryStatus | undefined }) =>
        useSessionHistoryFilter({ patientId: PATIENT_ID, filter, fetchPage }),
      {
        wrapper: wrapperWith(client),
        initialProps: { filter: undefined as SessionHistoryStatus | undefined },
      },
    );

    await waitFor(() => expect(result.current.isPending).toBe(false));

    // The future session is surfaced separately and is never in visibleSessions.
    expect(result.current.futureSession?.id).toBe(FUTURE_SESSION.id);
    expect(result.current.visibleSessions.some((s) => s.id === FUTURE_SESSION.id)).toBe(false);

    // It also survives an active filter that excludes its status semantics.
    rerender({ filter: 'cancelled' });
    await waitFor(() =>
      expect(result.current.visibleSessions.every((s) => s.status === 'cancelled')).toBe(true),
    );
    expect(result.current.futureSession?.id).toBe(FUTURE_SESSION.id);
    expect(result.current.visibleSessions.some((s) => s.id === FUTURE_SESSION.id)).toBe(false);
  });

  it('exposes the error arm when the server returns a failure code', async () => {
    const fetchPage = vi
      .fn<FetchSessionHistoryPage>()
      .mockResolvedValue({ ok: false, code: 'ERROR' });

    const client = makeClient();
    const { result } = renderHook(
      () => useSessionHistoryFilter({ patientId: PATIENT_ID, filter: undefined, fetchPage }),
      { wrapper: wrapperWith(client) },
    );

    // The hook sets `retry: 1`, so the failure resolves after one retry —
    // allow extra time for that second attempt before asserting the error arm.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(fetchPage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
