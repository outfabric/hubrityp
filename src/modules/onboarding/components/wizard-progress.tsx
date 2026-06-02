import { cn } from '@/shared/lib/utils';

import { WIZARD_STEPS, type WizardStep } from '../lib/wizard';

/**
 * "Passo N de 4" progress indicator for the onboarding wizard.
 *
 * Pure presentational Server Component (no hooks/events) — it derives the
 * 1-based position of `current` within {@link WIZARD_STEPS} and renders a
 * caption-upper eyebrow plus a neutral segmented track per the Sálvia design
 * system (neutral surfaces only; brand is reserved for the active fill).
 *
 * The total shown is the count of MVP wizard steps (4), including the terminal
 * `done` step, matching the product copy "Passo N de 4".
 */
export interface WizardProgressProps {
  /** The step segment currently being rendered. */
  current: WizardStep;
  className?: string;
}

const TOTAL_STEPS = WIZARD_STEPS.length;

export function WizardProgress({ current, className }: WizardProgressProps) {
  // 1-based position. `current` is always a member of WIZARD_STEPS (the route
  // validates it via `isValidStep` before this renders), so indexOf is >= 0.
  const position = WIZARD_STEPS.indexOf(current) + 1;

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="wizard-progress">
      <p className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
        Passo {position} de {TOTAL_STEPS}
      </p>
      <ol className="flex items-center gap-2" aria-hidden="true">
        {WIZARD_STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              'duration-fast h-1.5 flex-1 rounded-full transition-colors',
              index < position ? 'bg-brand-500' : 'bg-surface-sunken',
            )}
          />
        ))}
      </ol>
    </div>
  );
}
