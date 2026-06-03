import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChecklistCard } from '@/modules/onboarding/components/checklist-card';
import {
  CHECKLIST_ITEMS,
  type ChecklistItemKey,
  type ChecklistState,
} from '@/modules/onboarding/lib/checklist-items';

// Builds a full checklist state defaulting every item to `false`, then applies
// the overrides — keeps each test focused on the items it exercises.
function makeState(overrides: Partial<Record<ChecklistItemKey, boolean>> = {}): ChecklistState {
  const base = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.key, false])) as Record<
    ChecklistItemKey,
    boolean
  >;
  return { ...base, ...overrides };
}

// Every mandatory item done — the 100% state used for "collapsed" assertions.
const ALL_MANDATORY_DONE: ChecklistState = makeState({
  cadastro_completo: true,
  perfil_e_local: true,
  primeiro_paciente: true,
  primeira_sessao: true,
  primeira_evolucao: true,
  primeiro_termo: true,
});

describe('ChecklistCard', () => {
  it('renders a done item with the CheckCircle2 marker and no action button', () => {
    render(<ChecklistCard state={makeState({ cadastro_completo: true })} />);

    const item = screen.getByTestId('onboarding-checklist-item-cadastro_completo');
    expect(item).toHaveAttribute('data-done', 'true');
    expect(
      within(item).getByTestId('onboarding-checklist-done-cadastro_completo'),
    ).toBeInTheDocument();
    // A completed item exposes no CTA.
    expect(
      within(item).queryByTestId('onboarding-checklist-action-cadastro_completo'),
    ).not.toBeInTheDocument();
  });

  it('renders a pending mandatory item with an action button pointing at its target', () => {
    render(<ChecklistCard state={makeState()} />);

    const item = screen.getByTestId('onboarding-checklist-item-primeiro_paciente');
    expect(item).toHaveAttribute('data-done', 'false');

    const action = within(item).getByTestId('onboarding-checklist-action-primeiro_paciente');
    // The action target is the static, server-owned path from the catalog.
    const target = CHECKLIST_ITEMS.find((i) => i.key === 'primeiro_paciente')?.actionTarget;
    expect(action).toHaveAttribute('href', target);
  });

  it('exposes every pending mandatory item action target from the catalog', () => {
    render(<ChecklistCard state={makeState()} />);

    for (const item of CHECKLIST_ITEMS.filter((i) => i.mandatory)) {
      const action = screen.getByTestId(`onboarding-checklist-action-${item.key}`);
      expect(action).toHaveAttribute('href', item.actionTarget);
    }
  });

  it('shows the "Bônus" badge on the AI (non-mandatory) item only', () => {
    render(<ChecklistCard state={makeState()} />);

    const badges = screen.getAllByTestId('onboarding-checklist-bonus-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('Bônus');

    // The badge belongs to the bonus item (`transcricao_ia`).
    const bonusItem = screen.getByTestId('onboarding-checklist-item-transcricao_ia');
    expect(within(bonusItem).getByTestId('onboarding-checklist-bonus-badge')).toBeInTheDocument();
  });

  it('starts expanded while any mandatory item is pending', () => {
    render(<ChecklistCard state={makeState({ cadastro_completo: true })} />);

    expect(screen.getByTestId('onboarding-checklist-trigger')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The list of items is mounted (visible) when expanded.
    expect(screen.getByTestId('onboarding-checklist-item-perfil_e_local')).toBeInTheDocument();
  });

  it('collapses by default once mandatory progress reaches 100%', () => {
    render(<ChecklistCard state={ALL_MANDATORY_DONE} />);

    expect(screen.getByTestId('onboarding-checklist-trigger')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Radix unmounts collapsed content, so the item rows are not in the DOM.
    expect(
      screen.queryByTestId('onboarding-checklist-item-cadastro_completo'),
    ).not.toBeInTheDocument();
  });

  it('reports the mandatory completion percentage in the header', () => {
    // 3 of 6 mandatory done → 50%.
    render(
      <ChecklistCard
        state={makeState({
          cadastro_completo: true,
          perfil_e_local: true,
          primeiro_paciente: true,
        })}
      />,
    );

    expect(screen.getByTestId('onboarding-checklist-progress')).toHaveTextContent('50% concluído');
  });

  it('renders the completion celebration message at 100%', () => {
    render(<ChecklistCard state={ALL_MANDATORY_DONE} />);

    const celebration = screen.getByTestId('onboarding-checklist-celebration');
    expect(celebration).toHaveTextContent(
      'Você completou a configuração inicial. Seu consultório está no sistema!',
    );
  });

  it('omits all action buttons in read-only mode even when items are pending', () => {
    render(<ChecklistCard state={makeState()} readOnly />);

    for (const item of CHECKLIST_ITEMS) {
      expect(
        screen.queryByTestId(`onboarding-checklist-action-${item.key}`),
      ).not.toBeInTheDocument();
    }
  });
});
