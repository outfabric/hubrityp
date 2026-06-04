'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

import type { SubmitNpsResult } from '../server/submit-nps';

import { NpsForm } from './nps-form';

export interface NpsModalProps {
  /**
   * Server-computed eligibility, derived from the profile's `first_access_at`
   * and `nps_responded_at` (see `isEligibleForNps`). The modal is shown at most
   * once: it opens only when this prop is true on initial render, and it never
   * re-opens automatically — closing it (by answering or deferring) keeps it
   * closed for the rest of the session, and a fresh navigation re-evaluates
   * eligibility server-side (which is now false because the answer/dismissal
   * stamped `nps_responded_at`). Client storage is NEVER the source of truth.
   */
  isEligible: boolean;
  /**
   * Persists an NPS answer. Server Action wrapper supplied by the parent — the
   * modal is a pure client leaf and never calls the action directly.
   */
  onSubmit: (input: { score: number; feedback?: string }) => Promise<SubmitNpsResult>;
  /**
   * Stamps `nps_responded_at` without a score so the survey stops reappearing;
   * the answer stays available later in Configurações > Feedback. Server Action
   * wrapper supplied by the parent.
   */
  onDismiss: () => Promise<SubmitNpsResult>;
}

/**
 * Day-7 NPS survey modal.
 *
 * Shown once when `isEligible` is true. The visibility is seeded from the
 * server-computed prop and then owned locally so the modal can close on
 * answer/dismissal within the same render without flickering back open — the
 * "show at most once" guarantee ultimately rests on the server stamping
 * `nps_responded_at`, which makes the next eligibility check false.
 *
 * "Não responder agora" defers: it fires the dismissal action and closes the
 * modal. Answering closes it after a successful write. In both cases the modal
 * does not reappear automatically.
 *
 * Design System Sálvia:
 *   - Dialog primitive (radius 2xl, padding space-8 desktop / space-6 mobile,
 *     close X top-right, Escape closes, click-outside closes).
 *   - Title h3 (18px/600); description in text-secondary.
 */
export function NpsModal({ isEligible, onSubmit, onDismiss }: NpsModalProps) {
  const [open, setOpen] = useState(isEligible);
  const [dismissPending, setDismissPending] = useState(false);

  function handleDismiss() {
    setDismissPending(true);
    // Fire-and-forget from the user's perspective: close immediately so the
    // survey does not linger. The dismissal write is what guarantees it won't
    // reappear on the next navigation; a transport failure is non-blocking and
    // simply means the user may see it once more.
    void onDismiss().finally(() => setDismissPending(false));
    setOpen(false);
  }

  // Radix-driven close (Escape / click-outside / X). Treat any non-answer close
  // as a deferral so eligibility is persisted server-side and the modal does
  // not pop back on the next eligible render.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && open) {
      handleDismiss();
      return;
    }
    setOpen(nextOpen);
  }

  if (!isEligible) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="nps-modal">
        <DialogHeader>
          <DialogTitle>Sua opinião</DialogTitle>
          <DialogDescription>
            Leva menos de um minuto e ajuda a melhorar o sistema.
          </DialogDescription>
        </DialogHeader>

        <NpsForm
          onSubmit={onSubmit}
          onDismiss={handleDismiss}
          dismissPending={dismissPending}
          onSubmitted={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
