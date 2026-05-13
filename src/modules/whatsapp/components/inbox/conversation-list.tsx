'use client';

import { useCallback, useState } from 'react';

import type {
  ConversationListItem as ConversationListItemData,
  ConversationPatientInfo,
  ListConversationsInput,
  TemplatePreview,
} from '@/modules/whatsapp';
import type { WhatsappMessage } from '@/shared/db/schema/whatsapp/tables';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import { ConversationListItem } from './conversation-list-item';
import { ConversationThread } from './conversation-thread';
import { ConversationsFilters, type InboxFilter } from './conversations-filters';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationListProps {
  initialConversations: ConversationListItemData[];
  templates: TemplatePreview[];
  listConversations: (
    input: ListConversationsInput,
  ) => Promise<{ ok: boolean; conversations?: ConversationListItemData[]; total?: number }>;
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
// Component
// ---------------------------------------------------------------------------

/**
 * Orchestrator component for the inbox conversation list + thread layout.
 *
 * Desktop: two-column layout — list 380px + thread flex-1.
 * Mobile: list full-width, thread in Sheet bottom-up on click.
 *
 * Manages:
 * - Conversation list data (filters, search, pagination)
 * - Selected conversation state
 * - Loading thread data when a conversation is selected
 * - Mobile Sheet state
 */
export function ConversationList({
  initialConversations,
  templates,
  listConversations,
  getConversation,
  sendFreeTextReply,
  sendTemplateReply,
  markResolved,
}: ConversationListProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');

  // Selected conversation thread data
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<WhatsappMessage[]>([]);
  const [threadPatient, setThreadPatient] = useState<ConversationPatientInfo | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  // Mobile sheet open state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // ---- Fetch conversations with filters ----
  const fetchConversations = useCallback(
    async (newFilter: InboxFilter, newSearch: string) => {
      const input: ListConversationsInput = {};

      if (newFilter === 'unread') input.onlyUnread = true;
      if (newFilter === 'risk') input.onlyRisk = true;
      if (newSearch) input.search = newSearch;

      const result = await listConversations(input);

      if (result.ok && result.conversations) {
        setConversations(result.conversations);
      }
    },
    [listConversations],
  );

  // ---- Handle filter change ----
  const handleFilterChange = useCallback(
    (newFilter: InboxFilter) => {
      setFilter(newFilter);
      void fetchConversations(newFilter, search);
    },
    [fetchConversations, search],
  );

  // ---- Handle search change ----
  const handleSearchChange = useCallback(
    (newSearch: string) => {
      setSearch(newSearch);
      void fetchConversations(filter, newSearch);
    },
    [fetchConversations, filter],
  );

  // ---- Handle conversation selection ----
  const handleSelectConversation = useCallback(
    async (patientId: string) => {
      setSelectedPatientId(patientId);
      setThreadLoading(true);
      setMobileSheetOpen(true);

      try {
        const result = await getConversation(patientId);
        if (result.ok && result.messages && result.patient) {
          setThreadMessages(result.messages);
          setThreadPatient(result.patient);
        }
      } finally {
        setThreadLoading(false);
      }
    },
    [getConversation],
  );

  // Find selected conversation for risk flag
  const selectedConversation = conversations.find((c) => c.patientId === selectedPatientId);

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0">
      {/* Left: Conversation list */}
      <div className="border-border-subtle flex w-full flex-col border-r md:w-[380px] md:shrink-0">
        {/* Filters */}
        <div className="border-border-subtle border-b px-4 py-3">
          <ConversationsFilters
            activeFilter={filter}
            onFilterChange={handleFilterChange}
            onSearchChange={handleSearchChange}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="text-text-secondary py-12 text-center text-[15px]">
              Nenhuma conversa encontrada.
            </div>
          ) : (
            conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.conversationId}
                conversation={conversation}
                isSelected={conversation.patientId === selectedPatientId}
                onSelect={handleSelectConversation}
              />
            ))
          )}
        </div>
      </div>

      {/* Right: Thread (desktop only) */}
      <div className="hidden flex-1 md:flex md:flex-col">
        {threadLoading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        )}

        {!threadLoading && threadPatient && selectedPatientId && (
          <ConversationThread
            patient={threadPatient}
            messages={threadMessages}
            hasRisk={selectedConversation?.hasRisk ?? false}
            templates={templates}
            getConversation={getConversation}
            sendFreeTextReply={sendFreeTextReply}
            sendTemplateReply={sendTemplateReply}
            markResolved={markResolved}
          />
        )}

        {!threadLoading && !selectedPatientId && (
          <div className="text-text-secondary flex flex-1 items-center justify-center text-[15px]">
            Selecione uma conversa para ver as mensagens.
          </div>
        )}
      </div>

      {/* Mobile: Thread in Sheet */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="bottom" className="h-[90vh] overflow-hidden p-0 md:hidden">
          {/* visually-hidden title for accessibility — Radix requires it */}
          <SheetHeader className="sr-only">
            <SheetTitle>{threadPatient ? threadPatient.patientName : 'Conversa'}</SheetTitle>
          </SheetHeader>

          {threadLoading && (
            <div className="flex h-full items-center justify-center">
              <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          )}

          {!threadLoading && threadPatient && selectedPatientId && (
            <ConversationThread
              patient={threadPatient}
              messages={threadMessages}
              hasRisk={selectedConversation?.hasRisk ?? false}
              templates={templates}
              getConversation={getConversation}
              sendFreeTextReply={sendFreeTextReply}
              sendTemplateReply={sendTemplateReply}
              markResolved={markResolved}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
