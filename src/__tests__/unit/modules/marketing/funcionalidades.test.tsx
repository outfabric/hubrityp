import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Funcionalidades } from '@/modules/marketing/components/home/funcionalidades';
import { FEATURE_CARDS, SCREENSHOTS } from '@/modules/marketing/lib/home-content';

/*
 * Funcionalidades (client leaf) — the MVP feature grid of the public homepage.
 *
 * Behavioral contracts:
 *   - renders the 7 feature cards with their correct titles + thumbnails;
 *   - the section carries the `funcionalidades` id (anchor for the hero CTA);
 *   - the Dashboard card is double-width on desktop;
 *   - clicking a thumbnail opens the accessible lightbox showing that screenshot;
 *   - the lightbox closes via the Escape key AND the close button;
 *   - on close, focus is restored to the thumbnail that opened it.
 */

describe('Funcionalidades — grid content', () => {
  it('renders all 7 feature cards with their titles', () => {
    render(<Funcionalidades />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items).toHaveLength(FEATURE_CARDS.length);

    items.forEach((item, index) => {
      const card = FEATURE_CARDS[index];
      expect(card).toBeDefined();
      expect(within(item).getByRole('heading', { name: card!.title })).toBeInTheDocument();
      expect(within(item).getByText(card!.description)).toBeInTheDocument();
    });
  });

  it('renders a thumbnail image for each card with the screenshot alt text', () => {
    render(<Funcionalidades />);

    for (const card of FEATURE_CARDS) {
      if (card.screenshot === undefined) {
        continue;
      }
      const asset = SCREENSHOTS[card.screenshot];
      expect(screen.getByAltText(asset.alt)).toBeInTheDocument();
    }
  });

  it('exposes the section under the `funcionalidades` id (anchor target)', () => {
    const { container } = render(<Funcionalidades />);
    const section = container.querySelector('section#funcionalidades');
    expect(section).not.toBeNull();
  });

  it('renders the Dashboard card as double-width on desktop', () => {
    render(<Funcionalidades />);

    const dashboardCard = FEATURE_CARDS.find((card) => card.wide === true);
    expect(dashboardCard).toBeDefined();

    const heading = screen.getByRole('heading', { name: dashboardCard!.title });
    const listItem = heading.closest('li');
    expect(listItem).not.toBeNull();
    expect(listItem!.className).toContain('md:col-span-3');
  });

  it('does not render the lightbox dialog until a thumbnail is clicked', () => {
    render(<Funcionalidades />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Funcionalidades — lightbox open / close', () => {
  /** Open the lightbox by clicking the first card's thumbnail trigger; returns it. */
  async function openFirstLightbox(): Promise<HTMLElement> {
    const user = userEvent.setup();
    const firstCard = FEATURE_CARDS[0]!;
    const trigger = screen.getByRole('button', {
      name: `Ampliar captura de tela: ${firstCard.title}`,
    });
    await user.click(trigger);
    return trigger;
  }

  it('opens the lightbox showing the clicked screenshot', async () => {
    render(<Funcionalidades />);
    await openFirstLightbox();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const firstCard = FEATURE_CARDS[0]!;
    const asset = SCREENSHOTS[firstCard.screenshot!];
    // The dialog is labelled by the screenshot alt and contains the full image.
    expect(dialog).toHaveAttribute('aria-label', asset.alt);
    expect(within(dialog).getByAltText(asset.alt)).toBeInTheDocument();
  });

  it('moves focus into the dialog (close button) on open', async () => {
    render(<Funcionalidades />);
    await openFirstLightbox();

    const closeButton = await screen.findByRole('button', { name: 'Fechar' });
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it('traps focus on the close button when tabbing', async () => {
    const user = userEvent.setup();
    render(<Funcionalidades />);
    await openFirstLightbox();

    const closeButton = await screen.findByRole('button', { name: 'Fechar' });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();
  });

  it('closes the lightbox via the Escape key and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Funcionalidades />);
    const trigger = await openFirstLightbox();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes the lightbox via the close button and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Funcionalidades />);
    const trigger = await openFirstLightbox();

    const closeButton = await screen.findByRole('button', { name: 'Fechar' });
    await user.click(closeButton);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
