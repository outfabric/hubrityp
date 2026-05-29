import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TranscriptionStatus } from '@/modules/ai-transcription';
import { TranscriptionStatusBadge } from '@/modules/ai-transcription/components/transcription-status-badge';

afterEach(() => {
  cleanup();
});

// Each status maps to a specific pt-BR label that is surfaced both as visible
// text and as the badge's accessible name.
const STATUS_LABELS: Record<TranscriptionStatus, string> = {
  pending: 'Processando',
  transcribing: 'Processando',
  generating: 'Processando',
  ready: 'Pronta para revisão',
  reviewed: 'Salva no prontuário',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as TranscriptionStatus[];

describe('TranscriptionStatusBadge', () => {
  it.each(ALL_STATUSES)('matches snapshot for status "%s"', (status) => {
    const { container } = render(<TranscriptionStatusBadge status={status} />);

    expect(container.firstChild).toMatchSnapshot();
  });

  it.each(ALL_STATUSES)('exposes the pt-BR label as aria-label for status "%s"', (status) => {
    render(<TranscriptionStatusBadge status={status} />);

    const badge = screen.getByTestId('transcription-status-badge');

    expect(badge).toHaveAttribute('aria-label', STATUS_LABELS[status]);
    expect(badge).toHaveTextContent(STATUS_LABELS[status]);
  });

  it('collapses processing statuses to a single "Processando" label', () => {
    for (const status of ['pending', 'transcribing', 'generating'] as const) {
      cleanup();
      render(<TranscriptionStatusBadge status={status} />);
      expect(screen.getByTestId('transcription-status-badge')).toHaveAttribute(
        'aria-label',
        'Processando',
      );
    }
  });

  it('forwards a custom className onto the badge', () => {
    render(<TranscriptionStatusBadge status="ready" className="mt-2" />);

    expect(screen.getByTestId('transcription-status-badge')).toHaveClass('mt-2');
  });

  it('marks the decorative icon as aria-hidden', () => {
    const { container } = render(<TranscriptionStatusBadge status="failed" />);

    const icon = container.querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
