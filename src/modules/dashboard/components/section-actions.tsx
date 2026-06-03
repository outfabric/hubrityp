'use client';

import { Calendar, Plus, Users } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Seção "Ações rápidas" — MVP shortcuts.
 *
 * Client Component: the two creation actions open the EXISTING quick-create
 * modals (patient / session) rather than reimplementing them. Those modal
 * instances are owned and rendered by the dashboard page (the composition
 * layer that already has the server data the modals require — locations,
 * patient options, etc.); this section receives `onNewPatient` / `onNewSession`
 * open handlers and is purely the trigger surface.
 *
 * "Ver agenda completa" and "Ver pacientes" are plain navigation links.
 * Every interactive element meets the 44×44px minimum touch target.
 */

export interface SectionActionsProps {
  /** Opens the existing patient quick-create modal (owned by the page). */
  onNewPatient: () => void;
  /** Opens the existing session quick-schedule modal (owned by the page). */
  onNewSession: () => void;
  /** Full-agenda link target. Defaults to `/agenda`. */
  agendaHref?: string;
  /** Patients-list link target. Defaults to `/pacientes`. */
  patientsHref?: string;
}

export function SectionActions({
  onNewPatient,
  onNewSession,
  agendaHref = '/agenda',
  patientsHref = '/pacientes',
}: SectionActionsProps) {
  return (
    <Card data-testid="dashboard-section-actions">
      <CardHeader>
        <CardTitle>Ações rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            type="button"
            onClick={onNewPatient}
            className="min-h-11 justify-start"
            data-testid="dashboard-actions-new-patient"
          >
            <Plus aria-hidden="true" />
            Novo paciente
          </Button>

          <Button
            type="button"
            onClick={onNewSession}
            className="min-h-11 justify-start"
            data-testid="dashboard-actions-new-session"
          >
            <Plus aria-hidden="true" />
            Nova sessão
          </Button>

          <Button asChild variant="secondary" className="min-h-11 justify-start">
            <Link href={agendaHref} data-testid="dashboard-actions-agenda">
              <Calendar aria-hidden="true" />
              Ver agenda completa
            </Link>
          </Button>

          <Button asChild variant="secondary" className="min-h-11 justify-start">
            <Link href={patientsHref} data-testid="dashboard-actions-patients">
              <Users aria-hidden="true" />
              Ver pacientes
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
