import { endOfWeek, startOfWeek } from 'date-fns';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  getAgendaSettingsImpl,
  listLocationsImpl,
  listOverdueEvolutionsImpl,
  listSessionsImpl,
  OverdueEvolutionsList,
  resolveAgendaListFilter,
} from '@/modules/agenda';
import { createServerClient } from '@/shared/supabase/server';

import { AgendaCalendarLoader } from './agenda-calendar-loader';

// ---------------------------------------------------------------------------
// Inner async component — fetches initial data for the calendar
// ---------------------------------------------------------------------------

async function AgendaDataServer() {
  const supabase = await createServerClient();

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

  const [sessionsResult, settingsResult, locationsResult] = await Promise.all([
    listSessionsImpl(supabase, weekStart, weekEnd),
    getAgendaSettingsImpl(supabase),
    listLocationsImpl(supabase),
  ]);

  // Gracefully degrade — show empty calendar on error
  const initialSessions = sessionsResult.ok ? sessionsResult.sessions : [];
  const agendaSettings = settingsResult.ok ? settingsResult.settings : null;
  const locations = locationsResult.ok
    ? locationsResult.locations.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        isDefault: l.isDefault,
      }))
    : [];

  return (
    <AgendaCalendarLoader
      initialSessions={initialSessions}
      agendaSettings={agendaSettings}
      initialStart={weekStart.toISOString()}
      initialEnd={weekEnd.toISOString()}
      locations={locations}
    />
  );
}

// ---------------------------------------------------------------------------
// Inner async component — fetches the overdue-evolutions list
// ---------------------------------------------------------------------------

async function OverdueEvolutionsListServer() {
  const supabase = await createServerClient();

  const result = await listOverdueEvolutionsImpl(supabase);

  // Defense-in-depth mirror of the middleware gate: if the session is invalid
  // by the time the data-fetch runs, send the user back to login rather than
  // rendering a logged-out view of (an empty) clinical-adjacent list.
  if (!result.ok) {
    redirect('/login');
  }

  return <OverdueEvolutionsList items={result.items} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface AgendaPageProps {
  searchParams: Promise<{ filtro?: string | string[] }>;
}

export default async function AgendaPage({ searchParams }: AgendaPageProps) {
  const { filtro } = await searchParams;
  const view = resolveAgendaListFilter(filtro);

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="agenda-page-title"
        >
          Agenda
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        {view === 'sem-evolucao' ? <OverdueEvolutionsListServer /> : <AgendaDataServer />}
      </Suspense>
    </div>
  );
}
