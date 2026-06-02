import { describe, expect, it } from 'vitest';

import type { OnboardingStep } from '@/modules/onboarding';
import {
  WIZARD_STEPS,
  isValidStep,
  nextStep,
  profileStepSchema,
  resumeStepFromOnboardingStep,
  type WizardStep,
} from '@/modules/onboarding';

describe('WIZARD_STEPS', () => {
  it('lists the four MVP steps in order', () => {
    expect(WIZARD_STEPS).toEqual(['profile', 'location', 'patients', 'done']);
  });
});

describe('nextStep', () => {
  it('advances profile → location → patients → done', () => {
    expect(nextStep('profile')).toBe('location');
    expect(nextStep('location')).toBe('patients');
    expect(nextStep('patients')).toBe('done');
  });

  it('returns null at the terminal step (done)', () => {
    expect(nextStep('done')).toBeNull();
  });
});

describe('isValidStep', () => {
  it.each(WIZARD_STEPS)('accepts the wizard step %s', (step) => {
    expect(isValidStep(step)).toBe(true);
  });

  it('rejects "billing" (not a wizard step)', () => {
    expect(isValidStep('billing')).toBe(false);
  });

  it('rejects "welcome" — pre-wizard state, not a navigable segment', () => {
    expect(isValidStep('welcome')).toBe(false);
  });

  it('rejects unknown / malformed segments', () => {
    expect(isValidStep('')).toBe(false);
    expect(isValidStep('PROFILE')).toBe(false);
    expect(isValidStep('../profile')).toBe(false);
  });
});

describe('resumeStepFromOnboardingStep', () => {
  it('maps welcome → profile (first incomplete step)', () => {
    expect(resumeStepFromOnboardingStep('welcome')).toBe('profile');
  });

  it.each<[OnboardingStep, WizardStep]>([
    ['profile', 'profile'],
    ['location', 'location'],
    ['patients', 'patients'],
    ['done', 'done'],
  ])('maps persisted %s → resume at %s', (persisted, expected) => {
    expect(resumeStepFromOnboardingStep(persisted)).toBe(expected);
  });
});

describe('profileStepSchema', () => {
  it('accepts a minimal valid profile (displayName only)', () => {
    const result = profileStepSchema.safeParse({ displayName: 'Dra. Ana' });
    expect(result.success).toBe(true);
  });

  it('accepts displayName with optional phone and bio', () => {
    const result = profileStepSchema.safeParse({
      displayName: 'Dra. Ana',
      phone: '+55 (11) 99999-9999',
      bio: 'Psicóloga clínica.',
    });
    expect(result.success).toBe(true);
  });

  it('trims and rejects a blank displayName', () => {
    const result = profileStepSchema.safeParse({ displayName: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing displayName', () => {
    const result = profileStepSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a displayName longer than 120 characters', () => {
    const result = profileStepSchema.safeParse({ displayName: 'a'.repeat(121) });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed phone', () => {
    const result = profileStepSchema.safeParse({
      displayName: 'Dra. Ana',
      phone: 'not-a-phone!!',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bio longer than 2000 characters', () => {
    const result = profileStepSchema.safeParse({
      displayName: 'Dra. Ana',
      bio: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});
