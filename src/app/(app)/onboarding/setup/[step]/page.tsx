import type { SupabaseClient } from '@supabase/supabase-js';
import { notFound, redirect } from 'next/navigation';

import {
  isValidStep,
  type OnboardingSummary,
  readOnboardingChecklistSummary,
  resumeOnboardingStepImpl,
  StepDone,
  StepLocation,
  StepPatients,
  StepProfile,
  WIZARD_STEPS,
  WizardProgress,
  type WizardStep,
} from '@/modules/onboarding';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';

import {
  completeOnboarding,
  createOnboardingLocation,
  importOnboardingPatients,
  quickAddOnboardingPatient,
  saveProfileStep,
  skipPatientsStep,
  uploadProfilePhoto,
} from './actions';

// `/onboarding/setup/[step]` — the four-step MVP setup wizard.
//
// Gating: `middleware.ts:classifyPath()` maps `/onboarding/setup*` to the 'app'
// (gated) class, so anonymous requests are redirected to
// `/login?redirectTo=...` and non-`active` profiles are bounced to
// `/onboarding/pending` BEFORE this Server Component renders. The guards below
// are defense-in-depth, mirroring the middleware so a future bypass cannot leak
// a partial UI.
//
// The wizard MUST NOT mention post-MVP modules (WhatsApp, Receita Saúde,
// cobrança/PIX, recibos) — see the onboarding-wizard spec.

interface SetupStepPageProps {
  params: Promise<{ step: string }>;
}

// Section headings per navigable step.
const STEP_HEADINGS: Record<WizardStep, string> = {
  profile: 'Sobre você',
  location: 'Local e agenda',
  patients: 'Importe pacientes',
  done: 'Tudo pronto',
};

export default async function SetupStepPage({ params }: SetupStepPageProps) {
  const { step } = await params;

  // 1. Validate the `[step]` segment against the allowlist. Anything that is
  // not a navigable wizard step (e.g. `welcome`, `billing`, typos) is a 404 —
  // never a blank page.
  if (!isValidStep(step)) {
    notFound();
  }

  // 2. Defense-in-depth auth/status guards (middleware is the first line).
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  if (profile.status !== ProfileStatus.Active) {
    redirect('/onboarding/pending');
  }

  // 3. Resolve the resume point from the OWNER'S persisted state (server-side,
  // never client-supplied). The persisted `onboarding_step` already points at
  // the step the user should be on NEXT (each completed step advances it), so
  // the only navigable step is the resume point itself: requesting a LATER
  // step (jumping ahead) OR an EARLIER step (redoing prior progress) both
  // bounce to the resume point. This matches the onboarding-wizard spec
  // ("…with a step earlier than their saved progress, they SHALL be routed to
  // their saved resume point") and keeps the flow strictly forward.
  const resume = await resumeOnboardingStepImpl(supabase);
  if (!resume.ok) {
    redirect('/onboarding/pending');
  }

  const requestedIndex = WIZARD_STEPS.indexOf(step);
  const resumeIndex = WIZARD_STEPS.indexOf(resume.resumeStep);
  if (requestedIndex !== resumeIndex) {
    redirect(`/onboarding/setup/${resume.resumeStep}`);
  }

  // The terminal `done` summary reads the OWNER'S checklist server-side through
  // the request's RLS-scoped Supabase client — `auth.uid()` is the only thing
  // that can widen the result, so another user's row can never be returned. A
  // brand-new user may have no row yet → all items default to "missing"
  // (non-blocking links), never a crash.
  const summary = step === 'done' ? await readSummary(supabase) : null;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-8">
      <div className="flex flex-col gap-4">
        <WizardProgress current={step} />
        <h1 className="text-text-primary text-2xl font-semibold" data-testid="setup-step-heading">
          {STEP_HEADINGS[step]}
        </h1>
      </div>

      {renderStep(step, profile.sensitiveDataConsentAt != null, summary)}
    </div>
  );
}

/**
 * Reads the owner's onboarding checklist through the RLS-scoped Supabase client
 * and projects it onto the three MVP summary items shown on step 4. Missing row
 * (or a read error) → all items "missing" (non-blocking).
 */
async function readSummary(supabase: SupabaseClient): Promise<OnboardingSummary> {
  return readOnboardingChecklistSummary(supabase);
}

/**
 * Renders the body for the given step. `profile` (step 1), `location` (step 2),
 * `patients` (step 3), and the terminal `done` summary (step 4) are all
 * implemented.
 *
 * `hasSensitiveDataConsent` is read server-side from the owner's profile and
 * controls whether the step-3 CSV upload is enabled (RN-11.03). The server gate
 * in `importOnboardingPatients` enforces it regardless of this UI flag.
 *
 * `summary` is the owner's checklist projection, non-null only for the `done`
 * step (where it drives the check vs. "Configurar agora" rendering).
 */
function renderStep(
  step: WizardStep,
  hasSensitiveDataConsent: boolean,
  summary: OnboardingSummary | null,
) {
  if (step === 'profile') {
    return <StepProfile onSaveStep={saveProfileStep} onUploadPhoto={uploadProfilePhoto} />;
  }

  if (step === 'location') {
    return <StepLocation onCreateLocation={createOnboardingLocation} />;
  }

  if (step === 'patients') {
    return (
      <StepPatients
        hasSensitiveDataConsent={hasSensitiveDataConsent}
        onImportCsv={importOnboardingPatients}
        onQuickAdd={quickAddOnboardingPatient}
        onSkip={skipPatientsStep}
      />
    );
  }

  // step === 'done' — `summary` is guaranteed non-null for this branch (the page
  // reads it whenever `step === 'done'`); fall back to all-missing defensively.
  return (
    <StepDone
      summary={
        summary ?? { profileCompleted: false, locationConfigured: false, firstPatientAdded: false }
      }
      onComplete={completeOnboarding}
    />
  );
}
