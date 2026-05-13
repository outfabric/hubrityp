import { Suspense } from 'react';

import { listLocationsImpl } from '@/modules/agenda';
import { createServerClient } from '@/shared/supabase/server';

import { LocationsPageClient } from './locations-page-client';

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function LocationsListServer() {
  const supabase = await createServerClient();
  const result = await listLocationsImpl(supabase);

  if (!result.ok) {
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar locais. Tente novamente.
      </div>
    );
  }

  return <LocationsPageClient locations={result.locations} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function LocaisPage() {
  return (
    <>
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="locations-page-title"
        >
          Locais de Atendimento
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <LocationsListServer />
      </Suspense>
    </>
  );
}
