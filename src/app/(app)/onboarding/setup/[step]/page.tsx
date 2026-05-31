import { notFound, redirect } from 'next/navigation';

import {
  isValidStep,
  resumeOnboardingStepImpl,
  StepProfile,
  WIZARD_STEPS,
  WizardProgress,
  type WizardStep,
} from '@/modules/onboarding';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';

import { saveProfileStep, uploadProfilePhoto } from './actions';

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

// Section headings per navigable step. `done` (the terminal summary screen) is
// built in a later section; until then it renders a neutral placeholder.
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
  // never client-supplied). A user may revisit an earlier/at step but cannot
  // jump ahead of where they actually are — requesting a later step bounces
  // back to the resume point.
  const resume = await resumeOnboardingStepImpl(supabase);
  if (!resume.ok) {
    redirect('/onboarding/pending');
  }

  const requestedIndex = WIZARD_STEPS.indexOf(step);
  const resumeIndex = WIZARD_STEPS.indexOf(resume.resumeStep);
  if (requestedIndex > resumeIndex) {
    redirect(`/onboarding/setup/${resume.resumeStep}`);
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-8">
      <div className="flex flex-col gap-4">
        <WizardProgress current={step} />
        <h1 className="text-text-primary text-2xl font-semibold" data-testid="setup-step-heading">
          {STEP_HEADINGS[step]}
        </h1>
      </div>

      {renderStep(step)}
    </div>
  );
}

/**
 * Renders the body for the given step. Only `profile` (step 1) is implemented
 * in this section; `location`, `patients`, and `done` get their components in
 * later sections and render a neutral placeholder for now.
 */
function renderStep(step: WizardStep) {
  if (step === 'profile') {
    return <StepProfile onSaveStep={saveProfileStep} onUploadPhoto={uploadProfilePhoto} />;
  }

  return (
    <p className="text-text-secondary text-base" data-testid="setup-step-placeholder">
      Esta etapa estará disponível em breve.
    </p>
  );
}
