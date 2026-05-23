import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

// Mock crypto.randomUUID for deterministic message IDs
const mockRandomUUID = vi.fn().mockReturnValue('test-uuid-1234');
vi.stubGlobal('crypto', { randomUUID: mockRandomUUID });

// Track custom event listeners registered via call.on('custom', handler)
type CustomEventHandler = (event: { custom: Record<string, unknown> }) => void;
let customEventHandlers: CustomEventHandler[] = [];

const mockSendCustomEvent = vi.fn().mockResolvedValue({});
const mockOn = vi.fn().mockImplementation((_eventName: string, handler: CustomEventHandler) => {
  customEventHandlers.push(handler);
  // Return unsubscribe function
  return () => {
    customEventHandlers = customEventHandlers.filter((h) => h !== handler);
  };
});

const mockCall = {
  sendCustomEvent: mockSendCustomEvent,
  on: mockOn,
};

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { ChatDrawer } from '@/modules/telepsicologia/components/chat-drawer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  customEventHandlers = [];
});

const defaultCurrentUser = { id: 'psychologist-123', name: 'Dr. Fulano' };

function renderDrawer(
  opts: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  const { open = true, onOpenChange = vi.fn() } = opts;

  return {
    onOpenChange,
    ...render(
      <ChatDrawer
        open={open}
        onOpenChange={onOpenChange}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call={mockCall as any}
        currentUser={defaultCurrentUser}
      />,
    ),
  };
}

/** Simulates an incoming custom event from another participant. */
function simulateIncomingMessage(overrides: Record<string, unknown> = {}) {
  const event = {
    custom: {
      type: 'chat-message',
      id: 'incoming-msg-1',
      text: 'Ola, tudo bem?',
      senderId: 'patient-456',
      senderName: 'Paciente',
      timestamp: '2026-05-23T10:30:00Z',
      ...overrides,
    },
  };

  act(() => {
    for (const handler of customEventHandlers) {
      handler(event);
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatDrawer', () => {
  beforeEach(() => {
    mockRandomUUID.mockReturnValue('test-uuid-1234');
  });

  it('renders messages in order', () => {
    renderDrawer({ open: true });

    // Simulate two incoming messages in order
    simulateIncomingMessage({
      id: 'msg-1',
      text: 'Primeira mensagem',
      senderName: 'Paciente',
      timestamp: '2026-05-23T10:30:00Z',
    });

    simulateIncomingMessage({
      id: 'msg-2',
      text: 'Segunda mensagem',
      senderName: 'Paciente',
      timestamp: '2026-05-23T10:31:00Z',
    });

    const firstMsg = screen.getByText('Primeira mensagem');
    const secondMsg = screen.getByText('Segunda mensagem');

    // Verify order: first message appears before second in the DOM
    expect(firstMsg.compareDocumentPosition(secondMsg)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('sends message via custom event on submit', async () => {
    const user = userEvent.setup();
    renderDrawer({ open: true });

    const inputField = screen.getByTestId('chat-input-field');
    const sendButton = screen.getByTestId('chat-send-button');

    await user.type(inputField, 'Oi paciente');
    await user.click(sendButton);

    await waitFor(() => {
      expect(mockSendCustomEvent).toHaveBeenCalledWith({
        type: 'chat-message',
        id: 'test-uuid-1234',
        text: 'Oi paciente',
        senderId: 'psychologist-123',
        senderName: 'Dr. Fulano',
        timestamp: expect.any(String),
      });
    });
  });

  it('clears input after send', async () => {
    const user = userEvent.setup();
    renderDrawer({ open: true });

    const inputField = screen.getByTestId('chat-input-field');
    const sendButton = screen.getByTestId('chat-send-button');

    await user.type(inputField, 'Mensagem de teste');
    await user.click(sendButton);

    await waitFor(() => {
      expect(inputField).toHaveValue('');
    });
  });

  it('new incoming message is appended', () => {
    renderDrawer({ open: true });

    // Start with no messages
    expect(screen.getByText('Nenhuma mensagem ainda.')).toBeInTheDocument();

    // Simulate an incoming message
    simulateIncomingMessage({
      id: 'msg-incoming',
      text: 'Nova mensagem do paciente',
      senderName: 'Paciente',
    });

    expect(screen.getByText('Nova mensagem do paciente')).toBeInTheDocument();
    // The "empty" text should be gone
    expect(screen.queryByText('Nenhuma mensagem ainda.')).not.toBeInTheDocument();
  });

  it('drawer toggles open/close', () => {
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <ChatDrawer
        open={true}
        onOpenChange={onOpenChange}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call={mockCall as any}
        currentUser={defaultCurrentUser}
      />,
    );

    // Check drawer is rendered
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByTestId('chat-drawer')).toBeInTheDocument();

    // Re-render with open=false
    rerender(
      <ChatDrawer
        open={false}
        onOpenChange={onOpenChange}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        call={mockCall as any}
        currentUser={defaultCurrentUser}
      />,
    );

    // Sheet with open=false should not render content
    expect(screen.queryByTestId('chat-drawer')).not.toBeInTheDocument();
  });

  it('registers custom event listener on mount', () => {
    renderDrawer({ open: true });

    expect(mockOn).toHaveBeenCalledWith('custom', expect.any(Function));
  });

  it('ignores custom events that are not chat-message type', () => {
    renderDrawer({ open: true });

    // Simulate a non-chat custom event
    act(() => {
      for (const handler of customEventHandlers) {
        handler({
          custom: {
            type: 'reaction',
            emoji: '1',
          },
        });
      }
    });

    // Should still show empty state
    expect(screen.getByText('Nenhuma mensagem ainda.')).toBeInTheDocument();
  });

  it('does not send empty messages', () => {
    renderDrawer({ open: true });

    const sendButton = screen.getByTestId('chat-send-button');

    // Button should be disabled when input is empty
    expect(sendButton).toBeDisabled();

    expect(mockSendCustomEvent).not.toHaveBeenCalled();
  });

  it('caps oversized messages at MAX_CHAT_MESSAGE_LENGTH', async () => {
    const user = userEvent.setup();
    renderDrawer({ open: true });

    const input = screen.getByPlaceholderText(/mensagem/i);
    const oversized = 'a'.repeat(3000);

    await user.click(input);
    // Paste directly — bypasses HTML maxLength which is browser-enforced
    await user.paste(oversized);
    await user.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(mockSendCustomEvent).toHaveBeenCalledTimes(1);
    });

    const payload = mockSendCustomEvent.mock.calls[0]![0] as { text: string };
    expect(payload.text.length).toBeLessThanOrEqual(2000);
  });
});
