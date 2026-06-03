import { CalendarPlus, UserPlus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * `FirstStepsSlot` — the dashboard's zero-data empty state.
 *
 * Rendered by the dashboard page (in place of the four operational sections)
 * when the authenticated psychologist has no patients and no sessions yet, i.e.
 * `hasAnyData(...)` is false.
 *
 * This is a deliberate placeholder BOUNDARY: the richer first-run checklist /
 * guided tour ships in a later change (`onboarding-checklist-and-tour`) and
 * will replace this component's body. Until then the slot keeps the dashboard
 * shippable on its own by rendering a minimal Sálvia empty state with the two
 * primary "get started" CTAs (add a patient, schedule a session).
 *
 * Pure presentational Server Component — no props, no data access, no PII. The
 * two CTAs are plain `next/link` navigations to the existing creation surfaces,
 * so there is no open-redirect or client-trust surface here.
 */

export interface FirstStepsSlotProps {
  /** Where the "add patient" CTA points. Defaults to `/pacientes`. */
  newPatientHref?: string;
  /** Where the "schedule session" CTA points. Defaults to `/agenda`. */
  newSessionHref?: string;
}

export function FirstStepsSlot({
  newPatientHref = '/pacientes',
  newSessionHref = '/agenda',
}: FirstStepsSlotProps) {
  return (
    <Card data-testid="dashboard-first-steps">
      <CardHeader>
        <CardTitle>Comece por aqui</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-text-secondary text-sm" data-testid="dashboard-first-steps-intro">
          Bem-vindo(a) ao HubrityP. Para começar, adicione seu primeiro paciente ou agende uma
          sessão — seu painel se monta sozinho a partir daí.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button asChild className="min-h-11 justify-start">
            <Link href={newPatientHref} data-testid="dashboard-first-steps-new-patient">
              <UserPlus aria-hidden="true" />
              Adicionar primeiro paciente
            </Link>
          </Button>
          <Button asChild variant="secondary" className="min-h-11 justify-start">
            <Link href={newSessionHref} data-testid="dashboard-first-steps-new-session">
              <CalendarPlus aria-hidden="true" />
              Agendar primeira sessão
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
