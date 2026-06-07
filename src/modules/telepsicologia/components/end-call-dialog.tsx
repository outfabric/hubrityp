'use client';

import { useCall } from '@stream-io/video-react-sdk';
import { useCallback, useRef, useState } from 'react';

import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { buttonVariants } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EndCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  onEndSession: (roomId: string) => Promise<EndVideoSessionResult>;
}

// ---------------------------------------------------------------------------
// Component
//
// Confirmation dialog before ending the video session. On confirm, calls the
// endVideoSession Server Action (which updates DB and terminates the Stream
// call on the server), then leaves the call locally.
// ---------------------------------------------------------------------------

export function EndCallDialog({ open, onOpenChange, roomId, onEndSession }: EndCallDialogProps) {
  const call = useCall();
  const [isEnding, setIsEnding] = useState(false);

  // Guard against double-clicks while the async work is in progress
  const endingRef = useRef(false);

  const handleEnd = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    setIsEnding(true);

    void (async () => {
      try {
        await onEndSession(roomId);
        // Leave the call locally — this triggers CallingState.LEFT
        // which the parent CallStateRouter picks up to show PostCallView.
        await call?.leave();
      } catch {
        // Even if the server action fails, try to leave the call
        // so the user is not stuck in a broken state.
        try {
          await call?.leave();
        } catch {
          // Swallow — if we can't leave, the user can navigate away
        }
      } finally {
        setIsEnding(false);
        endingRef.current = false;
        onOpenChange(false);
      }
    })();
  }, [call, roomId, onEndSession, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Encerrar sessão?</AlertDialogTitle>
          <AlertDialogDescription>O paciente será desconectado.</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isEnding}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={handleEnd}
            disabled={isEnding}
            data-testid="confirm-end-call"
          >
            {isEnding ? 'Encerrando...' : 'Encerrar sessão'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
