import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('layout-uuid') });

const mockCall = {
  sendCustomEvent: vi.fn().mockResolvedValue({}),
  on: vi.fn().mockReturnValue(() => undefined),
};

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { ChatDrawer } from '@/modules/telepsicologia/components/chat-drawer';
import { ChatInput } from '@/modules/telepsicologia/components/chat-input';
import { ChatMessageList } from '@/modules/telepsicologia/components/chat-message-list';
import type { ChatMessage } from '@/modules/telepsicologia/lib/chat-types';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sampleMessages: ChatMessage[] = [
  {
    id: 'm1',
    text: 'Mensagem de exemplo',
    senderId: 'patient-1',
    senderName: 'Paciente',
    timestamp: '2026-05-23T10:30:00Z',
  },
];

// ---------------------------------------------------------------------------
// D5 — chat drawer layout conforms to the Sálvia design system.
// These assertions lock in the inset/footer/typography contract so a future
// refactor cannot silently regress the visual alignment.
// ---------------------------------------------------------------------------

describe('chat drawer layout (Sálvia design system)', () => {
  it('shares the same horizontal inset (px-4) across header, message list, and input', () => {
    render(
      <ChatDrawer
        open
        onOpenChange={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call={mockCall as any}
        currentUser={{ id: 'psy-1', name: 'Dr. Fulano' }}
      />,
    );

    // Header: SheetHeader wraps the title; the title's parent carries the inset.
    const title = screen.getByText('Chat');
    const header = title.parentElement;
    expect(header).not.toBeNull();
    expect(header).toHaveClass('px-4');
    expect(header).toHaveClass('pt-4');

    // Message list and input both expose their own px-4 inset.
    expect(screen.getByTestId('chat-message-list')).toHaveClass('px-4');
    expect(screen.getByTestId('chat-input')).toHaveClass('px-4');
  });

  it('renders the input region as a bordered drawer-footer on plain surface (not a surface-muted band)', () => {
    render(<ChatInput onSend={vi.fn()} />);

    const input = screen.getByTestId('chat-input');
    // Drawer-footer convention: plain surface + top border, matching prontuario-call-drawer.
    expect(input).toHaveClass('bg-surface');
    expect(input).toHaveClass('border-t');
    expect(input).toHaveClass('border-border');
    // The old surface-muted band must be gone.
    expect(input).not.toHaveClass('bg-surface-muted');
  });

  it('uses design-system scale tokens for sender name, timestamp, and message text', () => {
    render(<ChatMessageList messages={sampleMessages} />);

    // Sender name → caption-upper (12px / 500 + tracking + uppercase) via text-xs token.
    const senderName = screen.getByText('Paciente');
    expect(senderName).toHaveClass('text-xs');
    expect(senderName).toHaveClass('font-medium');
    expect(senderName).toHaveClass('uppercase');
    expect(senderName).toHaveClass('tracking-[0.06em]');
    // No arbitrary px sizing left behind.
    expect(senderName.className).not.toContain('text-[12px]');

    // Message text → body-sm (13px / 400).
    const messageText = screen.getByText('Mensagem de exemplo');
    expect(messageText).toHaveClass('text-[0.8125rem]');
    expect(messageText).toHaveClass('font-normal');
    expect(messageText.className).not.toContain('text-[13px]');
  });

  it('uses a 4-multiple inter-message gap consistent with list rhythm', () => {
    render(<ChatMessageList messages={sampleMessages} />);

    // The flex column that stacks messages carries the gap token.
    const messageStack = screen.getByText('Mensagem de exemplo').closest('.flex.flex-col.gap-4');
    expect(messageStack).not.toBeNull();
  });

  it('preserves accessibility attributes and testids on the message list', () => {
    render(<ChatMessageList messages={sampleMessages} />);

    const list = screen.getByTestId('chat-message-list');
    expect(list).toHaveAttribute('role', 'log');
    expect(list).toHaveAttribute('aria-live', 'polite');
  });
});
