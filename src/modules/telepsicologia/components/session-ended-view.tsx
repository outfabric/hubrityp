'use client';

import { CheckCircle2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionEndedViewProps {
  psychologistName: string | null;
}

// ---------------------------------------------------------------------------
// Component
//
// Terminal state shown after the session ends (psychologist ends the call,
// room expires, or the token resolves to an ended status).
//
// Design: centered card (max-w 480px), no action buttons.
// ---------------------------------------------------------------------------

export function SessionEndedView({ psychologistName }: SessionEndedViewProps) {
  const displayName = psychologistName ?? 'seu psicologo';

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="items-center text-center">
          <div
            className="bg-brand-100 mb-2 flex h-12 w-12 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <CheckCircle2 className="text-brand-600 h-6 w-6" />
          </div>
          <CardTitle>Sessao encerrada</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-text-secondary text-[15px]">
            Se precisar reagendar, entre em contato com {displayName}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
