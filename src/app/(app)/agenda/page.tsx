import { endOfWeek, startOfWeek } from 'date-fns';
import { Lock, Plus } from 'lucide-react';
import { Suspense } from 'react';

import { getAgendaSettingsImpl, listSessionsImpl } from '@/modules/agenda';
import { createServerClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { AgendaCalendarLoader } from './agenda-calendar-loader';

// ---------------------------------------------------------------------------
// Inner async component — fetches initial data for the calendar
// ---------------------------------------------------------------------------

async function AgendaDataServer() {
  const supabase = await createServerClient();

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });

  const [sessionsResult, settingsResult] = await Promise.all([
    listSessionsImpl(supabase, weekStart, weekEnd),
    getAgendaSettingsImpl(supabase),
  ]);

  // Gracefully degrade — show empty calendar on error
  const initialSessions = sessionsResult.ok ? sessionsResult.sessions : [];
  const agendaSettings = settingsResult.ok ? settingsResult.settings : null;

  return (
    <AgendaCalendarLoader
      initialSessions={initialSessions}
      agendaSettings={agendaSettings}
      initialStart={weekStart.toISOString()}
      initialEnd={weekEnd.toISOString()}
    />
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AgendaPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 flex items-center justify-between">
        <h1
          className="text-text-primary text-[28px] leading-[1.25] font-semibold"
          data-testid="agenda-page-title"
        >
          Agenda
        </h1>

        <div className="flex items-center gap-3">
          <Button variant="secondary" data-testid="block-time-button">
            <Lock className="h-4 w-4" />
            Bloquear horario
          </Button>
          <Button data-testid="schedule-button">
            <Plus className="h-4 w-4" />
            Agendar
          </Button>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        }
      >
        <AgendaDataServer />
      </Suspense>
    </div>
  );
}
