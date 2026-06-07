'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import type { CreateEvolutionInput, EvolutionSummary } from '@/modules/medical-records/client';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import { ProntuarioCallContent } from './prontuario-call-content';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProntuarioCallDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  /** Recent evolutions pre-fetched for the patient. */
  recentEvolutions: EvolutionSummary[];
  /** Server Action: create a new evolution for this patient. */
  onCreateEvolution: (input: CreateEvolutionInput) => Promise<{ ok: boolean; id?: string }>;
  /** Server Action: update an existing evolution's content. */
  onUpdateEvolution: (input: {
    evolutionId: string;
    content: Record<string, unknown>;
  }) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Loading fallback for Suspense boundary
// ---------------------------------------------------------------------------

function ProntuarioLoading() {
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="prontuario-loading">
      <div className="bg-surface-muted h-4 w-3/4 animate-pulse rounded" />
      <div className="bg-surface-muted h-4 w-1/2 animate-pulse rounded" />
      <div className="bg-surface-muted h-20 w-full animate-pulse rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
//
// Side drawer (Sheet) for in-call prontuario access. Opens from the right,
// 480px on desktop, full-width on mobile. Psychologist-only — the toggle
// button in CallControlBar is hidden from patient view.
//
// Content is wrapped in a Suspense boundary. The actual prontuario data
// is passed as props (pre-fetched or loaded by parent) rather than
// fetched inside this component, keeping this a pure client component.
// ---------------------------------------------------------------------------

export function ProntuarioCallDrawer({
  open,
  onOpenChange,
  patientId,
  patientName,
  recentEvolutions,
  onCreateEvolution,
  onUpdateEvolution,
}: ProntuarioCallDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:w-[480px]"
        data-testid="prontuario-drawer"
      >
        <SheetHeader>
          <SheetTitle className="text-[16px] font-medium">Prontuário de {patientName}</SheetTitle>
          <SheetDescription className="sr-only">
            Prontuário clínico do paciente durante a sessão de vídeo
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto p-4">
          <Suspense fallback={<ProntuarioLoading />}>
            <ProntuarioCallContent
              patientId={patientId}
              recentEvolutions={recentEvolutions}
              onCreateEvolution={onCreateEvolution}
              onUpdateEvolution={onUpdateEvolution}
            />
          </Suspense>
        </div>

        {/* Footer link to full prontuario */}
        <div className="border-border border-t px-4 py-3">
          <Link
            href={`/pacientes/${patientId}/prontuario`}
            className="text-brand-700 hover:text-brand-800 inline-flex items-center gap-1.5 text-sm font-medium"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-full-prontuario-link"
          >
            Abrir prontuário completo
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
