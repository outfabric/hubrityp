'use client';

import { AlertTriangle } from 'lucide-react';

import type { ConversationListItem as ConversationListItemData } from '@/modules/whatsapp';
import { formatConversationTime } from '@/modules/whatsapp/lib/inbox/format-conversation-time';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationListItemProps {
  conversation: ConversationListItemData;
  isSelected: boolean;
  onSelect: (patientId: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A single conversation row in the inbox list.
 *
 * Shows patient avatar (initials), name, last message preview, timestamp,
 * unread dot, and risk indicator. Follows Salvia DS spacing and typography:
 * - padding: space-3 vertical, space-4 horizontal
 * - gap: space-3
 * - avatar: 40px (lg) with initials brand-700 on brand-100
 * - name: body (15px) — 600 weight if unread, 400 if read
 * - preview: body-sm (13px/400) text-secondary, truncated to 1 line
 * - timestamp: caption (12px/500) text-tertiary
 * - unread dot: 8px brand-500 to the left of the name
 * - risk icon: AlertTriangle 16px danger-500 next to the name
 * - selected row: bg brand-50
 * - hover: bg surface-muted
 * - separator: border-subtle between items
 */
export function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
}: ConversationListItemProps) {
  const isUnread = conversation.unreadCount > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Conversa com ${conversation.patientName}${isUnread ? ', mensagens nao lidas' : ''}${conversation.hasRisk ? ', conteudo de risco' : ''}`}
      className={cn(
        'border-border-subtle flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors',
        isSelected ? 'bg-brand-50' : 'hover:bg-surface-muted',
        'focus-visible:shadow-focus focus-visible:outline-none',
      )}
      onClick={() => void onSelect(conversation.patientId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void onSelect(conversation.patientId);
        }
      }}
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback>{conversation.patientInitials}</AvatarFallback>
      </Avatar>

      {/* Text column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* Unread dot */}
          {isUnread && (
            <span className="bg-brand-500 h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
          )}

          {/* Patient name */}
          <span
            className={cn(
              'text-text-primary truncate text-[15px]',
              isUnread ? 'font-semibold' : 'font-normal',
            )}
          >
            {conversation.patientName}
          </span>

          {/* Risk indicator */}
          {conversation.hasRisk && (
            <AlertTriangle
              size={16}
              className="text-danger-500 shrink-0"
              aria-label="Conteudo de risco"
            />
          )}
        </div>

        {/* Preview */}
        <p className="text-text-secondary truncate text-[13px] font-normal">
          {conversation.lastMessagePreview}
        </p>
      </div>

      {/* Timestamp */}
      <span className="text-text-tertiary shrink-0 text-[12px] font-medium">
        {formatConversationTime(conversation.lastMessageAt)}
      </span>
    </div>
  );
}
