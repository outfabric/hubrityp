import { Suspense } from 'react';

import { getWhatsappAccountImpl } from '@/modules/whatsapp';
import { WhatsappAccountCard } from '@/modules/whatsapp/components/whatsapp-account-card';
import { createServerClient } from '@/shared/supabase/server';

import {
  completeTwilioConnection,
  disconnectWhatsapp,
  startTwilioConnection,
} from './actions';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function WhatsappAccountServer() {
  const supabase = await createServerClient();
  const result = await getWhatsappAccountImpl(supabase);

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar integracao. Tente novamente.
      </div>
    );
  }

  return (
    <WhatsappAccountCard
      account={result.account}
      onDisconnect={disconnectWhatsapp}
      onStartConnection={startTwilioConnection}
      onCompleteConnection={completeTwilioConnection}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function WhatsappIntegrationPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="whatsapp-integration-page-title"
        >
          WhatsApp
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <WhatsappAccountServer />
      </Suspense>
    </div>
  );
}
