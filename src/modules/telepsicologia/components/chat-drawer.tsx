'use client';

import type { Call } from '@stream-io/video-react-sdk';
import { useCallback, useEffect, useState } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import {
  type ChatCustomEventPayload,
  type ChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} from '../lib/chat-types';

import { ChatInput } from './chat-input';
import { ChatMessageList } from './chat-message-list';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  call: Call;
  currentUser: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Component
//
// Side drawer (Sheet) for ephemeral in-call chat. Uses a single Sheet with
// side="right". On desktop, width is 360px. On small screens, CSS stretches
// the sheet to full width. Messages are stored in local state and discarded
// when the component unmounts (call ends).
//
// Uses Stream call custom events:
//   - Sends: call.sendCustomEvent({ type, id, text, senderId, senderName, timestamp })
//   - Receives: call.on('custom', handler) -> event.custom contains the payload
// ---------------------------------------------------------------------------

export function ChatDrawer({ open, onOpenChange, call, currentUser }: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Listen for incoming custom events from other participants
  useEffect(() => {
    const unsubscribe = call.on('custom', (event) => {
      // The custom payload is in event.custom (Stream SDK wraps it)
      const payload = event.custom as Partial<ChatCustomEventPayload> | undefined;
      if (!payload || payload.type !== 'chat-message') return;

      // Validate required fields before accepting
      if (!payload.id || !payload.text || !payload.senderId || !payload.senderName) return;

      const incoming: ChatMessage = {
        id: payload.id,
        text: payload.text,
        senderId: payload.senderId,
        senderName: payload.senderName,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      setMessages((prev) => [...prev, incoming]);
    });

    return unsubscribe;
  }, [call]);

  const handleSend = useCallback(
    (text: string) => {
      // Safety cap — defense-in-depth alongside the maxLength on the input element
      const capped = text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
      if (!capped) return;

      const id = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      const payload: ChatCustomEventPayload = {
        type: 'chat-message',
        id,
        text: capped,
        senderId: currentUser.id,
        senderName: currentUser.name,
        timestamp,
      };

      // Optimistically add the message to local state
      const localMessage: ChatMessage = {
        id,
        text: capped,
        senderId: currentUser.id,
        senderName: currentUser.name,
        timestamp,
      };
      setMessages((prev) => [...prev, localMessage]);

      // Send via Stream custom event — fire-and-forget. Errors are swallowed
      // because chat is best-effort and must not disrupt the video call.
      void call.sendCustomEvent(payload).catch(() => {
        // Best-effort — swallow to avoid disrupting the call UX
      });
    },
    [call, currentUser],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:w-[360px]"
        data-testid="chat-drawer"
      >
        <SheetHeader>
          <SheetTitle className="text-[16px] font-medium">Chat</SheetTitle>
          <SheetDescription className="sr-only">
            Mensagens de texto durante a sessão de vídeo
          </SheetDescription>
        </SheetHeader>
        <ChatMessageList messages={messages} />
        <ChatInput onSend={handleSend} />
      </SheetContent>
    </Sheet>
  );
}
