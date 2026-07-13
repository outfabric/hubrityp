import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InngestClient from '@/modules/whatsapp/inngest/client';

// The Route Handler triggers the auto-reply helper inline for inbound_text
// and emits Inngest events for the other branches. We spy on both to assert
// routing without hitting the real DB / Twilio / Inngest Cloud.
const processInboundAutoReply = vi.fn(() => Promise.resolve({ status: 'sent' as const }));
vi.mock('@/modules/whatsapp/server/auto-reply-inbound', () => ({
  processInboundAutoReply,
}));

const inngestSend = vi.fn(() => Promise.resolve({ ids: [] }));
vi.mock('@/modules/whatsapp/inngest/client', async (importOriginal) => {
  const actual = await importOriginal<typeof InngestClient>();
  return {
    ...actual,
    inngest: { send: inngestSend },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a valid Twilio `X-Twilio-Signature` for the given params: sort
 * keys, append key+value to the URL, HMAC-SHA1 with the auth token, base64.
 */
function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

async function postWebhook(
  params: Record<string, string>,
  opts: { signature?: string } = {},
): Promise<Response> {
  const { serverEnv } = await import('@/shared/env');
  const { POST } = await import('@/app/api/webhooks/twilio/whatsapp/route');

  const authToken = serverEnv.TWILIO_AUTH_TOKEN!;
  const url = serverEnv.TWILIO_WEBHOOK_URL!;
  const signature = opts.signature ?? twilioSignature(authToken, url, params);

  const body = new URLSearchParams(params).toString();
  const request = new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature,
    },
    body,
  });

  return POST(request);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Twilio webhook Route Handler — inbound routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inbound_text triggers the auto-reply and does NOT emit an Inngest event', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_inbound_1',
      From: 'whatsapp:+5511988887777',
      Body: 'Oi, tudo bem?',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).toHaveBeenCalledTimes(1);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('button_confirm (ButtonPayload=confirm) goes to its Inngest handler and gets NO auto-reply', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_confirm_1',
      From: 'whatsapp:+5511988887777',
      ButtonPayload: 'confirm',
      // ButtonText is display copy — classification must not depend on it.
      ButtonText: 'Confirmar presença',
      OriginalRepliedMessageSid: 'SM_orig_1',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'whatsapp/confirmation.received' }),
    );
  });

  it('button_cancel (ButtonPayload=cancel) goes to its Inngest handler and gets NO auto-reply', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_cancel_1',
      From: 'whatsapp:+5511988887777',
      ButtonPayload: 'cancel',
      ButtonText: 'Não posso comparecer',
      OriginalRepliedMessageSid: 'SM_orig_2',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'whatsapp/cancellation.received' }),
    );
  });

  it('unrecognized ButtonPayload falls through to the auto-reply/inbound path (200, no Inngest event)', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_unknown_btn_1',
      From: 'whatsapp:+5511988887777',
      ButtonPayload: 'some_other_button',
      ButtonText: 'Outra opção',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).toHaveBeenCalledTimes(1);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('stop_command (PARAR) goes to its Inngest handler and gets NO auto-reply', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_stop_1',
      From: 'whatsapp:+5511988887777',
      Body: 'PARAR',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'whatsapp/stop.received' }),
    );
  });

  it('status_update goes to its Inngest handler and gets NO auto-reply', async () => {
    const res = await postWebhook({
      MessageSid: 'SM_status_1',
      MessageStatus: 'delivered',
    });

    expect(res.status).toBe(200);
    expect(processInboundAutoReply).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'whatsapp/status.updated' }),
    );
  });

  it('rejects an inbound with an invalid HMAC signature (403), no side effects', async () => {
    const res = await postWebhook(
      {
        MessageSid: 'SM_inbound_bad',
        From: 'whatsapp:+5511988887777',
        Body: 'Oi',
      },
      { signature: 'obviously-invalid-signature' },
    );

    expect(res.status).toBe(403);
    expect(processInboundAutoReply).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
