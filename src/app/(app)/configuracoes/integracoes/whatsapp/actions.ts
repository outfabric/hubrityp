'use server';

// Thin route shell for WhatsApp integration Server Actions.
//
// The actual implementations live in `src/modules/whatsapp/server/` (re-exported
// from `@/modules/whatsapp`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import { revalidatePath } from 'next/cache';

import type {
  CompleteTwilioConnectionResult,
  DisconnectWhatsappResult,
  GetWhatsappAccountResult,
  StartTwilioConnectionResult,
} from '@/modules/whatsapp';
import {
  completeTwilioConnectionImpl,
  disconnectWhatsappImpl,
  getWhatsappAccountImpl,
  startTwilioConnectionImpl,
} from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function getWhatsappAccount(): Promise<GetWhatsappAccountResult> {
  const supabase = await createServerClient();
  return getWhatsappAccountImpl(supabase);
}

export async function startTwilioConnection(input: unknown): Promise<StartTwilioConnectionResult> {
  const supabase = await createServerClient();
  return startTwilioConnectionImpl(supabase, input);
}

export async function completeTwilioConnection(
  input: unknown,
): Promise<CompleteTwilioConnectionResult> {
  const supabase = await createServerClient();
  const result = await completeTwilioConnectionImpl(supabase, input);
  if (result.ok) {
    revalidatePath('/configuracoes/integracoes/whatsapp');
  }
  return result;
}

export async function disconnectWhatsapp(): Promise<DisconnectWhatsappResult> {
  const supabase = await createServerClient();
  const result = await disconnectWhatsappImpl(supabase);
  if (result.ok) {
    revalidatePath('/configuracoes/integracoes/whatsapp');
  }
  return result;
}
