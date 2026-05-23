'use client';

import Link from 'next/link';

import {
  AlertDialog,
  AlertDialogAction,
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

interface PostCallViewProps {
  patientId: string | null;
}

// ---------------------------------------------------------------------------
// Component
//
// Shown after the call ends (CallingState.LEFT). AlertDialog asks the
// psychologist whether to register the clinical evolution note now or later.
// ---------------------------------------------------------------------------

export function PostCallView({ patientId }: PostCallViewProps) {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sessao encerrada</AlertDialogTitle>
          <AlertDialogDescription>Deseja registrar a evolucao agora?</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Link href="/agenda">
            <AlertDialogAction
              className={buttonVariants({ variant: 'secondary' })}
              data-testid="post-call-later"
            >
              Depois
            </AlertDialogAction>
          </Link>

          {patientId ? (
            <Link href={`/pacientes/${patientId}/prontuario/evolucoes`}>
              <AlertDialogAction data-testid="post-call-register">
                Registrar evolucao
              </AlertDialogAction>
            </Link>
          ) : (
            <Link href="/agenda">
              <AlertDialogAction data-testid="post-call-register">
                Registrar evolucao
              </AlertDialogAction>
            </Link>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
