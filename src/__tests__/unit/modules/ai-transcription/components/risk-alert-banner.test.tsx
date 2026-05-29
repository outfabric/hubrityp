import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RiskAlert } from '@/modules/ai-transcription';
import { RiskAlertBanner } from '@/modules/ai-transcription/components/risk-alert-banner';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The five closed `RiskAlert['kind']` values and the pt-BR label each must
// surface in the UI. Keyed by the canonical schema enum so a renamed kind
// breaks this table at compile time.
const KIND_LABELS: Record<RiskAlert['kind'], string> = {
  suicidal: 'Ideação suicida',
  self_harm: 'Autolesão',
  domestic_violence: 'Violência doméstica',
  third_party_risk: 'Risco a terceiros',
  substance_abuse: 'Abuso de substâncias',
};

const ALL_KINDS = Object.keys(KIND_LABELS) as RiskAlert['kind'][];

function makeAlert(kind: RiskAlert['kind'], excerpt = 'trecho de exemplo'): RiskAlert {
  return { kind, excerpt, confidence: 'high' };
}

describe('RiskAlertBanner', () => {
  it('renders nothing when there are no alerts', () => {
    const { container } = render(<RiskAlertBanner riskAlerts={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('risk-alert-banner')).toBeNull();
  });

  it('renders all five risk kinds with their pt-BR labels', () => {
    render(<RiskAlertBanner riskAlerts={ALL_KINDS.map((kind) => makeAlert(kind))} />);

    const items = screen.getAllByTestId('risk-alert-item');
    expect(items).toHaveLength(ALL_KINDS.length);

    for (const kind of ALL_KINDS) {
      const item = items.find((node) => node.dataset.kind === kind);
      expect(item, `missing item for kind "${kind}"`).toBeDefined();
      expect(within(item as HTMLElement).getByText(KIND_LABELS[kind])).toBeInTheDocument();
    }
  });

  it('exposes the alert role and the call-to-action subtitle', () => {
    render(<RiskAlertBanner riskAlerts={[makeAlert('suicidal')]} />);

    const banner = screen.getByTestId('risk-alert-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('Conteúdo de risco identificado');
    expect(banner).toHaveTextContent(
      'Considere: contato pós-sessão, plano de segurança, encaminhamento.',
    );
  });

  it('auto-focuses the banner on mount', () => {
    render(<RiskAlertBanner riskAlerts={[makeAlert('self_harm')]} />);

    const banner = screen.getByTestId('risk-alert-banner');
    expect(banner).toHaveFocus();
    // Focusable programmatically only — kept out of the natural Tab order.
    expect(banner).toHaveAttribute('tabindex', '-1');
  });

  it('shows short excerpts verbatim without a collapse control', () => {
    render(<RiskAlertBanner riskAlerts={[makeAlert('substance_abuse', 'uso diário relatado')]} />);

    expect(screen.getByTestId('risk-alert-excerpt')).toHaveTextContent('uso diário relatado');
    expect(screen.queryByRole('button', { name: 'Ver trecho completo' })).toBeNull();
  });

  it('truncates long excerpts to 200 chars and reveals the full text on click', async () => {
    const longExcerpt = 'a'.repeat(250);
    render(<RiskAlertBanner riskAlerts={[makeAlert('domestic_violence', longExcerpt)]} />);

    const preview = screen.getByTestId('risk-alert-excerpt');
    expect(preview.textContent).toBe(`${'a'.repeat(200)}…`);

    const trigger = screen.getByRole('button', { name: 'Ver trecho completo' });
    act(() => {
      trigger.click();
    });

    const full = await screen.findByTestId('risk-alert-excerpt-full');
    expect(full).toHaveTextContent(longExcerpt);
  });

  describe('prefers-reduced-motion', () => {
    function mockReducedMotion(reduce: boolean) {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query.includes('prefers-reduced-motion: reduce') ? reduce : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      );
    }

    it('uses no inline animation/transition styles that would bypass the global reduced-motion reset', () => {
      // The global `prefers-reduced-motion: reduce` rule in globals.css zeroes
      // out CSS `animation-duration`/`transition-duration`. That reset only
      // works if motion lives in CSS — an inline `style="animation: ..."` or
      // imperative WAAPI call would escape it. Assert the banner relies solely
      // on (resettable) CSS classes: no element carries an inline motion style.
      mockReducedMotion(true);
      const { container } = render(<RiskAlertBanner riskAlerts={[makeAlert('suicidal')]} />);

      for (const node of container.querySelectorAll<HTMLElement>('*')) {
        expect(node.style.animation).toBe('');
        expect(node.style.animationDuration).toBe('');
        expect(node.style.transitionDuration).toBe('');
      }
    });

    it('renders identically whether or not reduced motion is requested', () => {
      mockReducedMotion(true);
      const reduced = render(<RiskAlertBanner riskAlerts={[makeAlert('third_party_risk')]} />);
      const reducedHtml = reduced.container.innerHTML;
      cleanup();

      mockReducedMotion(false);
      const full = render(<RiskAlertBanner riskAlerts={[makeAlert('third_party_risk')]} />);

      // No layout/markup branch keys off the motion preference — the only
      // motion is the CSS `transition-colors duration-fast`, neutralized
      // globally under `prefers-reduced-motion: reduce`.
      expect(full.container.innerHTML).toBe(reducedHtml);
    });
  });
});
