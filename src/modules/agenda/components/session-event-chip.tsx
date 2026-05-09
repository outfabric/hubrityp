'use client';

import type { EventContentArg } from '@fullcalendar/core';
import { Building2, Lock, Video } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEventChipProps {
  eventInfo: EventContentArg;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModalityIcon(modality: string | null | undefined) {
  switch (modality) {
    case 'in_person':
      return (
        <Building2
          className="text-text-tertiary inline-block h-3 w-3 shrink-0"
          aria-label="Presencial"
        />
      );
    case 'online':
      return (
        <Video className="text-text-tertiary inline-block h-3 w-3 shrink-0" aria-label="Online" />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Custom event chip rendered inside FullCalendar via the `eventContent` prop.
 *
 * DS Salvia styling:
 * - Regular session: bg from session color or brand-100, text brand-700,
 *   patient name line 1, time range line 2, modality icon inline.
 * - Blocking slot: bg surface-muted, dashed border, Lock icon + title.
 * - Month view: compact pill with radius full, 22px height.
 */
export function SessionEventChip({ eventInfo }: SessionEventChipProps) {
  const { event, view } = eventInfo;
  const { isBlocking, blockingTitle, patientName, modality, color } = event.extendedProps as {
    isBlocking: boolean;
    blockingTitle: string | null;
    patientName: string | null;
    locationType: string | null;
    locationName: string | null;
    modality: string | null;
    status: string;
    color: string | null;
  };

  const isMonthView = view.type === 'dayGridMonth';

  // -- Month view: compact pill -----------------------------------------------
  if (isMonthView) {
    if (isBlocking) {
      return (
        <div
          className="bg-surface-muted border-border-strong flex h-[22px] items-center gap-1 truncate rounded-full border border-dashed px-2"
          data-testid="session-chip-blocking-month"
        >
          <Lock className="text-text-secondary h-3 w-3 shrink-0" />
          <span className="text-text-secondary truncate text-[12px] font-normal">
            {blockingTitle ?? 'Bloqueio'}
          </span>
        </div>
      );
    }

    return (
      <div
        className="flex h-[22px] items-center gap-1 truncate rounded-full px-2"
        style={{
          backgroundColor: color ? `${color}20` : undefined,
          color: color ?? undefined,
        }}
        data-testid="session-chip-month"
      >
        <span className="truncate text-[12px] font-medium">{patientName ?? 'Paciente'}</span>
        {getModalityIcon(modality)}
      </div>
    );
  }

  // -- Blocking slot (day/week view) ------------------------------------------
  if (isBlocking) {
    return (
      <div
        className="bg-surface-muted border-border-strong flex flex-col gap-0.5 rounded-sm border border-dashed p-1 px-2"
        data-testid="session-chip-blocking"
      >
        <div className="flex items-center gap-1">
          <Lock className="text-text-secondary h-3.5 w-3.5 shrink-0" />
          <span className="text-text-secondary truncate text-[13px] font-normal">
            {blockingTitle ?? 'Bloqueio'}
          </span>
        </div>
      </div>
    );
  }

  // -- Regular session (day/week view) ----------------------------------------
  return (
    <div
      className="flex flex-col gap-0.5 rounded-sm p-1 px-2"
      style={{
        backgroundColor: color ? `${color}20` : undefined,
        color: color ?? undefined,
      }}
      data-testid="session-chip"
    >
      <div className="flex items-center gap-1">
        <span className="truncate text-[13px] font-medium">{patientName ?? 'Paciente'}</span>
        {getModalityIcon(modality)}
      </div>
      <span className="text-text-secondary text-[12px] font-normal">{eventInfo.timeText}</span>
    </div>
  );
}
