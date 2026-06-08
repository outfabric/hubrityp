import { Suspense } from 'react';

import { listPatientsImpl, resolvePatientListFilter } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

import { generateConsent } from './[id]/actions';
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

  // Resolve the `filtro` deep-link param against a closed allowlist. Anything
  // outside the allowlist degrades to `null` (no filter) — never trust the raw
  // attacker-controlled query string.
  const missingConsent = resolvePatientListFilter(searchParams.filtro) === 'sem-consentimento';

  // Build the query from URL search params. The missing-consent filter is
  // applied server-side here so the very first paint is already scoped to the
  // pendência set (RNF-12.01 — no flash of the unfiltered list).
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
    missingConsent,
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
    // Key by the active filter so toggling `?filtro=sem-consentimento` (e.g.
    // removing the chip) REMOUNTS the client list with the freshly server-fetched
    // page. `PatientList` seeds its row state from `initialPatients` via
    // `useState`, which ignores later prop changes; without remounting, dropping
    // the filter would clear the chip but leave the stale (filtered) rows on
    // screen (RF-12.13 — the full list must return).
    <PatientListLoader
      key={missingConsent ? 'filter-missing-consent' : 'filter-none'}
      patients={result.patients}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      listAction={listPatients}
      missingConsent={missingConsent}
      consentShare={result.consentShare}
      generateConsentAction={generateConsent}
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
