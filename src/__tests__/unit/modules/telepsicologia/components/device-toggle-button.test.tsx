import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceToggleButton } from '@/modules/telepsicologia/components/device-toggle-button';

// ---------------------------------------------------------------------------
// Helpers
//
// Lucide renders each icon as an <svg> carrying a stable `lucide-<kebab-name>`
// class (e.g. `lucide-mic`, `lucide-mic-off`). We assert against that class to
// confirm the correct on/off icon is rendered without coupling to internals.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function iconClass(el: HTMLElement): string {
  const svg = el.querySelector('svg');
  return svg?.getAttribute('class') ?? '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeviceToggleButton', () => {
  const cases = [
    { kind: 'mic' as const, onClass: 'lucide-mic', offClass: 'lucide-mic-off' },
    { kind: 'camera' as const, onClass: 'lucide-video', offClass: 'lucide-video-off' },
    {
      kind: 'screenshare' as const,
      onClass: 'lucide-screen-share',
      offClass: 'lucide-screen-share-off',
    },
  ];

  for (const { kind, onClass, offClass } of cases) {
    describe(`kind="${kind}"`, () => {
      it('renders the "on" icon and ghost variant when isOff is false', () => {
        render(
          <DeviceToggleButton kind={kind} isOff={false} onToggle={() => {}} ariaLabel="Desligar" />,
        );

        const button = screen.getByRole('button', { name: 'Desligar' });
        // ghost variant should NOT carry the outline border classes
        expect(button).not.toHaveClass('border');
        expect(iconClass(button)).toContain(onClass);
        expect(iconClass(button)).not.toContain(offClass);
      });

      it('renders the "off" icon and outline variant when isOff is true', () => {
        render(
          <DeviceToggleButton kind={kind} isOff={true} onToggle={() => {}} ariaLabel="Ligar" />,
        );

        const button = screen.getByRole('button', { name: 'Ligar' });
        // outline variant carries the border class
        expect(button).toHaveClass('border');
        expect(iconClass(button)).toContain(offClass);
      });
    });
  }

  it('fires onToggle on click', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <DeviceToggleButton
        kind="mic"
        isOff={false}
        onToggle={onToggle}
        ariaLabel="Desligar microfone"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Desligar microfone' }));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('does not fire onToggle when disabled', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <DeviceToggleButton
        kind="camera"
        isOff={false}
        onToggle={onToggle}
        disabled
        ariaLabel="Desligar câmera"
      />,
    );

    const button = screen.getByRole('button', { name: 'Desligar câmera' });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('exposes the provided aria-label', () => {
    render(
      <DeviceToggleButton
        kind="screenshare"
        isOff={true}
        onToggle={() => {}}
        ariaLabel="Compartilhar tela"
      />,
    );

    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeInTheDocument();
  });

  it('forwards data-testid', () => {
    render(
      <DeviceToggleButton
        kind="mic"
        isOff={false}
        onToggle={() => {}}
        ariaLabel="Desligar microfone"
        data-testid="mic-toggle"
      />,
    );

    expect(screen.getByTestId('mic-toggle')).toBeInTheDocument();
  });
});
