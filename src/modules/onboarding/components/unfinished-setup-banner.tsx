import { Info } from 'lucide-react';
import Link from 'next/link';

import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

import type { OnboardingStep } from '../lib/branded';
import { resumeStepFromOnboardingStep } from '../lib/wizard';

/**
 * Props for {@link UnfinishedSetupBanner}.
 *
 * Both values are read server-side from the authenticated psychologist's own
 * `profiles` row (the app shell layout). The component is presentational and
 * makes no authorization decision — it only decides whether to render and where
 * the "continuar" link points, both derived from server-authoritative state.
 */
export interface UnfinishedSetupBannerProps {
  /** The owner's persisted `profiles.onboarding_step`. */
  onboardingStep: OnboardingStep;
  /**
   * The owner's persisted `profiles.onboarding_completed_at`. `null` means the
   * flow was neither completed nor skipped to `done`; a non-null value (any
   * `Date`) hides the banner.
   */
  onboardingCompletedAt: Date | null;
}

/**
 * Non-blocking banner shown at the top of authenticated app pages while the
 * psychologist has not finished the guided initial setup.
 *
 * Visibility rule (server-authoritative): render only when
 * `onboardingCompletedAt IS NULL` AND `onboardingStep !== 'done'`. Once the user
 * completes onboarding (timestamp stamped) or skips it to `'done'`, the banner
 * disappears. Returns `null` in every other case so it can be placed
 * unconditionally in the `(app)` layout without affecting the DOM.
 *
 * The "continuar" link resolves to the resume segment derived from the
 * persisted `onboarding_step` via {@link resumeStepFromOnboardingStep} — never
 * from client state.
 *
 * Uses the design-system `info` Alert variant (info-50 tinted surface + border,
 * no brand background) per `docs/design-system/rules.md`.
 */
export function UnfinishedSetupBanner({
  onboardingStep,
  onboardingCompletedAt,
}: UnfinishedSetupBannerProps) {
  if (onboardingCompletedAt !== null) return null;
  if (onboardingStep === 'done') return null;

  const resumeStep = resumeStepFromOnboardingStep(onboardingStep);

  return (
    <Alert variant="info" role="alert" aria-live="polite" data-testid="unfinished-setup-banner">
      <Info className="h-5 w-5" aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>Você ainda não terminou a configuração inicial.</span>
        <Button variant="link" size="sm" asChild className="text-info-700 shrink-0">
          <Link href={`/onboarding/setup/${resumeStep}`} data-testid="unfinished-setup-banner-link">
            continuar
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
