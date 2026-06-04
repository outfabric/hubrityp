'use client';

import { PlayCircle } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';

/**
 * "Refazer tour" control — restarts the guided product tour regardless of
 * whether the user has already completed it.
 *
 * The tour leaf (`DashboardTour`) only lives on `/dashboard`, so this control
 * (rendered under Configurações → Ajuda) cannot start the tour in place. It
 * instead navigates to `/dashboard?tour=replay`; the dashboard's tour leaf reads
 * that flag on mount and force-starts the tour past the `tour_completed_at`
 * gate. A plain `<Link>` keeps this working without client JavaScript.
 */
export function ReplayTourButton() {
  return (
    <Button asChild variant="secondary" className="min-h-11 self-start">
      <Link href="/dashboard?tour=replay" data-testid="ajuda-refazer-tour">
        <PlayCircle aria-hidden="true" />
        Refazer tour
      </Link>
    </Button>
  );
}
