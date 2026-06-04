import { PartyPopper } from 'lucide-react';

/**
 * `ChecklistCelebration` — the discreet completion flourish shown once the
 * mandatory onboarding checklist reaches 100%.
 *
 * Pure presentational (no `'use client'`, no state, no data). The animation is
 * CSS-only: a single short fade-and-rise on mount (`onboarding-celebration` /
 * `onboarding-celebration-emphasis` keyframes in `globals.css`), bounded to
 * 300ms — the Sálvia design-system ceiling (`docs/design-system/rules.md`
 * §Animação forbids animations >300ms or bouncing). The keyframes are wrapped in
 * a `prefers-reduced-motion: reduce` guard that drops the duration to a
 * near-instant `0.01ms`, so users who opt out of motion see the message appear
 * without movement. No bouncing/scaling-overshoot: just opacity + a 4px rise.
 *
 * `aria-live="polite"` announces the completion to assistive tech without
 * stealing focus.
 */

export interface ChecklistCelebrationProps {
  /**
   * Whether the mandatory checklist is complete. The component renders nothing
   * when `false`, so callers can mount it unconditionally and let the flag drive
   * visibility (keeps the celebration a single source of truth).
   */
  readonly complete: boolean;
}

export function ChecklistCelebration({ complete }: ChecklistCelebrationProps) {
  if (!complete) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="onboarding-checklist-celebration"
      className="onboarding-celebration bg-success-50 mx-6 mb-4 flex items-center gap-2 rounded-lg px-4 py-3"
    >
      <PartyPopper
        aria-hidden="true"
        className="onboarding-celebration-emphasis text-success-700 shrink-0"
      />
      <p className="text-success-700 text-sm font-medium">
        Você completou a configuração inicial. Seu consultório está no sistema!
      </p>
    </div>
  );
}
