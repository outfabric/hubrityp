'use server';

// Thin route shell for inbox-level Server Actions.
//
// The actual implementations live in `src/modules/whatsapp/server/inbox/`
// (re-exported from `@/modules/whatsapp`). This file MUST stay thin and
// carry the `'use server'` directive — that is what marks it as a Server
// Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function; types cannot be
// re-exported from here.

import type {
  GetConversationResult,
  ListConversationsInput,
  ListConversationsResult,
  ListTemplatesResult,
  MarkConversationResolvedResult,
  SendFreeTextReplyResult,
  SendTemplateReplyResult,
} from '@/modules/whatsapp';
import {
  getConversationImpl,
  listConversationsImpl,
  listTemplatesImpl,
  markConversationResolvedImpl,
  sendFreeTextReplyImpl,
  sendTemplateReplyImpl,
} from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function listConversations(
  input: ListConversationsInput = {},
): Promise<ListConversationsResult> {
  const supabase = await createServerClient();
  return listConversationsImpl(supabase, input);
}

export async function getConversation(patientId: string): Promise<GetConversationResult> {
  const supabase = await createServerClient();
  return getConversationImpl(supabase, patientId);
}

export async function sendFreeTextReply(
  patientId: string,
  input: unknown,
): Promise<SendFreeTextReplyResult> {
  const supabase = await createServerClient();
  return sendFreeTextReplyImpl(supabase, patientId, input);
}

export async function sendTemplateReply(
  patientId: string,
  templateKey: string,
  variables: Record<string, string>,
): Promise<SendTemplateReplyResult> {
  const supabase = await createServerClient();
  return sendTemplateReplyImpl(supabase, patientId, templateKey, variables);
}

export async function markConversationResolved(
  patientId: string,
): Promise<MarkConversationResolvedResult> {
  const supabase = await createServerClient();
  return markConversationResolvedImpl(supabase, patientId);
}

export async function listTemplates(): Promise<ListTemplatesResult> {
  const supabase = await createServerClient();
  return listTemplatesImpl(supabase);
}
