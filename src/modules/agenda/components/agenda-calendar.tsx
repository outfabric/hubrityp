'use client';

import type { EventContentArg, EventDropArg } from '@fullcalendar/core';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { DateClickArg } from '@fullcalendar/interaction';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SessionWithDetails } from '@/modules/agenda';
import { Card } from '@/shared/ui/card';

import { AgendaNavBar } from './agenda-nav-bar';
import { SessionEventChip } from './session-event-chip';
import './session-event-chip.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessHourEntry {
  day: number;
  start: string;
  end: string;
}

interface AgendaSettingsData {
  businessHours: unknown;
  defaultDurationMinutes: number;
  intervalMinutes: number;
}

export interface AgendaCalendarProps {
  initialSessions: SessionWithDetails[];
  agendaSettings: AgendaSettingsData | null;
  initialStart: string;
  initialEnd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CalendarViewName = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

function getInitialView(): CalendarViewName {
  if (typeof window === 'undefined') return 'timeGridWeek';
  return window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek';
}

/**
 * Derives FullCalendar `businessHours` config from the settings array.
 * FullCalendar expects `daysOfWeek` as an array of day indices (0=Sun..6=Sat).
 */
function toFcBusinessHours(
  hours: unknown,
): Array<{ daysOfWeek: number[]; startTime: string; endTime: string }> {
  if (!Array.isArray(hours)) return [];
  return hours.map((h: BusinessHourEntry) => ({
    daysOfWeek: [h.day],
    startTime: h.start,
    endTime: h.end,
  }));
}

/**
 * Derives slot boundaries from business hours for a tight calendar view.
 * Subtracts 1h before earliest start and adds 1h after latest end.
 */
function deriveSlotBounds(hours: unknown): {
  slotMinTime: string;
  slotMaxTime: string;
} {
  if (!Array.isArray(hours) || hours.length === 0) {
    return { slotMinTime: '07:00:00', slotMaxTime: '21:00:00' };
  }

  let minH = 23;
  let maxH = 0;

  for (const h of hours as BusinessHourEntry[]) {
    const startH = parseInt(h.start.split(':')[0] ?? '8', 10);
    const endH = parseInt(h.end.split(':')[0] ?? '20', 10);
    if (startH < minH) minH = startH;
    if (endH > maxH) maxH = endH;
  }

  const slotMin = Math.max(0, minH - 1);
  const slotMax = Math.min(24, maxH + 1);

  return {
    slotMinTime: `${String(slotMin).padStart(2, '0')}:00:00`,
    slotMaxTime: `${String(slotMax).padStart(2, '0')}:00:00`,
  };
}

/**
 * Maps SessionWithDetails[] to FullCalendar event objects.
 */
function sessionsToEvents(sessions: SessionWithDetails[]) {
  return sessions.map((s) => ({
    id: s.id,
    title: s.isBlocking ? (s.blockingTitle ?? 'Bloqueio') : (s.patientName ?? 'Paciente'),
    start: s.startAt,
    end: s.endAt,
    extendedProps: {
      isBlocking: s.isBlocking,
      blockingTitle: s.blockingTitle,
      patientName: s.patientName,
      locationName: s.locationName,
      locationType: s.locationType,
      modality: s.modality,
      status: s.status,
      color: s.color,
    },
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgendaCalendar({ initialSessions, agendaSettings }: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  const [currentView, setCurrentView] = useState<CalendarViewName>(getInitialView);
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [sessions, setSessions] = useState<SessionWithDetails[]>(initialSessions);

  // Derive business hours config
  const businessHours = useMemo(
    () => toFcBusinessHours(agendaSettings?.businessHours),
    [agendaSettings?.businessHours],
  );

  const { slotMinTime, slotMaxTime } = useMemo(
    () => deriveSlotBounds(agendaSettings?.businessHours),
    [agendaSettings?.businessHours],
  );

  const events = useMemo(() => sessionsToEvents(sessions), [sessions]);

  // Sync calendar API when currentDate or currentView changes from nav bar
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    const apiDate = api.getDate();
    if (apiDate.getTime() !== currentDate.getTime()) {
      api.gotoDate(currentDate);
    }

    if (api.view.type !== currentView) {
      api.changeView(currentView);
    }
  }, [currentDate, currentView]);

  // Fetch sessions when navigation changes the visible range
  const handleDatesSet = useCallback((arg: { start: Date; end: Date; view: { type: string } }) => {
    setCurrentDate(arg.start);
    setCurrentView(arg.view.type as CalendarViewName);

    // Lazy-import the server action to fetch sessions for the new range.
    // Fire-and-forget — FullCalendar expects a void callback.
    void import('@/app/(app)/agenda/actions').then(({ listSessions }) =>
      listSessions(arg.start, arg.end).then((result) => {
        if (result.ok) {
          setSessions(result.sessions);
        }
      }),
    );
  }, []);

  const handleDateClick = useCallback((_: DateClickArg) => {
    // Future: opens session creation modal pre-filled with date/time
    void _;
  }, []);

  const handleEventDrop = useCallback((_: EventDropArg) => {
    // Future: triggers reschedule confirmation dialog
    void _;
  }, []);

  const renderEventContent = useCallback((eventInfo: EventContentArg) => {
    return <SessionEventChip eventInfo={eventInfo} />;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <AgendaNavBar
        currentDate={currentDate}
        currentView={currentView}
        onDateChange={setCurrentDate}
        onViewChange={setCurrentView}
        calendarRef={calendarRef}
      />

      <Card className="shadow-none">
        <div className="agenda-calendar-wrapper p-2">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={currentView}
            locale={ptBrLocale}
            headerToolbar={false}
            slotMinTime={slotMinTime}
            slotMaxTime={slotMaxTime}
            slotDuration="00:30:00"
            businessHours={businessHours}
            nowIndicator
            editable
            droppable={false}
            events={events}
            eventContent={renderEventContent}
            dateClick={handleDateClick}
            eventDrop={handleEventDrop}
            datesSet={handleDatesSet}
            height="auto"
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}
            allDaySlot={false}
          />
        </div>
      </Card>
    </div>
  );
}
