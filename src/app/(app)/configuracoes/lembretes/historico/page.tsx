import { Suspense } from 'react';

import { getAnalyticsSummaryImpl, type AnalyticsSummary } from '@/modules/whatsapp';
import { AnalyticsDashboard } from '@/modules/whatsapp/components/inbox/analytics-dashboard';
import { createServerClient } from '@/shared/supabase/server';

import { getAnalyticsSummary, searchMessageHistory } from './actions';

// ---------------------------------------------------------------------------
// Inner async component — loads initial analytics data on the server
// ---------------------------------------------------------------------------

async function AnalyticsServer() {
  const supabase = await createServerClient();
  const result = await getAnalyticsSummaryImpl(supabase);

  const initialData: AnalyticsSummary | null = result.ok ? result.data : null;

  if (!initialData) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar dados de analytics. Tente novamente.
      </div>
    );
  }

  return (
    <AnalyticsDashboard
      initialData={initialData}
      getAnalyticsSummary={getAnalyticsSummary}
      searchMessageHistory={searchMessageHistory}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HistoricoPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="historico-page-title"
        >
          Historico de Lembretes
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <AnalyticsServer />
      </Suspense>
    </div>
  );
}
