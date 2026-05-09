import { describe, expect, it } from 'vitest';

import { locationInputSchema } from '@/modules/agenda/lib/location-input-schema';

/**
 * Canonical valid payload — reused as a base; each test overrides exactly the
 * field under test.
 */
const VALID_PAYLOAD = {
  name: 'Consultório Centro',
  type: 'in_person' as const,
};

type FieldErrorRecord = Record<string, string[] | undefined>;

const fieldErrorsOf = (
  result: ReturnType<typeof locationInputSchema.safeParse>,
): FieldErrorRecord => {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error.flatten().fieldErrors;
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('locationInputSchema — happy path', () => {
  it('accepts the canonical valid payload (minimal required fields)', () => {
    const result = locationInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts a full payload with all optional fields', () => {
    const result = locationInputSchema.safeParse({
      ...VALID_PAYLOAD,
      address: 'Rua das Flores, 123',
      color: '#FF5733',
      arrival_instructions: 'Subir ao 3o andar, sala 302.',
      is_default: true,
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from name', () => {
    const result = locationInputSchema.safeParse({
      ...VALID_PAYLOAD,
      name: '   Consultório Centro   ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('Consultório Centro');
  });
});

// ---------------------------------------------------------------------------
// name
// ---------------------------------------------------------------------------

describe('locationInputSchema — name', () => {
  it('rejects empty name', () => {
    const errs = fieldErrorsOf(locationInputSchema.safeParse({ ...VALID_PAYLOAD, name: '' }));
    expect(errs.name?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects whitespace-only name (trimmed to empty)', () => {
    const errs = fieldErrorsOf(locationInputSchema.safeParse({ ...VALID_PAYLOAD, name: '   ' }));
    expect(errs.name?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects name longer than 120 characters', () => {
    const errs = fieldErrorsOf(
      locationInputSchema.safeParse({ ...VALID_PAYLOAD, name: 'A'.repeat(121) }),
    );
    expect(errs.name?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts name of exactly 120 characters', () => {
    const result = locationInputSchema.safeParse({
      ...VALID_PAYLOAD,
      name: 'A'.repeat(120),
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

describe('locationInputSchema — type', () => {
  it.each([['in_person'], ['online'], ['other']] as const)('accepts valid type "%s"', (type) => {
    const result = locationInputSchema.safeParse({ ...VALID_PAYLOAD, type });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const errs = fieldErrorsOf(locationInputSchema.safeParse({ ...VALID_PAYLOAD, type: 'hybrid' }));
    expect(errs.type?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects missing type', () => {
    const errs = fieldErrorsOf(locationInputSchema.safeParse({ name: 'Sala A' }));
    expect(errs.type?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// color (hex)
// ---------------------------------------------------------------------------

describe('locationInputSchema — color', () => {
  it.each([['#FF5733'], ['#000000'], ['#abcdef']])('accepts valid hex color "%s"', (color) => {
    const result = locationInputSchema.safeParse({ ...VALID_PAYLOAD, color });
    expect(result.success).toBe(true);
  });

  it.each([
    ['FF5733', 'missing hash'],
    ['#GGG000', 'invalid hex characters'],
    ['#FFF', 'short-form hex'],
    ['#FF57331A', 'eight-digit hex (alpha)'],
    ['red', 'named color'],
  ])('rejects invalid hex color "%s" (%s)', (color) => {
    const errs = fieldErrorsOf(locationInputSchema.safeParse({ ...VALID_PAYLOAD, color }));
    expect(errs.color?.length ?? 0).toBeGreaterThan(0);
  });

  it('accepts absent color (field is optional)', () => {
    const result = locationInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// optional fields absent
// ---------------------------------------------------------------------------

describe('locationInputSchema — optional fields', () => {
  it('accepts payload without address, color, arrival_instructions, is_default', () => {
    const result = locationInputSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });
});
