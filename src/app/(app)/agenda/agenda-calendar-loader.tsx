'use client';

import dynamic from 'next/dynamic';

import type { AgendaCalendarProps } from '@/modules/agenda/components/agenda-calendar';

/**
 * Thin client-boundary wrapper that dynamic-imports the FullCalendar-based
 * AgendaCalendar component with SSR disabled. FullCalendar relies heavily on
 * browser APIs (DOM measurement, ResizeObserver) and cannot render on the
 * server. Using `next/dynamic` keeps the heavy FullCalendar bundle out of
 * pages that do not use the agenda.
 */
const AgendaCalendar = dynamic(
  () => import('@/modules/agenda/components/agenda-calendar').then((mod) => mod.AgendaCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    ),
  },
);

export function AgendaCalendarLoader(props: AgendaCalendarProps) {
  return <AgendaCalendar {...props} />;
}
