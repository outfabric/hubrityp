import { describe, expect, it } from 'vitest';

import {
  reminderSettingsSchema,
  reminderSettingsWithConsentSchema,
} from '@/modules/whatsapp/lib/reminders/reminder-settings-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid baseline input — all fields populated with acceptable values. */
function validInput() {
  return {
    early_reminder_hours: 24,
    final_reminder_hours: 2,
    video_link_minutes: 30,
    send_during_night: false,
  };
}

// ---------------------------------------------------------------------------
// Valid inputs
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — valid inputs', () => {
  it('accepts a fully populated input with all fields', () => {
    const result = reminderSettingsSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it.each([12, 24, 48])('accepts early_reminder_hours = %d', (hours) => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      early_reminder_hours: hours,
    });
    expect(result.success).toBe(true);
  });

  it('accepts early_reminder_hours = null (disabled)', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      early_reminder_hours: null,
    });
    expect(result.success).toBe(true);
  });

  it.each([0.5, 1, 2])('accepts final_reminder_hours = %s', (hours) => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      final_reminder_hours: hours,
    });
    expect(result.success).toBe(true);
  });

  it('accepts final_reminder_hours = null (disabled)', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      final_reminder_hours: null,
    });
    expect(result.success).toBe(true);
  });

  it.each([15, 30, 60])('accepts video_link_minutes = %d', (minutes) => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      video_link_minutes: minutes,
    });
    expect(result.success).toBe(true);
  });

  it.each([true, false])('accepts send_during_night = %s', (value) => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      send_during_night: value,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid inputs — early_reminder_hours
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — invalid early_reminder_hours', () => {
  it('rejects an invalid numeric value (6)', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      early_reminder_hours: 6,
    });
    expect(result.success).toBe(false);
  });

  it('provides the correct pt-BR error message for invalid value', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      early_reminder_hours: 6,
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.includes('early_reminder_hours'));
    expect(issue?.message).toBe('Valor inválido. Escolha 12, 24 ou 48 horas.');
  });
});

// ---------------------------------------------------------------------------
// Invalid inputs — final_reminder_hours
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — invalid final_reminder_hours', () => {
  it('rejects an invalid numeric value (3)', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      final_reminder_hours: 3,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalid inputs — video_link_minutes
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — invalid video_link_minutes', () => {
  it('rejects an invalid numeric value (45)', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      video_link_minutes: 45,
    });
    expect(result.success).toBe(false);
  });

  it('provides the correct pt-BR error message for invalid value', () => {
    const result = reminderSettingsSchema.safeParse({
      ...validInput(),
      video_link_minutes: 45,
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.includes('video_link_minutes'));
    expect(issue?.message).toBe('Valor inválido. Escolha 15, 30 ou 60 minutos.');
  });
});

// ---------------------------------------------------------------------------
// Invalid inputs — missing required fields
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — missing required fields', () => {
  it('rejects when early_reminder_hours is missing', () => {
    const result = reminderSettingsSchema.safeParse({
      final_reminder_hours: 2,
      video_link_minutes: 30,
      send_during_night: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when final_reminder_hours is missing', () => {
    const result = reminderSettingsSchema.safeParse({
      early_reminder_hours: 24,
      video_link_minutes: 30,
      send_during_night: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when video_link_minutes is missing', () => {
    const result = reminderSettingsSchema.safeParse({
      early_reminder_hours: 24,
      final_reminder_hours: 2,
      send_during_night: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when send_during_night is missing', () => {
    const result = reminderSettingsSchema.safeParse({
      early_reminder_hours: 24,
      final_reminder_hours: 2,
      video_link_minutes: 30,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty object', () => {
    const result = reminderSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Consent — optional on the base schema, required on the consent variant
// ---------------------------------------------------------------------------

describe('reminderSettingsSchema — consent (optional variant)', () => {
  it('accepts a valid input with consent: true', () => {
    const result = reminderSettingsSchema.safeParse({ ...validInput(), consent: true });
    expect(result.success).toBe(true);
  });

  it('accepts a valid input when consent is absent (account already exists)', () => {
    const result = reminderSettingsSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it('rejects consent: false even on the optional variant', () => {
    const result = reminderSettingsSchema.safeParse({ ...validInput(), consent: false });
    expect(result.success).toBe(false);
  });
});

describe('reminderSettingsWithConsentSchema — consent required', () => {
  it('accepts a valid input with consent: true', () => {
    const result = reminderSettingsWithConsentSchema.safeParse({ ...validInput(), consent: true });
    expect(result.success).toBe(true);
  });

  it('rejects when consent is absent', () => {
    const result = reminderSettingsWithConsentSchema.safeParse(validInput());
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.includes('consent'));
    expect(issue?.message).toBe(
      'Você precisa aceitar o termo de consentimento para ativar os lembretes no WhatsApp.',
    );
  });

  it('rejects when consent is false', () => {
    const result = reminderSettingsWithConsentSchema.safeParse({
      ...validInput(),
      consent: false,
    });
    expect(result.success).toBe(false);
  });

  it('still validates the other fields (invalid early_reminder_hours)', () => {
    const result = reminderSettingsWithConsentSchema.safeParse({
      ...validInput(),
      early_reminder_hours: 6,
      consent: true,
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.includes('early_reminder_hours'));
    expect(issue?.message).toBe('Valor inválido. Escolha 12, 24 ou 48 horas.');
  });
});
