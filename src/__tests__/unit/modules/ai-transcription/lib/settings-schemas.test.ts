import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  UpdateTranscriptionSettingsInputSchema,
  type UpdateTranscriptionSettingsInput,
} from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Canonical valid payload
// ---------------------------------------------------------------------------

const VALID_INPUT: UpdateTranscriptionSettingsInput = {
  enabled: true,
  defaultTemplate: 'tcc',
  riskDetectionSensitivity: 'high',
  keepAudioHours: 24,
  keepTranscription: false,
};

describe('UpdateTranscriptionSettingsInputSchema', () => {
  it('(a) accepts a valid input', () => {
    const result = UpdateTranscriptionSettingsInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expectTypeOf(result.data).toEqualTypeOf<UpdateTranscriptionSettingsInput>();
    }
  });

  it('(b) rejects keepAudioHours=48 (MVP-locked to 24)', () => {
    const result = UpdateTranscriptionSettingsInputSchema.safeParse({
      ...VALID_INPUT,
      keepAudioHours: 48,
    });
    expect(result.success).toBe(false);
  });

  it('(c) rejects an unknown template', () => {
    const result = UpdateTranscriptionSettingsInputSchema.safeParse({
      ...VALID_INPUT,
      defaultTemplate: 'gestalt',
    });
    expect(result.success).toBe(false);
  });

  it('(d) rejects an unknown sensitivity', () => {
    const result = UpdateTranscriptionSettingsInputSchema.safeParse({
      ...VALID_INPUT,
      riskDetectionSensitivity: 'extreme',
    });
    expect(result.success).toBe(false);
  });
});
