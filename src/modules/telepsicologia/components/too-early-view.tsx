'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock } from 'lucide-react';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { DeviceTest } from './device-test';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TooEarlyViewProps {
  psychologistName: string | null;
  psychologistPhotoUrl: string | null;
  /** ISO 8601 string from the API response. */
  sessionStartAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract up to two initials from a name (e.g. "Maria Silva" -> "MS"). */
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

// ---------------------------------------------------------------------------
// Component
//
// Shown when the patient arrives before the room's available_from window.
// Centered card with psychologist avatar, session time, and an optional
// inline device test.
//
// Design: max-w 480px, centered, brand-100 avatar fallback with initials.
// ---------------------------------------------------------------------------

export function TooEarlyView({
  psychologistName,
  psychologistPhotoUrl,
  sessionStartAt,
}: TooEarlyViewProps) {
  const [showDeviceTest, setShowDeviceTest] = useState(false);

  const displayName = psychologistName ?? 'Psicologo';
  const startDate = new Date(sessionStartAt);

  // Format: "23 de maio de 2026 as 14:30"
  const formattedDate = format(startDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const formattedTime = format(startDate, 'HH:mm', { locale: ptBR });

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="items-center text-center">
          {/* Psychologist avatar */}
          <Avatar className="mb-2 h-14 w-14">
            {psychologistPhotoUrl && (
              <AvatarImage src={psychologistPhotoUrl} alt={`Foto de ${displayName}`} />
            )}
            <AvatarFallback className="bg-brand-100 text-brand-700 text-lg">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>

          <CardTitle>{displayName}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 text-center">
          {/* Session time */}
          <div className="flex items-center justify-center gap-2">
            <Clock className="text-text-tertiary h-4 w-4" aria-hidden="true" />
            <p className="text-text-secondary text-[15px]">
              {formattedDate} as {formattedTime}
            </p>
          </div>

          <p className="text-text-secondary text-[15px]">
            Sua sessao ainda nao esta disponivel. Volte 10 minutos antes do horario agendado.
          </p>

          {/* Device test toggle */}
          {!showDeviceTest ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeviceTest(true)}
              aria-label="Testar camera e microfone"
            >
              Testar camera e microfone
            </Button>
          ) : (
            <div className="pt-2">
              <DeviceTest />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
