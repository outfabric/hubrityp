'use client';

import type FullCalendar from '@fullcalendar/react';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { type RefObject, useCallback, useMemo } from 'react';

import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalendarViewName = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

interface AgendaNavBarProps {
  currentDate: Date;
  currentView: CalendarViewName;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarViewName) => void;
  calendarRef: RefObject<FullCalendar | null>;
}

// ---------------------------------------------------------------------------
// View ↔ tab mapping
// ---------------------------------------------------------------------------

const VIEW_TO_TAB: Record<CalendarViewName, string> = {
  timeGridDay: 'day',
  timeGridWeek: 'week',
  dayGridMonth: 'month',
};

const TAB_TO_VIEW: Record<string, CalendarViewName> = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
};

// ---------------------------------------------------------------------------
// Period title formatter
// ---------------------------------------------------------------------------

function formatPeriodTitle(date: Date, view: CalendarViewName): string {
  switch (view) {
    case 'timeGridDay': {
      // "Quinta, 15 mai. 2026"
      const dayName = format(date, 'EEEE', { locale: ptBR });
      const capitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return `${capitalized}, ${format(date, "d MMM'.' yyyy", { locale: ptBR })}`;
    }

    case 'timeGridWeek': {
      // "Semana de 11 - 17 mai. 2026"
      const weekS = startOfWeek(date, { weekStartsOn: 0 });
      const weekE = endOfWeek(date, { weekStartsOn: 0 });
      const startDay = format(weekS, 'd', { locale: ptBR });
      const endStr = format(weekE, "d MMM'.' yyyy", { locale: ptBR });
      return `Semana de ${startDay} - ${endStr}`;
    }

    case 'dayGridMonth': {
      // "Maio 2026"
      const monthStr = format(date, 'MMMM yyyy', { locale: ptBR });
      return monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
    }

    default:
      return format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgendaNavBar({
  currentDate,
  currentView,
  onDateChange,
  onViewChange,
  calendarRef,
}: AgendaNavBarProps) {
  const periodTitle = useMemo(
    () => formatPeriodTitle(currentDate, currentView),
    [currentDate, currentView],
  );

  const navigatePrev = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (api) {
      api.prev();
      return;
    }

    // Fallback without API
    switch (currentView) {
      case 'timeGridDay':
        onDateChange(subDays(currentDate, 1));
        break;
      case 'timeGridWeek':
        onDateChange(subWeeks(currentDate, 1));
        break;
      case 'dayGridMonth':
        onDateChange(subMonths(currentDate, 1));
        break;
    }
  }, [calendarRef, currentDate, currentView, onDateChange]);

  const navigateNext = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (api) {
      api.next();
      return;
    }

    switch (currentView) {
      case 'timeGridDay':
        onDateChange(addDays(currentDate, 1));
        break;
      case 'timeGridWeek':
        onDateChange(addWeeks(currentDate, 1));
        break;
      case 'dayGridMonth':
        onDateChange(addMonths(currentDate, 1));
        break;
    }
  }, [calendarRef, currentDate, currentView, onDateChange]);

  const navigateToday = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (api) {
      api.today();
      return;
    }
    onDateChange(new Date());
  }, [calendarRef, onDateChange]);

  const handleViewChange = useCallback(
    (tabValue: string) => {
      const view = TAB_TO_VIEW[tabValue];
      if (!view) return;

      const api = calendarRef.current?.getApi();
      if (api) {
        api.changeView(view);
      }
      onViewChange(view);
    },
    [calendarRef, onViewChange],
  );

  const handleDatePickerSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;

      const api = calendarRef.current?.getApi();
      if (api) {
        api.gotoDate(date);
      }
      onDateChange(date);
    },
    [calendarRef, onDateChange],
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* Left side: navigation controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={navigatePrev}
            aria-label="Período anterior"
            data-testid="agenda-nav-prev"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={navigateNext}
            aria-label="Próximo período"
            data-testid="agenda-nav-next"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <Button variant="secondary" onClick={navigateToday} data-testid="agenda-nav-today">
          Hoje
        </Button>

        <h2
          className="text-text-primary text-[22px] leading-[1.25] font-semibold"
          data-testid="agenda-period-title"
        >
          {periodTitle}
        </h2>

        {/* Date picker popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Selecionar data"
              data-testid="agenda-date-picker-trigger"
            >
              <CalendarIcon className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={currentDate}
              onSelect={handleDatePickerSelect}
              defaultMonth={currentDate}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Right side: view toggle */}
      <Tabs
        value={VIEW_TO_TAB[currentView]}
        onValueChange={handleViewChange}
        data-testid="agenda-view-toggle"
      >
        <TabsList>
          <TabsTrigger value="day">Dia</TabsTrigger>
          <TabsTrigger value="week">Semana</TabsTrigger>
          <TabsTrigger value="month">Mês</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
