import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SessionHistoryFilterChips,
  type SessionHistoryFilterValue,
} from '@/modules/sessions/components/session-history-filter-chips';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChips(value: SessionHistoryFilterValue, onChange = vi.fn()) {
  render(<SessionHistoryFilterChips value={value} onChange={onChange} />);
  return { onChange };
}

const ALL_LABELS = ['Todas', 'Realizadas', 'Canceladas', 'Não compareceu'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionHistoryFilterChips', () => {
  it('renders one chip per history status plus the default "Todas"', () => {
    renderChips(undefined);

    for (const label of ALL_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  describe('single-select state', () => {
    it('marks "Todas" as active by default (value `undefined`)', () => {
      renderChips(undefined);

      expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('marks exactly one chip active and the rest inactive', () => {
      renderChips('done');

      expect(screen.getByRole('button', { name: 'Realizadas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      for (const label of ALL_LABELS.filter((l) => l !== 'Realizadas')) {
        expect(screen.getByRole('button', { name: label })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      }
    });
  });

  describe('onChange', () => {
    it('emits the mapped status when a status chip is selected', async () => {
      const user = userEvent.setup();
      const { onChange } = renderChips(undefined);

      await user.click(screen.getByRole('button', { name: 'Canceladas' }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('cancelled');
    });

    it('emits `undefined` when "Todas" is selected', async () => {
      const user = userEvent.setup();
      const { onChange } = renderChips('no_show');

      await user.click(screen.getByRole('button', { name: 'Todas' }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('emits `no_show` for the "Não compareceu" chip', async () => {
      const user = userEvent.setup();
      const { onChange } = renderChips(undefined);

      await user.click(screen.getByRole('button', { name: 'Não compareceu' }));

      expect(onChange).toHaveBeenCalledWith('no_show');
    });
  });
});
