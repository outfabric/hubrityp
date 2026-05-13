'use client';

import type { EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { DateClickArg } from '@fullcalendar/interaction';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Lock, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import type { SessionWithDetails } from '@/modules/agenda/server/list-sessions';
import { EditScopeDialog, type EditScope } from '@/modules/sessions';
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

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Converts a UTC date to a timezone-naive ISO string in America/Sao_Paulo.
 *
 * FullCalendar uses the browser's local timezone by default (`timeZone:
 * 'local'`). To ensure the calendar always displays São Paulo wall-clock
 * times — regardless of the browser timezone — we strip the offset and
 * provide a bare ISO string (e.g., `2026-05-18T10:00:00`). FullCalendar
 * interprets these as "floating" local times and renders them as-is.
 */
function toSaoPauloIso(utcDate: Date): string {
  return formatInTimeZone(utcDate, SAO_PAULO_TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Converts a FullCalendar Date (browser-local, representing Sao Paulo
 * wall-clock) back to a proper UTC Date.
 *
 * Because we feed FullCalendar timezone-naive strings (Sao Paulo wall-clock),
 * dates returned by FullCalendar callbacks (dateClick, eventDrop) have the
 * Sao Paulo hour values as their browser-local components. This helper reads
 * those local components and creates the correct UTC representation.
 */
function fcDateToUtc(localDate: Date): Date {
  // Read browser-local components (which represent Sao Paulo wall-clock)
  const wall = new Date(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds(),
    0,
  );
  return fromZonedTime(wall, SAO_PAULO_TZ);
}

/**
 * Maps SessionWithDetails[] to FullCalendar event objects.
 *
 * Converts UTC start/end to São Paulo wall-clock strings so the calendar
 * renders correct times even when the browser is not in BRT.
 */
function sessionsToEvents(sessions: SessionWithDetails[]) {
  return sessions.map((s) => {
    // For couple sessions, prefer the "Ana & Carlos" display name
    const displayName = s.coupleDisplayName ?? s.patientName;

    return {
      id: s.id,
      title: s.isBlocking ? (s.blockingTitle ?? 'Bloqueio') : (displayName ?? 'Paciente'),
      start: toSaoPauloIso(new Date(s.startAt)),
      end: toSaoPauloIso(new Date(s.endAt)),
      extendedProps: {
        isBlocking: s.isBlocking,
        blockingTitle: s.blockingTitle,
        patientName: displayName,
        locationName: s.locationName,
        locationType: s.locationType,
        locationAddress: s.locationAddress,
        modality: s.modality,
        status: s.status,
        color: s.color,
        amount: s.amount,
        notes: s.notes,
        durationMinutes: s.durationMinutes,
        recurrenceId: s.recurrenceId,
        patientIds: s.patientIds,
        coupleDisplayName: s.coupleDisplayName,
      },
    };
  });
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

  // Edit scope dialog state — shown when editing or cancelling a recurring session
  const [editScopeOpen, setEditScopeOpen] = useState(false);
  const [editScopeMode, setEditScopeMode] = useState<'edit' | 'cancel'>('edit');
  const [pendingRecurringSession, setPendingRecurringSession] = useState<SessionWithDetails | null>(
    null,
  );
  // Stores the chosen edit scope so the update handler can pass it to editRecurringSession
  const pendingEditScopeRef = useRef<EditScope | null>(null);

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

  // Fetch sessions when navigation changes the visible range.
  // We use `arg.view.currentStart` (the logical period start, e.g. May 1 for
  // month view) instead of `arg.start` (the grid start, which can fall in the
  // previous month for dayGridMonth). Using `arg.start` caused a feedback loop
  // with the useEffect sync that calls `api.gotoDate(currentDate)`, making
  // month view navigate to an earlier month on every datesSet fire.
  const handleDatesSet = useCallback(
    (arg: { start: Date; end: Date; view: { type: string; currentStart: Date } }) => {
      setCurrentDate(arg.view.currentStart);
      setCurrentView(arg.view.type as CalendarViewName);

      // Lazy-import the server action to fetch sessions for the new range.
      // Fire-and-forget — FullCalendar expects a void callback.
      // Note: arg.start/end covers the full visible range (including overflow
      // days from adjacent months in dayGridMonth), which is what we want for
      // data fetching.
      void import('@/app/(app)/agenda/actions').then(({ listSessions }) =>
        listSessions(arg.start, arg.end).then((result) => {
          if (result.ok) {
            setSessions(result.sessions);
          }
        }),
      );
    },
    [],
  );

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
    // arg.date is in browser-local time but represents Sao Paulo wall-clock
    // since we feed FullCalendar timezone-naive strings. Extract the time
    // as HH:mm (browser-local = Sao Paulo wall-clock) for the form picker,
    // and pass the date as-is — buildIsoDatetime in the form reads the
    // local components and converts via fromZonedTime.
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

  // Opens the edit form for a session. If the session is part of a recurrence,
  // shows the EditScopeDialog first; otherwise opens the form directly.
  const handleEditSession = useCallback(
    (session: SessionWithDetails) => {
      if (session.recurrenceId) {
        // Recurring session — show scope dialog before editing
        setPendingRecurringSession(session);
        setEditScopeMode('edit');
        setEditScopeOpen(true);
      } else {
        // Non-recurring — open edit form directly
        setEditingSession({
          id: session.id,
          patientId: session.patientId,
          patientName: session.patientName,
          isBlocking: session.isBlocking,
          blockingTitle: session.blockingTitle,
          startAt: new Date(session.startAt),
          durationMinutes: session.durationMinutes,
          locationId: session.locationId,
          modality: session.modality,
          amount: session.amount,
          notes: session.notes,
          color: session.color,
          remindersDisabled: session.remindersDisabled ?? false,
          patientPhone: session.patientPhone,
          patientWhatsappOptOut: session.patientWhatsappOptOut,
        });
        setSessionModalOpen(true);
        handleDrawerClose();
      }
    },
    [handleDrawerClose],
  );

  // Opens the cancel recurring dialog (EditScopeDialog with cancel title)
  const handleCancelRecurring = useCallback((session: SessionWithDetails) => {
    setPendingRecurringSession(session);
    setEditScopeMode('cancel');
    setEditScopeOpen(true);
  }, []);

  // Handles scope selection from EditScopeDialog
  const handleEditScopeSelect = useCallback(
    (scope: EditScope) => {
      if (!pendingRecurringSession) return;
      const session = pendingRecurringSession;

      setEditScopeOpen(false);

      if (editScopeMode === 'cancel') {
        // Cancel recurring session with selected scope
        void import('@/app/(app)/agenda/actions').then(({ cancelRecurringSession }) =>
          cancelRecurringSession({
            sessionId: session.id,
            scope,
          }).then((result) => {
            if (result.ok) {
              toast.success(`Recorrencia cancelada (${result.cancelledCount} sessao(es)).`);
              refreshSessions();
              handleDrawerClose();
            } else {
              const msg = 'message' in result ? result.message : 'Erro ao cancelar recorrencia.';
              toast.error(msg);
            }
            setPendingRecurringSession(null);
          }),
        );
      } else {
        // Edit recurring session — for "this" scope, detach and open form.
        // For "this_and_future" / "all", open the form with scope context.
        // The edit form will pass scope to editRecurringSession.
        setEditingSession({
          id: session.id,
          patientId: session.patientId,
          patientName: session.patientName,
          isBlocking: session.isBlocking,
          blockingTitle: session.blockingTitle,
          startAt: new Date(session.startAt),
          durationMinutes: session.durationMinutes,
          locationId: session.locationId,
          modality: session.modality,
          amount: session.amount,
          notes: session.notes,
          color: session.color,
          remindersDisabled: session.remindersDisabled ?? false,
          patientPhone: session.patientPhone,
          patientWhatsappOptOut: session.patientWhatsappOptOut,
        });
        // Store the selected scope so the update handler knows to use editRecurringSession
        pendingEditScopeRef.current = scope;
        setSessionModalOpen(true);
        handleDrawerClose();
        setPendingRecurringSession(null);
      }
    },
    [pendingRecurringSession, editScopeMode, refreshSessions, handleDrawerClose],
  );

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

      // Convert FullCalendar's browser-local date (Sao Paulo wall-clock)
      // to proper UTC so the reschedule dialog and server action work
      // correctly.
      const newStart = fcDateToUtc(info.event.start);
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
        onEdit={handleEditSession}
        onCancelRecurring={handleCancelRecurring}
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
        onCreateRecurring={async (input) => {
          const { createRecurringSession } = await import('@/app/(app)/agenda/actions');
          return createRecurringSession(input);
        }}
        onCreateCouple={async (input) => {
          const { createCoupleSession } = await import('@/app/(app)/agenda/actions');
          return createCoupleSession(input);
        }}
        onCreateLateRecord={async (input) => {
          const { createLateRecord } = await import('@/app/(app)/agenda/actions');
          return createLateRecord(input);
        }}
        onUpdate={async (id, input) => {
          const scope = pendingEditScopeRef.current;
          if (scope) {
            // Recurring session edit with scope — delegate to editRecurringSession
            pendingEditScopeRef.current = null;
            const { editRecurringSession } = await import('@/app/(app)/agenda/actions');
            const result = await editRecurringSession({
              sessionId: id,
              scope,
              updates: input,
            });
            // Map the result to match the expected shape of onUpdate
            if (result.ok) {
              return { ok: true };
            }
            if (result.error === 'invalid_input' && 'fieldErrors' in result) {
              return { ok: false, error: 'invalid_input', fieldErrors: result.fieldErrors };
            }
            return {
              ok: false,
              error: result.error,
              message: 'message' in result ? result.message : 'Erro ao editar sessao recorrente.',
            };
          }
          const { updateSession } = await import('@/app/(app)/agenda/actions');
          return updateSession(id, input);
        }}
        onSearchPatients={async (query) => {
          const { searchPatients } = await import('@/app/(app)/agenda/actions');
          return searchPatients(query);
        }}
        onSuccess={() => {
          pendingEditScopeRef.current = null;
          refreshSessions();
        }}
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

      <EditScopeDialog
        open={editScopeOpen}
        onOpenChange={(open) => {
          setEditScopeOpen(open);
          if (!open) {
            setTimeout(() => setPendingRecurringSession(null), 300);
          }
        }}
        onSelect={handleEditScopeSelect}
        title={
          editScopeMode === 'cancel' ? 'Cancelar sessao recorrente' : 'Editar sessao recorrente'
        }
        description={
          editScopeMode === 'cancel'
            ? 'Escolha o escopo do cancelamento para esta sessao recorrente.'
            : 'Escolha o escopo da alteracao para esta sessao recorrente.'
        }
      />
    </div>
  );
}
