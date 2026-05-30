import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TranscriptionStatsPanel } from '@/app/(app)/configuracoes/transcricao-ia/_components/transcription-stats-panel';
import type { TranscriptionStatsView } from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_STATS: TranscriptionStatsView = {
  totalProcessed: 12,
  monthProcessed: 4,
  reviewed: 10,
  savedToProntuario: 9,
  estimatedMinutesSaved: 32,
  acceptanceRatePercent: 80,
  avgCostUsd: 0.12,
  failedCount: 1,
};

afterEach(() => cleanup());

describe('TranscriptionStatsPanel', () => {
  it('renders the empty state when totalProcessed === 0', () => {
    render(<TranscriptionStatsPanel stats={{ ...BASE_STATS, totalProcessed: 0 }} />);

    expect(screen.getByTestId('transcription-stats-empty')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma transcrição processada ainda')).toBeInTheDocument();
    // The metric grid must NOT render in the empty state.
    expect(screen.queryByTestId('transcription-stats-grid')).not.toBeInTheDocument();
  });

  it('renders the 4-card grid with the correct values for populated stats', () => {
    render(<TranscriptionStatsPanel stats={BASE_STATS} />);

    expect(screen.getByTestId('transcription-stats-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('transcription-stat-card')).toHaveLength(4);

    expect(screen.getByText('Sessões processadas (mês)')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    expect(screen.getByText('Total processado')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    expect(screen.getByText('Taxa de aceitação')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('formats minutes under an hour as "<n> minutos"', () => {
    render(<TranscriptionStatsPanel stats={{ ...BASE_STATS, estimatedMinutesSaved: 32 }} />);
    expect(screen.getByText('32 minutos')).toBeInTheDocument();
  });

  it('formats one hour or more as "<h>h <m>min" (and drops a zero minute)', () => {
    const { rerender } = render(
      <TranscriptionStatsPanel stats={{ ...BASE_STATS, estimatedMinutesSaved: 150 }} />,
    );
    expect(screen.getByText('2h 30min')).toBeInTheDocument();

    rerender(<TranscriptionStatsPanel stats={{ ...BASE_STATS, estimatedMinutesSaved: 120 }} />);
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('shows "Dados insuficientes" when acceptanceRatePercent is null', () => {
    render(<TranscriptionStatsPanel stats={{ ...BASE_STATS, acceptanceRatePercent: null }} />);

    expect(screen.getByText('Dados insuficientes')).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
  });

  it('applies Sálvia caption-upper label classes and h2-weight number classes', () => {
    render(<TranscriptionStatsPanel stats={BASE_STATS} />);

    const label = screen.getByText('Total processado');
    expect(label).toHaveClass('uppercase');
    expect(label).toHaveClass('text-xs');
    expect(label).toHaveClass('font-medium');

    // The number sibling uses the h2 weight (600 / font-semibold) at 22px.
    const value = screen.getByText('12');
    expect(value).toHaveClass('font-semibold');
    expect(value).toHaveClass('text-[22px]');
  });
});
