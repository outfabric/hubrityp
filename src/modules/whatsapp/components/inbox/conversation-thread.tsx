'use client';

import { AlertTriangle, Check, CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConversationPatientInfo, TemplatePreview } from '@/modules/whatsapp';
import type { WhatsappMessage } from '@/shared/db/schema/whatsapp/tables';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';

import { MarkResolvedButton } from './mark-resolved-button';
import { MessageComposer } from './message-composer';
import { RiskAlertBanner } from './risk-alert-banner';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationThreadProps {
  patient: ConversationPatientInfo;
  messages: WhatsappMessage[];
  hasRisk: boolean;
  templates: TemplatePreview[];
  getConversation: (patientId: string) => Promise<{
    ok: boolean;
    messages?: WhatsappMessage[];
    patient?: ConversationPatientInfo;
  }>;
  sendFreeTextReply: (patientId: string, input: unknown) => Promise<{ ok: boolean }>;
  sendTemplateReply: (
    patientId: string,
    templateKey: string,
    variables: Record<string, string>,
  ) => Promise<{ ok: boolean }>;
  markResolved: (patientId: string) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives two uppercase initials from a full name.
 */
function deriveInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Formats a message timestamp as HH:mm in São Paulo timezone.
 */
function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/**
 * Returns the last inbound message date for 24h window calculation.
 */
function findLastInboundAt(messages: WhatsappMessage[]): Date | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.direction === 'inbound') {
      return messages[i]!.createdAt;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Message status icon
// ---------------------------------------------------------------------------

function MessageStatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'read':
      return <CheckCircle2 size={12} className="text-brand-500" aria-label="Lido" />;
    case 'delivered':
      return <CheckCircle2 size={12} className="text-text-tertiary" aria-label="Entregue" />;
    case 'sent':
      return <Check size={12} className="text-text-tertiary" aria-label="Enviado" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Conversation thread — displays the chronological list of messages for
 * a patient conversation, with the message composer at the bottom.
 *
 * Layout:
 * - Header: Avatar + patient name + "Marcar como resolvida" button
 * - Risk alert banner (conditional)
 * - Scrollable message list
 * - Composer footer
 *
 * Message bubbles:
 * - Outbound: bg brand-100, text brand-700, aligned right, radius lg
 * - Inbound: bg surface-muted, text text-primary, aligned left, radius lg
 * - Risk-flagged: border danger-500 1.5px + AlertTriangle icon
 */
export function ConversationThread({
  patient,
  messages: initialMessages,
  hasRisk,
  templates,
  getConversation,
  sendFreeTextReply,
  sendTemplateReply,
  markResolved,
}: ConversationThreadProps) {
  const [messages, setMessages] = useState(initialMessages);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on mount and when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Refresh messages after a message is sent or resolved
  const refreshConversation = useCallback(async () => {
    const result = await getConversation(patient.patientId);
    if (result.ok && result.messages) {
      setMessages(result.messages);
    }
  }, [getConversation, patient.patientId]);

  const lastInboundAt = findLastInboundAt(messages);
  const patientInitials = deriveInitials(patient.patientName);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback>{patientInitials}</AvatarFallback>
        </Avatar>
        <h3 className="text-text-primary flex-1 text-[18px] font-semibold">
          {patient.patientName}
        </h3>
        <MarkResolvedButton
          patientId={patient.patientId}
          markResolved={markResolved}
          onResolved={() => void refreshConversation()}
        />
      </div>

      {/* Risk alert */}
      {hasRisk && (
        <div className="px-4 pt-3">
          <RiskAlertBanner hasRisk={hasRisk} />
        </div>
      )}

      {/* Messages list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Histórico de mensagens"
      >
        <div className="space-y-3">
          {messages.map((msg) => {
            const isOutbound = msg.direction === 'outbound';

            return (
              <div
                key={msg.id}
                className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'relative max-w-[75%] rounded-lg px-3 py-2',
                    isOutbound
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-surface-muted text-text-primary',
                    msg.riskFlag && 'border-danger-500 border-[1.5px]',
                  )}
                >
                  {/* Risk icon on flagged messages */}
                  {msg.riskFlag && (
                    <AlertTriangle
                      size={14}
                      className="text-danger-500 absolute top-1.5 right-1.5"
                      aria-label="Mensagem com conteúdo de risco"
                    />
                  )}

                  {/* Message body */}
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.body}</p>

                  {/* Footer: time + status (outbound only) */}
                  <div
                    className={cn(
                      'mt-1 flex items-center gap-1',
                      isOutbound ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <span className="text-text-tertiary text-[12px]">
                      {formatMessageTime(msg.createdAt)}
                    </span>
                    {isOutbound && <MessageStatusIcon status={msg.status} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <MessageComposer
        patientId={patient.patientId}
        lastInboundAt={lastInboundAt}
        templates={templates}
        sendFreeTextReply={sendFreeTextReply}
        sendTemplateReply={sendTemplateReply}
        onMessageSent={() => void refreshConversation()}
      />
    </div>
  );
}
