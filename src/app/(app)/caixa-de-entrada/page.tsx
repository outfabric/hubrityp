import { Suspense } from 'react';

import { listConversationsImpl, listTemplatesImpl } from '@/modules/whatsapp';
import { ConversationList } from '@/modules/whatsapp/components/inbox/conversation-list';
import { createServerClient } from '@/shared/supabase/server';

import {
  getConversation,
  listConversations,
  markConversationResolved,
  sendFreeTextReply,
  sendTemplateReply,
} from './actions';

// ---------------------------------------------------------------------------
// Inner async component that fetches initial data
// ---------------------------------------------------------------------------

async function InboxContent() {
  const supabase = await createServerClient();

  const [conversationsResult, templatesResult] = await Promise.all([
    listConversationsImpl(supabase),
    listTemplatesImpl(supabase),
  ]);

  const initialConversations = conversationsResult.ok ? conversationsResult.conversations : [];
  const templates = templatesResult.ok ? templatesResult.templates : [];

  return (
    <ConversationList
      initialConversations={initialConversations}
      templates={templates}
      listConversations={listConversations}
      getConversation={getConversation}
      sendFreeTextReply={sendFreeTextReply}
      sendTemplateReply={sendTemplateReply}
      markResolved={markConversationResolved}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CaixaDeEntradaPage() {
  return (
    <div className="-mx-6 -mt-8 flex h-[calc(100vh-57px)] flex-col">
      <div className="px-6 pt-6 pb-3">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="inbox-page-title"
        >
          Caixa de entrada
        </h1>
      </div>

      <div className="flex-1 overflow-hidden px-6">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          }
        >
          <InboxContent />
        </Suspense>
      </div>
    </div>
  );
}
