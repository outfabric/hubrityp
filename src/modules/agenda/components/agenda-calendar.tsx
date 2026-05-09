'use client';

import type { EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { DateClickArg } from '@fullcalendar/interaction';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { format } from 'date-fns';
import { Lock, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import type { SessionWithDetails } from '@/modules/agenda/server/list-sessions';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

import { AgendaNavBar } from './agenda-nav-bar';
import { BlockFormModal } from './block-form-modal';
import type { RescheduleInfo } from './reschedule-confirm-dialog';
import { RescheduleConfirmDialog } from './reschedule-confirm-dialog';
import { SessionDetailDrawer } from './session-detail-drawer';
import { SessionEventChip } from './session-event-chip';
import type { SessionEditData } from './session-form-modal';
import { SessionFormModal } from './session-form-modal';
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

interface LocationOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

export interface AgendaCalendarProps {
  initialSessions: SessionWithDetails[];
  agendaSettings: AgendaSettingsData | null;
  initialStart: string;
  initialEnd: string;
  locations: LocationOption[];
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
      locationAddress: s.locationAddress,
      modality: s.modality,
      status: s.status,
      color: s.color,
      amount: s.amount,
      notes: s.notes,
      durationMinutes: s.durationMinutes,
    },
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgendaCalendar({
  initialSessions,
  agendaSettings,
  locations,
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  const [currentView, setCurrentView] = useState<CalendarViewName>(getInitialView);
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [sessions, setSessions] = useState<SessionWithDetails[]>(initialSessions);

  // Session detail drawer state
  const [selectedSession, setSelectedSession] = useState<SessionWithDetails | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Session form modal state
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionEditData | null>(null);
  const [preselectedDate, setPreselectedDate] = useState<Date | undefined>(undefined);
  const [preselectedTime, setPreselectedTime] = useState<string | undefined>(undefined);

  // Block form modal state
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  // Reschedule confirmation dialog state
  const [rescheduleInfo, setRescheduleInfo] = useState<RescheduleInfo | null>(null);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);

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

  // Refreshes sessions for the current visible range after a mutation
  const refreshSessions = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    const { activeStart, activeEnd } = api.view;
    void import('@/app/(app)/agenda/actions').then(({ listSessions }) =>
      listSessions(activeStart, activeEnd).then((result) => {
        if (result.ok) {
          setSessions(result.sessions);
        }
      }),
    );
  }, []);

  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const sessionId = arg.event.id;
      const match = sessions.find((s) => s.id === sessionId);
      if (match) {
        setSelectedSession(match);
        setDrawerOpen(true);
      }
    },
    [sessions],
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    // Clear selectedSession after animation completes to avoid flash
    setTimeout(() => setSelectedSession(null), 300);
  }, []);

  const handleSessionMutated = useCallback(() => {
    refreshSessions();
    handleDrawerClose();
  }, [refreshSessions, handleDrawerClose]);

  const handleDateClick = useCallback((arg: DateClickArg) => {
    setEditingSession(null);
    setPreselectedDate(arg.date);
    setPreselectedTime(format(arg.date, 'HH:mm'));
    setSessionModalOpen(true);
  }, []);

  const handleOpenScheduleModal = useCallback(() => {
    setEditingSession(null);
    setPreselectedDate(undefined);
    setPreselectedTime(undefined);
    setSessionModalOpen(true);
  }, []);

  const handleOpenBlockModal = useCallback(() => {
    setBlockModalOpen(true);
  }, []);

  const handleEventDrop = useCallback(
    (info: EventDropArg) => {
      // Revert the visual change immediately so the calendar shows the
      // original position while the user confirms.
      info.revert();

      const sessionId = info.event.id;
      const match = sessions.find((s) => s.id === sessionId);
      if (!match || !info.event.start) return;

      const newStart = info.event.start;
      const newEnd = calculateEndTime(newStart, match.durationMinutes);
      const label = match.isBlocking
        ? (match.blockingTitle ?? 'Bloqueio')
        : (match.patientName ?? 'Paciente');

      setRescheduleInfo({
        sessionId,
        label,
        isBlocking: match.isBlocking,
        originalSession: {
          patientId: match.patientId,
          isBlocking: match.isBlocking,
          blockingTitle: match.blockingTitle,
          durationMinutes: match.durationMinutes,
          locationId: match.locationId,
          modality: match.modality,
          amount: match.amount,
          notes: match.notes,
          color: match.color,
        },
        newStart,
        newEnd,
      });
      setRescheduleDialogOpen(true);
    },
    [sessions],
  );

  const renderEventContent = useCallback((eventInfo: EventContentArg) => {
    return <SessionEventChip eventInfo={eventInfo} />;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Action buttons */}
      <div className="flex items-center justify-end gap-3">
        <Button variant="secondary" data-testid="block-time-button" onClick={handleOpenBlockModal}>
          <Lock className="h-4 w-4" />
          Bloquear horario
        </Button>
        <Button data-testid="schedule-button" onClick={handleOpenScheduleModal}>
          <Plus className="h-4 w-4" />
          Agendar
        </Button>
      </div>

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
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            eventDrop={handleEventDrop}
            datesSet={handleDatesSet}
            height="auto"
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}
            allDaySlot={false}
          />
        </div>
      </Card>

      <SessionDetailDrawer
        session={selectedSession}
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) handleDrawerClose();
        }}
        onSessionMutated={handleSessionMutated}
      />

      <RescheduleConfirmDialog
        rescheduleInfo={rescheduleInfo}
        open={rescheduleDialogOpen}
        onOpenChange={(open) => {
          setRescheduleDialogOpen(open);
          if (!open) {
            // Clear info after animation completes
            setTimeout(() => setRescheduleInfo(null), 300);
          }
        }}
        onConfirm={async (sessionId, input) => {
          const { updateSession } = await import('@/app/(app)/agenda/actions');
          return updateSession(sessionId, input);
        }}
        onSuccess={refreshSessions}
      />

      <SessionFormModal
        open={sessionModalOpen}
        onOpenChange={setSessionModalOpen}
        session={editingSession}
        locations={locations}
        defaultDurationMinutes={agendaSettings?.defaultDurationMinutes ?? 50}
        preselectedDate={preselectedDate}
        preselectedTime={preselectedTime}
        onCreate={async (input) => {
          const { createSession } = await import('@/app/(app)/agenda/actions');
          return createSession(input);
        }}
        onUpdate={async (id, input) => {
          const { updateSession } = await import('@/app/(app)/agenda/actions');
          return updateSession(id, input);
        }}
        onSearchPatients={async (query) => {
          const { searchPatients } = await import('@/app/(app)/agenda/actions');
          return searchPatients(query);
        }}
        onSuccess={refreshSessions}
      />

      <BlockFormModal
        open={blockModalOpen}
        onOpenChange={setBlockModalOpen}
        block={null}
        preselectedDate={preselectedDate}
        preselectedTime={preselectedTime}
        onCreate={async (input) => {
          const { createSession } = await import('@/app/(app)/agenda/actions');
          return createSession(input);
        }}
        onUpdate={async (id, input) => {
          const { updateSession } = await import('@/app/(app)/agenda/actions');
          return updateSession(id, input);
        }}
        onSuccess={refreshSessions}
      />
    </div>
  );
}
