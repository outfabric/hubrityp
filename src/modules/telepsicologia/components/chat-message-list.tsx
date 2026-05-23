'use client';

import { useEffect, useRef } from 'react';

import type { ChatMessage } from '../lib/chat-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatMessageListProps {
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Component
//
// Scrollable list of chat messages. Each message displays the sender name
// (caption-upper), message text (body-sm), and timestamp (caption,
// text-tertiary). Auto-scrolls to the bottom when new messages arrive.
// aria-live="polite" announces new messages to screen readers.
// ---------------------------------------------------------------------------

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        role="log"
        aria-live="polite"
        aria-label="Mensagens do chat"
        data-testid="chat-message-list"
      >
        <p className="text-text-tertiary text-[13px]">Nenhuma mensagem ainda.</p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-2"
      role="log"
      aria-live="polite"
      aria-label="Mensagens do chat"
      data-testid="chat-message-list"
    >
      <div className="flex flex-col gap-2">
        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-text-primary text-[12px] font-medium tracking-[0.06em] uppercase">
                {msg.senderName}
              </span>
              <span className="text-text-tertiary text-[12px] font-medium">
                {formatTime(msg.timestamp)}
              </span>
            </div>
            <p className="text-text-primary text-[13px] leading-[1.5]">{msg.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats an ISO timestamp to HH:MM for display. */
function formatTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
