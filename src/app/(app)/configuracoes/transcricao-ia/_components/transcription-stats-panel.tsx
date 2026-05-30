import { Sparkles } from 'lucide-react';

import type { TranscriptionStatsView } from '@/modules/ai-transcription';
import { Card, CardContent } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render the estimated time saved as a human pt-BR string.
 *
 * Under 60 minutes -> "<n> minutos"; otherwise "<h>h <m>min" (the minute
 * fragment is dropped when it is zero, e.g. "2h").
 */
function formatMinutesSaved(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutos`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
}

/**
 * Single metric card: a `caption-upper` eyebrow label above an `h2`-weight
 * number. No decorative icons (design D5).
 */
function StatCard({ label, value }: StatCardProps) {
  return (
    <Card data-testid="transcription-stat-card">
      <CardContent className="p-4 md:p-6">
        <p className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
          {label}
        </p>
        <p className="text-text-primary mt-2 text-[22px] leading-[1.25] font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface TranscriptionStatsPanelProps {
  stats: TranscriptionStatsView;
}

/**
 * Server Component (design D4): no hydration, reads its data from the page's
 * Drizzle-backed query and refreshes on `router.refresh()` revalidation.
 *
 * Renders a responsive grid of four metric cards (1 col mobile / 2 tablet /
 * 4 desktop — design D5) or, when the psychologist has never processed a
 * transcription, a single empty-state card (design D7).
 *
 * The stats carry only aggregate numbers — no patient or clinical content.
 */
export function TranscriptionStatsPanel({ stats }: TranscriptionStatsPanelProps) {
  // D7: empty state when no transcription has ever been processed.
  if (stats.totalProcessed === 0) {
    return (
      <Card data-testid="transcription-stats-empty">
        <CardContent className="flex flex-col items-center p-6 text-center md:p-8">
          <Sparkles className="text-text-tertiary h-6 w-6" aria-hidden="true" />
          <h4 className="text-text-primary mt-3 text-[16px] font-medium">
            Nenhuma transcrição processada ainda
          </h4>
          <p className="text-text-secondary mt-1 max-w-[420px] text-[15px]">
            Ative a Transcrição IA e grave uma sessão com termo assinado para que a nota seja gerada
            automaticamente. Suas métricas de uso aparecerão aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  const acceptanceLabel =
    stats.acceptanceRatePercent === null
      ? 'Dados insuficientes'
      : `${stats.acceptanceRatePercent}%`;

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      data-testid="transcription-stats-grid"
    >
      <StatCard label="Sessões processadas (mês)" value={String(stats.monthProcessed)} />
      <StatCard label="Total processado" value={String(stats.totalProcessed)} />
      <StatCard
        label="Tempo economizado (estimado)"
        value={formatMinutesSaved(stats.estimatedMinutesSaved)}
      />
      <StatCard label="Taxa de aceitação" value={acceptanceLabel} />
    </div>
  );
}
