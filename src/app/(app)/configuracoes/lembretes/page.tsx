import { Suspense } from 'react';

import { getReminderSettingsImpl } from '@/modules/whatsapp';
import { ReminderSettingsForm } from '@/modules/whatsapp/components/reminder-settings-form';
import { createServerClient } from '@/shared/supabase/server';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function ReminderSettingsServer() {
  const supabase = await createServerClient();
  const result = await getReminderSettingsImpl(supabase);

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar configuracoes. Tente novamente.
      </div>
    );
  }

  return (
    <ReminderSettingsForm settings={result.data} hasWhatsappAccount={result.hasWhatsappAccount} />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ReminderSettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="reminder-settings-page-title"
        >
          Configurações de Lembretes
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <ReminderSettingsServer />
      </Suspense>
    </>
  );
}
