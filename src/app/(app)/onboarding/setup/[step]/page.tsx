import type { SupabaseClient } from '@supabase/supabase-js';
import { notFound, redirect } from 'next/navigation';

import { stampFirstAccess } from '@/modules/dashboard';
import {
  isValidStep,
  type OnboardingSummary,
  readOnboardingSummaryFromData,
  recomputeChecklistImpl,
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

  // Idempotent, fire-and-forget `first_access_at` stamp. Active psychologists
  // with incomplete onboarding are routed to the wizard BEFORE the dashboard, so
  // this setup render can be the true first authenticated destination — stamping
  // here (defensively, in addition to /onboarding/welcome) preserves the day-7
  // NPS anchor. The write only fires when `first_access_at IS NULL`; we never
  // `await` it so a slow write cannot delay the first paint, and failures are
  // swallowed (the next render retries) rather than crashing the wizard.
  void stampFirstAccess(supabase).catch(() => {});

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

  // The terminal `done` summary derives from AUTHORITATIVE DOMAIN DATA (the same
  // recompute source as the dashboard checklist), not the stored flags — so a
  // location/patient created outside the wizard is reflected here, in parity
  // with the panel (onboarding-wizard spec, "Step 4 summarizes from
  // authoritative domain data"). `auth.uid()` scopes every read; a brand-new
  // user with no data defaults to all-"missing" (non-blocking links), never a
  // crash.
  const summary = step === 'done' ? await readSummary(supabase) : null;

  // The patients step recognizes EXISTING patients as satisfying the step (no
  // double entry). We derive that from real data via the recompute — the same
  // source feeding the checklist — only when actually rendering step 3.
  const hasExistingPatients = step === 'patients' ? await readHasActivePatient(supabase) : false;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-8">
      <div className="flex flex-col gap-4">
        <WizardProgress current={step} />
        <h1 className="text-text-primary text-2xl font-semibold" data-testid="setup-step-heading">
          {STEP_HEADINGS[step]}
        </h1>
      </div>

      {renderStep(step, {
        hasSensitiveDataConsent: profile.sensitiveDataConsentAt != null,
        hasExistingPatients,
        defaultDisplayName: profile.fullName,
        summary,
      })}
    </div>
  );
}

/**
 * Reads the step-4 summary from authoritative domain data (the same recompute
 * source as the dashboard checklist), projected onto the three MVP summary
 * items. An unauthorized session → all items "missing" (non-blocking).
 */
async function readSummary(supabase: SupabaseClient): Promise<OnboardingSummary> {
  return readOnboardingSummaryFromData(supabase);
}

/**
 * Whether the owner already has >= 1 active patient, derived from real data via
 * the shared recompute (single source of truth with the dashboard checklist).
 * On an unauthorized session it returns `false` so the step renders its default
 * (empty) variant rather than crashing.
 */
async function readHasActivePatient(supabase: SupabaseClient): Promise<boolean> {
  const recompute = await recomputeChecklistImpl(supabase);
  return recompute.ok ? recompute.state.primeiro_paciente : false;
}

interface RenderStepOptions {
  /** Whether the owner accepted the LGPD sensitive-data consent term (step 3). */
  hasSensitiveDataConsent: boolean;
  /** Whether the owner already has >= 1 active patient (step 3 recognition). */
  hasExistingPatients: boolean;
  /** The owner's current `profiles.full_name`, pre-filled into step 1. */
  defaultDisplayName: string;
  /** The owner's data-derived summary, non-null only for the `done` step. */
  summary: OnboardingSummary | null;
}

/**
 * Renders the body for the given step. `profile` (step 1), `location` (step 2),
 * `patients` (step 3), and the terminal `done` summary (step 4) are all
 * implemented.
 *
 * `hasSensitiveDataConsent` controls whether the step-3 CSV upload is enabled
 * (RN-11.03); the server gate in `importOnboardingPatients` enforces it
 * regardless of this UI flag. `hasExistingPatients` lets step 3 recognize
 * already-registered patients and advance without re-adding. `defaultDisplayName`
 * pre-fills step 1 from the owner's current `full_name`. `summary` is non-null
 * only for the `done` step (where it drives the check vs. "Configurar agora").
 */
function renderStep(step: WizardStep, options: RenderStepOptions) {
  const { hasSensitiveDataConsent, hasExistingPatients, defaultDisplayName, summary } = options;

  if (step === 'profile') {
    return (
      <StepProfile
        defaultDisplayName={defaultDisplayName}
        onSaveStep={saveProfileStep}
        onUploadPhoto={uploadProfilePhoto}
      />
    );
  }

  if (step === 'location') {
    return <StepLocation onCreateLocation={createOnboardingLocation} />;
  }

  if (step === 'patients') {
    return (
      <StepPatients
        hasSensitiveDataConsent={hasSensitiveDataConsent}
        hasExistingPatients={hasExistingPatients}
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
