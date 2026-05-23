'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { createVideoRoom } from './actions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateRoomCardProps {
  sessionId: string;
  patientName: string | null;
}

// ---------------------------------------------------------------------------
// Component
//
// Displayed when the psychologist navigates to the video page but no room
// has been created yet. Calls the createVideoRoom Server Action and
// refreshes the page to load the room.
// ---------------------------------------------------------------------------

export function CreateRoomCard({ sessionId, patientName }: CreateRoomCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createVideoRoom(sessionId);
      if (result.ok) {
        // Refresh the current page to re-run the Server Component with the
        // new room data, which will render VideoCallClient.
        router.refresh();
      }
    });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sala nao criada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-text-secondary text-sm">
            {patientName
              ? `A sala de video para a sessao com ${patientName} ainda nao foi criada.`
              : 'A sala de video para esta sessao ainda nao foi criada.'}
          </p>
          <Button
            onClick={handleCreate}
            disabled={isPending}
            className="w-full"
            data-testid="create-video-room-button"
          >
            {isPending ? 'Criando sala...' : 'Criar sala de video'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
