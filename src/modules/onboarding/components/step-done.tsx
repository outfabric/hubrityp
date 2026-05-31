'use client';

import { ArrowRight, Calendar, Check, MessageCircle, Receipt, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Action result shape (mirrors the module impl's sanitized result)
// ---------------------------------------------------------------------------

export type CompleteOnboardingStepResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

/**
 * Read-only summary of the three MVP setup items. Each flag is derived
 * SERVER-side from the owner's `onboarding_checklist` row (never from client
 * state) and passed in as a prop. A `true` flag renders a check; a `false`
 * (missing) flag renders a non-blocking "Configurar agora" link.
 */
export interface OnboardingSummary {
  /** `onboarding_checklist.profile_completed`. */
  profileCompleted: boolean;
  /** `onboarding_checklist.location_configured`. */
  locationConfigured: boolean;
  /** `onboarding_checklist.first_patient_added`. */
  firstPatientAdded: boolean;
}

export interface StepDoneProps {
  /** The owner's setup summary, read server-side from the checklist row. */
  summary: OnboardingSummary;
  /**
   * Marks onboarding complete. Stamps `onboarding_completed_at = now()` and
   * sets `onboarding_step = 'done'` server-side, authorized by `auth.uid()`
   * only (no client input). Both CTAs call this before navigating.
   */
  onComplete: () => Promise<CompleteOnboardingStepResult>;
}

// ---------------------------------------------------------------------------
// Summary item model
// ---------------------------------------------------------------------------

/**
 * One row in the summary. `configureHref` is where a STILL-MISSING item sends
 * the user to finish setup (non-blocking — the CTAs stay enabled regardless).
 */
interface SummaryItem {
  key: 'profile' | 'location' | 'patients';
  label: string;
  done: boolean;
  configureHref: string;
}

/**
 * "O que vem em breve" — purely informational. These post-MVP modules are
 * listed as text only: NO links, NO buttons, NO enablement. The wizard never
 * activates WhatsApp / PIX / Receita Saúde from this screen (spec RN). Icons
 * are decorative.
 */
const COMING_SOON: ReadonlyArray<{ icon: typeof MessageCircle; label: string }> = [
  { icon: MessageCircle, label: 'Lembretes automáticos por WhatsApp' },
  { icon: Wallet, label: 'Cobrança via PIX' },
  { icon: Receipt, label: 'Emitir Receita Saúde' },
] as const;

/**
 * Wizard step 4 — "Pronto".
 *
 * Read-only completion summary. Renders a check per configured item and a
 * non-blocking "Configurar agora" link per missing item. The primary CTA
 * ("Ver minha agenda" → `/agenda`) and the secondary CTA ("Ir para o
 * dashboard" → `/dashboard`) BOTH call {@link StepDoneProps.onComplete} (which
 * stamps `onboarding_completed_at`) before navigating. The "O que vem em breve"
 * section lists post-MVP modules as informational text only — it enables
 * nothing.
 */
export function StepDone({ summary, onComplete }: StepDoneProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const items: SummaryItem[] = [
    {
      key: 'profile',
      label: 'Seu perfil',
      done: summary.profileCompleted,
      configureHref: '/onboarding/setup/profile',
    },
    {
      key: 'location',
      label: 'Local e agenda',
      done: summary.locationConfigured,
      configureHref: '/onboarding/setup/location',
    },
    {
      key: 'patients',
      label: 'Seus pacientes',
      done: summary.firstPatientAdded,
      configureHref: '/onboarding/setup/patients',
    },
  ];

  /**
   * Runs `onComplete`, then navigates to `destination` on success. On failure
   * we surface a human toast and stay put so the user can retry. The
   * destination is chosen by the CTA, never by the server, and never feeds the
   * completion authorization.
   */
  function completeThen(destination: '/agenda' | '/dashboard') {
    startTransition(async () => {
      const result = await onComplete();
      if (!result.ok) {
        toast.error('Não foi possível concluir agora. Tente novamente.');
        return;
      }
      router.push(destination);
    });
  }

  return (
    <div className="flex flex-col gap-8" data-testid="step-done">
      <p className="text-text-secondary text-base">
        Tudo pronto para começar. Veja o que você já configurou — você pode ajustar o que faltar a
        qualquer momento.
      </p>

      {/* Setup summary — check per configured item, "Configurar agora" per missing item */}
      <ul className="flex flex-col gap-3" data-testid="step-done-summary">
        {items.map((item) => (
          <li
            key={item.key}
            className="border-border bg-surface flex items-center justify-between gap-4 rounded-xl border p-4"
            data-testid={`step-done-item-${item.key}`}
          >
            <div className="flex items-center gap-3">
              {item.done ? (
                <span
                  className="bg-success-50 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  data-testid={`step-done-item-${item.key}-check`}
                >
                  <Check className="text-success-700 h-4 w-4" aria-label="Configurado" />
                </span>
              ) : (
                <span
                  className="bg-surface-muted h-7 w-7 shrink-0 rounded-full"
                  aria-hidden="true"
                />
              )}
              <span className="text-text-primary text-base font-medium">{item.label}</span>
            </div>

            {item.done ? null : (
              <Button
                asChild
                variant="link"
                size="sm"
                data-testid={`step-done-item-${item.key}-configure`}
              >
                <a href={item.configureHref}>Configurar agora</a>
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* "O que vem em breve" — informational only, NOTHING is actionable here */}
      <Card
        className="border-border-subtle flex flex-col gap-3 p-6"
        data-testid="step-done-coming-soon"
      >
        <p className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
          O que vem em breve
        </p>
        <ul className="flex flex-col gap-2">
          {COMING_SOON.map((feature) => (
            <li key={feature.label} className="text-text-secondary flex items-center gap-2 text-sm">
              <feature.icon className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />
              {feature.label}
            </li>
          ))}
        </ul>
      </Card>

      {/* CTAs — both stamp completion before navigating */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          size="lg"
          onClick={() => completeThen('/agenda')}
          disabled={isPending}
          data-testid="step-done-cta-agenda"
        >
          <Calendar className="h-5 w-5" aria-hidden="true" />
          {isPending ? 'Concluindo...' : 'Ver minha agenda'}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="lg"
          variant="secondary"
          onClick={() => completeThen('/dashboard')}
          disabled={isPending}
          data-testid="step-done-cta-dashboard"
        >
          Ir para o dashboard
        </Button>
      </div>
    </div>
  );
}
