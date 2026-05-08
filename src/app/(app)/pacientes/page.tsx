import { Suspense } from 'react';

import { listPatientsImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

import { listPatients } from './actions';
import { PatientListLoader } from './patient-list-loader';

// ---------------------------------------------------------------------------
// Search params type (Next.js 16+ async searchParams)
// ---------------------------------------------------------------------------

interface PacientesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------------------------------------------------------------------------
// Inner async component that fetches data
// ---------------------------------------------------------------------------

async function PatientListServer({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createServerClient();

  // Build the query from URL search params
  const query = {
    page: searchParams.page ? Number(searchParams.page) : 1,
    pageSize: 25,
    search: typeof searchParams.search === 'string' ? searchParams.search : undefined,
    status:
      typeof searchParams.status === 'string' && searchParams.status !== 'all'
        ? searchParams.status
        : undefined,
    tags:
      typeof searchParams.tags === 'string'
        ? searchParams.tags.split(',').filter(Boolean)
        : undefined,
    sort: typeof searchParams.sort === 'string' ? searchParams.sort : 'full_name',
    order: typeof searchParams.order === 'string' ? searchParams.order : 'asc',
  };

  const result = await listPatientsImpl(supabase, query);

  if (!result.ok) {
    // On auth failure the middleware should have caught this, but guard anyway
    return (
      <div className="text-text-secondary py-12 text-center">
        Erro ao carregar pacientes. Tente novamente.
      </div>
    );
  }

  return (
    <PatientListLoader
      patients={result.patients}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      listAction={listPatients}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function PacientesPage({ searchParams }: PacientesPageProps) {
  const resolvedParams = await searchParams;

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="patients-page-title"
        >
          Pacientes
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <PatientListServer searchParams={resolvedParams} />
      </Suspense>
    </div>
  );
}
