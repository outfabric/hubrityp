'use client';

/**
 * PatientSessionHistory — the session-history tab container (RF-13.04,
 * RF-13.10–13.14, RF-13.16–13.19; design D1, D5).
 *
 * Lazily fetches its first page on mount: Radix `TabsContent` only mounts this
 * subtree when the sessions tab becomes active (no `forceMount`), so the fetch
 * and the server-side audit write fire on actual tab open — never on a tab the
 * user never visited.
 *
 * Renders, in order:
 *   - the summary strip (from the first page),
 *   - the status filter chips,
 *   - a "Próxima sessão" separator + the nearest future session (always visible,
 *     independent of the active filter),
 *   - a "Sessões anteriores" separator,
 *   - the historical list grouped by São Paulo month with `caption-upper`
 *     dividers,
 *   - a "Carregar mais (N …)" button with a spinner + remaining count (hidden
 *     once the list is exhausted; scroll position and active filter preserved
 *     across loads).
 *
 * State surfaces (RF-13.16–13.19): a 3-card pulse skeleton (honoring
 * `prefers-reduced-motion`), an error state with a "Tentar novamente" retry, and
 * an empty state with a primary CTA to schedule the first session.
 *
 * The hybrid (client ≤50 / server >50) filter behavior is fully encapsulated in
 * `useSessionHistoryFilter`; this component is the view that consumes it. There
 * is no global QueryClientProvider in this app, so the container owns its cache
 * island (same pattern as the AI-transcription / consent islands).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Calendar, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { getPatientSessionHistory } from '@/app/(app)/pacientes/[id]/actions';
import { SessionHistoryCard } from '@/modules/sessions/components/session-history-card';
import { SessionHistoryFilterChips } from '@/modules/sessions/components/session-history-filter-chips';
import { SessionHistorySummaryStrip } from '@/modules/sessions/components/session-history-summary-strip';
import {
  type FetchSessionHistoryPage,
  useSessionHistoryFilter,
} from '@/modules/sessions/hooks/use-session-history-filter';
import { monthGroupKey, monthGroupLabel } from '@/modules/sessions/lib/session-history-formatters';
import type {
  SessionHistoryItem,
  SessionHistoryStatus,
} from '@/modules/sessions/lib/session-history-schema';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PatientSessionHistoryProps {
  /** Patient UUID. Owner-scoping is enforced server-side from the session. */
  patientId: string;
  /** Patient display name — used in the empty-state description. */
  patientName: string;
}

// ---------------------------------------------------------------------------
// Query-client island
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  });
}

/**
 * The Server Action page fetcher. Lives here (not in the hook) so the hook stays
 * unit-testable with an injected fake. The `status` is decided by the hook.
 */
const fetchPage: FetchSessionHistoryPage = (input) => getPatientSessionHistory(input);

export function PatientSessionHistory(props: PatientSessionHistoryProps) {
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <PatientSessionHistoryView {...props} />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner view (runs inside the provider so it can use the query hook)
// ---------------------------------------------------------------------------

function PatientSessionHistoryView({ patientId, patientName }: PatientSessionHistoryProps) {
  const [filter, setFilter] = useState<SessionHistoryStatus | undefined>(undefined);

  const {
    visibleSessions,
    summary,
    futureSession,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSessionHistoryFilter({ patientId, filter, fetchPage });

  if (isPending) return <HistorySkeleton />;

  if (isError) return <HistoryErrorState onRetry={() => void refetch()} />;

  const hasAnyHistory = visibleSessions.length > 0;
  const hasFuture = futureSession !== undefined;

  // Empty state only when there is genuinely nothing to show: no future session
  // AND no history under the *unfiltered* view. With an active filter that
  // yields nothing we still keep the chips + future session visible, so we gate
  // the empty state on the default (no-filter) view having no content.
  if (filter === undefined && !hasAnyHistory && !hasFuture) {
    return <HistoryEmptyState patientName={patientName} />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="patient-session-history">
      {summary && <SessionHistorySummaryStrip summary={summary} />}

      <SessionHistoryFilterChips value={filter} onChange={setFilter} />

      {hasFuture && (
        <div className="flex flex-col gap-3">
          <SectionSeparator label="Próxima sessão" />
          <SessionHistoryCard session={futureSession} />
          {/* Deep-link to the agenda, positioned on this session (RF-13.09). */}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="self-start"
            data-testid="open-in-agenda"
          >
            <a href={`/agenda?focusSession=${futureSession.id}`}>
              Abrir na agenda
              <ArrowRight aria-hidden className="size-4" />
            </a>
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SectionSeparator label="Sessões anteriores" />

        {hasAnyHistory ? (
          <GroupedHistoryList sessions={visibleSessions} />
        ) : (
          <p className="text-text-secondary text-sm" data-testid="filtered-empty">
            Nenhuma sessão para este filtro.
          </p>
        )}

        {hasNextPage && (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            data-testid="load-more-button"
          >
            {isFetchingNextPage && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Carregar mais sessões anteriores
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month-grouped list
// ---------------------------------------------------------------------------

interface MonthGroup {
  key: string;
  label: string;
  sessions: SessionHistoryItem[];
}

/** Groups an already-sorted (start_at DESC) list into contiguous SP-month runs. */
function groupByMonth(sessions: readonly SessionHistoryItem[]): MonthGroup[] {
  const groups: MonthGroup[] = [];

  for (const session of sessions) {
    const key = monthGroupKey(session.startAt);
    const last = groups.at(-1);

    if (last && last.key === key) {
      last.sessions.push(session);
    } else {
      groups.push({ key, label: monthGroupLabel(session.startAt), sessions: [session] });
    }
  }

  return groups;
}

function GroupedHistoryList({ sessions }: { sessions: readonly SessionHistoryItem[] }) {
  const groups = groupByMonth(sessions);

  return (
    <div className="flex flex-col gap-6" data-testid="session-history-list">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h3
            className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase"
            data-testid="month-divider"
          >
            {group.label}
          </h3>
          {group.sessions.map((session) => (
            <SessionHistoryCard key={session.id} session={session} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

function SectionSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span aria-hidden className="bg-border h-px flex-1" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (RF-13.16) — honors prefers-reduced-motion
// ---------------------------------------------------------------------------

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="session-history-skeleton" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="bg-surface-muted h-32 rounded-xl motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state (RF-13.17)
// ---------------------------------------------------------------------------

function HistoryErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-12 text-center"
      data-testid="session-history-error"
    >
      <AlertCircle aria-hidden className="text-text-tertiary size-8" />
      <h4 className="text-text-primary text-base font-medium">
        Não foi possível carregar o histórico
      </h4>
      <p className="text-text-secondary text-sm">Verifique sua conexão e tente novamente.</p>
      <Button
        type="button"
        variant="secondary"
        onClick={onRetry}
        data-testid="history-retry-button"
      >
        Tentar novamente
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (RF-13.18)
// ---------------------------------------------------------------------------

function HistoryEmptyState({ patientName }: { patientName: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-12 text-center"
      data-testid="session-history-empty"
    >
      <Calendar aria-hidden className="text-text-tertiary size-8" />
      <h4 className="text-text-primary text-base font-medium">Nenhuma sessão registrada</h4>
      <p className="text-text-secondary max-w-sm text-sm">
        Agende a primeira sessão com {patientName} para começar a acompanhar o histórico.
      </p>
      <Button asChild variant="default" data-testid="schedule-first-session">
        <a href="/agenda">Agendar primeira sessão</a>
      </Button>
    </div>
  );
}
