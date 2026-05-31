import { describe, expect, it } from 'vitest';

import {
  notificationPreferencesSchema,
  npsAnswerSchema,
  onboardingStepSchema,
} from '@/modules/onboarding/lib/schemas';

describe('npsAnswerSchema', () => {
  it('accepts a score with feedback', () => {
    const result = npsAnswerSchema.safeParse({ score: 9, feedback: 'x' });
    expect(result.success).toBe(true);
  });

  it('accepts a score without feedback', () => {
    const result = npsAnswerSchema.safeParse({ score: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a score above 10', () => {
    const result = npsAnswerSchema.safeParse({ score: 12 });
    expect(result.success).toBe(false);
  });

  it('rejects feedback longer than 2000 characters', () => {
    const result = npsAnswerSchema.safeParse({
      score: 5,
      feedback: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('onboardingStepSchema', () => {
  it('accepts a valid step', () => {
    expect(onboardingStepSchema.safeParse('welcome').success).toBe(true);
  });

  it('rejects an unknown step', () => {
    expect(onboardingStepSchema.safeParse('billing').success).toBe(false);
  });
});

describe('notificationPreferencesSchema', () => {
  it('accepts all-boolean preferences', () => {
    const result = notificationPreferencesSchema.safeParse({
      emailDaily: true,
      emailWeekly: false,
      emailCritical: true,
      inAppSound: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-boolean field', () => {
    const result = notificationPreferencesSchema.safeParse({
      emailDaily: 'yes',
      emailWeekly: false,
      emailCritical: true,
      inAppSound: false,
    });
    expect(result.success).toBe(false);
  });
});
