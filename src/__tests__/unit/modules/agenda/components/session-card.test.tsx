import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionCard } from '@/modules/agenda/components/session-card';
import { TranscriptionIdSchema } from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

const READY_ID = TranscriptionIdSchema.parse('11111111-1111-4111-8111-111111111111');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionCard — AI transcription badge', () => {
  it('renders the "Nota IA" badge when a transcription is ready for review', () => {
    render(<SessionCard readyTranscription={{ id: READY_ID }} />);

    const badge = screen.getByTestId('session-card-ai-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Nota IA');
  });

  it('links the badge to the review page for the transcription', () => {
    render(<SessionCard readyTranscription={{ id: READY_ID }} />);

    expect(screen.getByTestId('session-card-ai-badge')).toHaveAttribute(
      'href',
      `/dashboard/transcricoes/${READY_ID}/revisar`,
    );
  });

  it('exposes the accessible label for screen readers', () => {
    render(<SessionCard readyTranscription={{ id: READY_ID }} />);

    expect(screen.getByRole('link', { name: 'Nota IA pronta para revisão' })).toBeInTheDocument();
  });

  it('renders no badge when there is no transcription pending review (already reviewed)', () => {
    const { container } = render(<SessionCard readyTranscription={null} />);

    expect(screen.queryByTestId('session-card-ai-badge')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders no badge when the prop is omitted', () => {
    render(<SessionCard />);

    expect(screen.queryByTestId('session-card-ai-badge')).not.toBeInTheDocument();
  });

  it('is keyboard-activable: the badge link is reachable via Tab and exposes a focus ring', async () => {
    const user = userEvent.setup();
    render(<SessionCard readyTranscription={{ id: READY_ID }} />);

    const badge = screen.getByTestId('session-card-ai-badge');

    await user.tab();
    expect(badge).toHaveFocus();
    // Salvia: visible focus ring via `shadow-focus` on keyboard focus.
    expect(badge.className).toContain('focus-visible:shadow-focus');
  });
});
