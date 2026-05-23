'use client';

import { Send } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

import { MAX_CHAT_MESSAGE_LENGTH } from '../lib/chat-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatInputProps {
  onSend: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Component
//
// Text input + "Enviar" ghost button with Send icon. Submits on Enter key
// or button click. Clears the input after a successful send. Empty messages
// are ignored.
// ---------------------------------------------------------------------------

export function ChatInput({ onSend }: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    onSend(trimmed);
    setText('');
    // Re-focus input after sending so the user can type the next message
    inputRef.current?.focus();
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="bg-surface-muted flex items-center gap-2 px-3 py-3" data-testid="chat-input">
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Digite uma mensagem..."
        aria-label="Mensagem do chat"
        data-testid="chat-input-field"
        autoComplete="off"
        maxLength={MAX_CHAT_MESSAGE_LENGTH}
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSend}
        disabled={text.trim().length === 0}
        aria-label="Enviar"
        data-testid="chat-send-button"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
