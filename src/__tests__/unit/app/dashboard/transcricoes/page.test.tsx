import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  TranscriptionId,
  TranscriptionListBuckets,
  TranscriptionListItem,
} from '@/modules/ai-transcription';
import { TranscriptionsEmptyState } from '@/modules/ai-transcription/components/transcriptions-empty-state';
import { TranscriptionsTabs } from '@/modules/ai-transcription/components/transcriptions-tabs';

// ---------------------------------------------------------------------------
// Mocks
//
// The list page is a Server Component whose card links and empty-state CTA use
// `next/link`. Render a plain <a> so we can assert hrefs and click navigation
// without booting the full Next.js router.
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  overrides: Partial<TranscriptionListItem> = {},
): TranscriptionListItem {
  const base: TranscriptionListItem = {
    transcriptionId: id as TranscriptionId,
    status: 'ready',
    templateUsed: 'tcc',
    patientFirstName: 'Ana',
    sessionDate: new Date('2026-05-20T14:00:00Z'),
    createdAt: new Date('2026-05-20T15:00:00Z'),
  };
  // Spread last so an explicit `sessionDate: null` / `templateUsed: null`
  // overrides the default (which `??` would have masked).
  return { ...base, ...overrides };
}

function makeBuckets(overrides: Partial<TranscriptionListBuckets> = {}): TranscriptionListBuckets {
  return {
    pending: overrides.pending ?? [],
    reviewed: overrides.reviewed ?? [],
    failed: overrides.failed ?? [],
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('TranscriptionsEmptyState', () => {
  it('renders the 3-part Sálvia empty state with headline, body and CTA to pacientes', () => {
    render(<TranscriptionsEmptyState />);

    const root = screen.getByTestId('transcriptions-empty-state');
    expect(
      within(root).getByRole('heading', { level: 4, name: 'Nenhuma transcrição ainda' }),
    ).toBeInTheDocument();
    expect(
      within(root).getByText(
        'Quando você enviar um áudio de sessão, as notas geradas aparecerão aqui.',
      ),
    ).toBeInTheDocument();

    const cta = within(root).getByTestId('transcriptions-empty-cta');
    expect(cta).toHaveTextContent('Ver pacientes');
    expect(cta).toHaveAttribute('href', '/dashboard/pacientes');
  });

  it('renders a decorative Sparkles icon (svg aria-hidden)', () => {
    render(<TranscriptionsEmptyState />);

    const icon = screen.getByTestId('transcriptions-empty-state').querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

// ---------------------------------------------------------------------------
// Tabs filtering
// ---------------------------------------------------------------------------

describe('TranscriptionsTabs — filtering', () => {
  it('defaults to the "Pendentes" tab and shows only pending rows', () => {
    const buckets = makeBuckets({
      pending: [makeItem('11111111-1111-1111-1111-111111111111', { patientFirstName: 'Ana' })],
      reviewed: [
        makeItem('22222222-2222-2222-2222-222222222222', {
          status: 'reviewed',
          patientFirstName: 'Bruno',
        }),
      ],
      failed: [
        makeItem('33333333-3333-3333-3333-333333333333', {
          status: 'failed',
          patientFirstName: 'Carla',
        }),
      ],
    });

    render(<TranscriptionsTabs buckets={buckets} />);

    const pendingPanel = screen.getByTestId('panel-pending');
    expect(within(pendingPanel).getByText('Ana')).toBeInTheDocument();
    // Other buckets' rows are not visible in the active panel.
    expect(within(pendingPanel).queryByText('Bruno')).not.toBeInTheDocument();
    expect(within(pendingPanel).queryByText('Carla')).not.toBeInTheDocument();
  });

  it('switching to "Revisadas" shows only reviewed rows', async () => {
    const user = userEvent.setup();
    const buckets = makeBuckets({
      pending: [makeItem('11111111-1111-1111-1111-111111111111', { patientFirstName: 'Ana' })],
      reviewed: [
        makeItem('22222222-2222-2222-2222-222222222222', {
          status: 'reviewed',
          patientFirstName: 'Bruno',
        }),
      ],
    });

    render(<TranscriptionsTabs buckets={buckets} />);

    await user.click(screen.getByTestId('tab-reviewed'));

    const reviewedPanel = screen.getByTestId('panel-reviewed');
    expect(within(reviewedPanel).getByText('Bruno')).toBeInTheDocument();
    expect(within(reviewedPanel).queryByText('Ana')).not.toBeInTheDocument();
  });

  it('switching to "Falhas" shows only failed rows', async () => {
    const user = userEvent.setup();
    const buckets = makeBuckets({
      failed: [
        makeItem('33333333-3333-3333-3333-333333333333', {
          status: 'failed',
          patientFirstName: 'Carla',
        }),
      ],
    });

    render(<TranscriptionsTabs buckets={buckets} />);

    await user.click(screen.getByTestId('tab-failed'));

    const failedPanel = screen.getByTestId('panel-failed');
    expect(within(failedPanel).getByText('Carla')).toBeInTheDocument();
  });

  it('shows the per-tab empty label when a bucket has no rows', () => {
    render(<TranscriptionsTabs buckets={makeBuckets()} />);

    const pendingPanel = screen.getByTestId('panel-pending');
    expect(
      within(pendingPanel).getByText('Nenhuma transcrição pendente de revisão.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card content + navigation
// ---------------------------------------------------------------------------

describe('TranscriptionsTabs — card content and navigation', () => {
  it('renders the card with first name, session date, template label and status badge', () => {
    const buckets = makeBuckets({
      pending: [
        makeItem('11111111-1111-1111-1111-111111111111', {
          patientFirstName: 'Ana',
          templateUsed: 'tcc',
          status: 'ready',
        }),
      ],
    });

    render(<TranscriptionsTabs buckets={buckets} />);

    const panel = screen.getByTestId('panel-pending');
    expect(within(panel).getByText('Ana')).toBeInTheDocument();
    expect(within(panel).getByText('TCC')).toBeInTheDocument();
    // date-fns pt-BR long format for 2026-05-20.
    expect(within(panel).getByText(/de maio de 2026/)).toBeInTheDocument();

    const badge = within(panel).getByTestId('transcription-status-badge');
    expect(badge).toHaveAttribute('data-status', 'ready');
  });

  it('the card is a link to the review page (clicking navigates)', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const buckets = makeBuckets({ pending: [makeItem(id, { patientFirstName: 'Ana' })] });

    render(<TranscriptionsTabs buckets={buckets} />);

    // The whole card is wrapped in the link, so any click on it — including on
    // the "Ver" affordance — navigates to the review page.
    const link = screen.getByTestId('transcription-list-card-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', `/dashboard/transcricoes/${id}`);
    expect(within(link).getByText('Ver')).toBeInTheDocument();
  });

  it('falls back to "Sem sessão vinculada" when there is no session date', () => {
    const buckets = makeBuckets({
      pending: [makeItem('11111111-1111-1111-1111-111111111111', { sessionDate: null })],
    });

    render(<TranscriptionsTabs buckets={buckets} />);

    expect(screen.getByText('Sem sessão vinculada')).toBeInTheDocument();
  });
});
