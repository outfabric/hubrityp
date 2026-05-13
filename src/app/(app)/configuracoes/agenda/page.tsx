import { Suspense } from 'react';

import { getAgendaSettingsImpl } from '@/modules/agenda';
import { AgendaSettingsForm } from '@/modules/agenda/components/agenda-settings-form';
import { createServerClient } from '@/shared/supabase/server';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function AgendaSettingsServer() {
  const supabase = await createServerClient();
  const result = await getAgendaSettingsImpl(supabase);

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar configuracoes. Tente novamente.
      </div>
    );
  }

  return <AgendaSettingsForm settings={result.settings} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AgendaSettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="agenda-settings-page-title"
        >
          Configuracoes da Agenda
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <AgendaSettingsServer />
      </Suspense>
    </>
  );
}
