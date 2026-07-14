import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SendTemplateInput } from '@/modules/whatsapp/server/adapters/twilio-bsp';

// ---------------------------------------------------------------------------
// Twilio SDK mock
// ---------------------------------------------------------------------------

const { messagesCreate, twilioFactory } = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  return {
    messagesCreate,
    twilioFactory: vi.fn(() => ({ messages: { create: messagesCreate } })),
  };
});

vi.mock('twilio', () => ({ default: twilioFactory }));

/**
 * A minimal stand-in for Twilio's `RestException`. The adapter's type guard
 * only checks that the thrown value is an `Error` carrying numeric `status`
 * and `code` fields.
 */
class FakeRestException extends Error {
  public readonly status: number;
  public readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const BASE_INPUT: SendTemplateInput = {
  to: '+5511988887777',
  templateKey: 'lembrete_24h',
  contentSid: 'HXcontent001',
  variables: {
    first_name: 'Maria',
    professional_name: 'Dra. Teste',
    date: '15/06/2026',
    time: '11:00',
  },
};

/** Imports a fresh adapter module bound to the stubbed env + twilio mock. */
async function importAdapter() {
  return import('@/modules/whatsapp/server/adapters/twilio-bsp');
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACunittest');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'unit-test-auth-token');
  vi.stubEnv('TWILIO_WHATSAPP_FROM', '+5511999999999');
  messagesCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendTemplate — Content template request shape', () => {
  it('sends contentSid + contentVariables as a named-key JSON string, with no body', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM_success_001', status: 'queued' });

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bspMessageId).toBe('SM_success_001');
    expect(result.data.status).toBe('queued');

    expect(messagesCreate).toHaveBeenCalledOnce();
    const payload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;

    expect(payload.to).toBe('whatsapp:+5511988887777');
    expect(payload.from).toBe('whatsapp:+5511999999999');
    expect(payload.contentSid).toBe('HXcontent001');

    // contentVariables must be the JSON string of the named-key map.
    expect(payload.contentVariables).toBe(JSON.stringify(BASE_INPUT.variables));
    expect(JSON.parse(payload.contentVariables as string)).toEqual({
      first_name: 'Maria',
      professional_name: 'Dra. Teste',
      date: '15/06/2026',
      time: '11:00',
    });

    // A Content send must NOT carry a body alongside contentSid.
    expect(payload).not.toHaveProperty('body');
  });
});

describe('sendTemplate — typed error mapping (unchanged)', () => {
  it.each([
    [21211, 'INVALID_PHONE'],
    [21610, 'BLOCKED_BY_USER'],
    [21614, 'OPT_OUT'],
    [20429, 'RATE_LIMIT'],
  ])('maps Twilio error code %s to %s', async (twilioCode, expectedCode) => {
    messagesCreate.mockRejectedValue(new FakeRestException(400, twilioCode, 'twilio rejected'));

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(expectedCode);
    expect(result.error.twilioCode).toBe(twilioCode);
  });

  it('maps an unrecognized Twilio error code to UNKNOWN', async () => {
    messagesCreate.mockRejectedValue(new FakeRestException(500, 99999, 'boom'));

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN');
    expect(result.error.twilioCode).toBe(99999);
  });

  it('maps a non-RestException throw to UNKNOWN with no twilioCode', async () => {
    messagesCreate.mockRejectedValue(new Error('network down'));

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN');
    expect(result.error.twilioCode).toBeUndefined();
    expect(result.error.message).toBe('network down');
  });
});

describe('sendTemplate — missing credentials', () => {
  it('returns an UNKNOWN error without calling Twilio when credentials are absent', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.resetModules();

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN');
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E.164 normalization — sendTemplate
// ---------------------------------------------------------------------------

describe('sendTemplate — E.164 normalization', () => {
  it('normalizes a masked BR number before calling Twilio', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM_masked_001', status: 'queued' });

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate({
      ...BASE_INPUT,
      to: '+55 86 99578-3867',
    });

    expect(result.ok).toBe(true);
    expect(messagesCreate).toHaveBeenCalledOnce();
    const payload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toBe('whatsapp:+5586995783867');
  });

  it('passes through an already-E.164 number unchanged', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM_e164_001', status: 'queued' });

    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate({
      ...BASE_INPUT,
      to: '+5586995783867',
    });

    expect(result.ok).toBe(true);
    expect(messagesCreate).toHaveBeenCalledOnce();
    const payload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toBe('whatsapp:+5586995783867');
  });

  it('returns INVALID_PHONE without calling Twilio for un-normalizable input', async () => {
    const { sendTemplate } = await importAdapter();
    const result = await sendTemplate({
      ...BASE_INPUT,
      to: 'not-a-phone',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PHONE');
    expect(result.error.twilioCode).toBeUndefined();
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E.164 normalization — sendFreeText
// ---------------------------------------------------------------------------

describe('sendFreeText — E.164 normalization', () => {
  it('normalizes a masked BR number before calling Twilio', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM_ft_masked_001', status: 'queued' });

    const { sendFreeText } = await importAdapter();
    const result = await sendFreeText({
      to: '+55 86 99578-3867',
      body: 'Hello',
    });

    expect(result.ok).toBe(true);
    expect(messagesCreate).toHaveBeenCalledOnce();
    const payload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toBe('whatsapp:+5586995783867');
  });

  it('passes through an already-E.164 number unchanged', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM_ft_e164_001', status: 'queued' });

    const { sendFreeText } = await importAdapter();
    const result = await sendFreeText({
      to: '+5586995783867',
      body: 'Hello',
    });

    expect(result.ok).toBe(true);
    expect(messagesCreate).toHaveBeenCalledOnce();
    const payload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toBe('whatsapp:+5586995783867');
  });

  it('returns INVALID_PHONE without calling Twilio for un-normalizable input', async () => {
    const { sendFreeText } = await importAdapter();
    const result = await sendFreeText({
      to: 'not-a-phone',
      body: 'Hello',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PHONE');
    expect(result.error.twilioCode).toBeUndefined();
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});
