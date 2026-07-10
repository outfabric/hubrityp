import { describe, expect, it } from 'vitest';

import { clientEnvSchema, serverEnvSchema } from '@/shared/env/schemas';

function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const next = { ...obj };
  delete next[key];
  return next;
}

const validClient = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_STREAM_API_KEY: 'stream-public-key',
  NEXT_PUBLIC_SITE_URL: 'https://hubrity.com',
};

// The three WhatsApp UI flags are each parsed from a "true"/"false" string and
// transformed into a boolean, so the parsed client env carries them even when
// the raw input omits them (they default to `false`).
const parsedClient = {
  ...validClient,
  NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED: false,
  NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED: false,
  NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED: false,
};

// The five platform Content SIDs are required server-only vars — the server env
// fails to parse when any is missing.
const validContentSids = {
  TWILIO_CONTENT_SID_LEMBRETE_24H: 'HX24h',
  TWILIO_CONTENT_SID_LEMBRETE_2H: 'HX2h',
  TWILIO_CONTENT_SID_LINK_VIDEO: 'HXvideo',
  TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA: 'HXconfirm',
  TWILIO_CONTENT_SID_CANCELAMENTO_AVISO: 'HXcancel',
};

const validServer = {
  ...validClient,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  LOG_LEVEL: 'info',
  STREAM_API_KEY: 'stream-api-key',
  STREAM_API_SECRET: 'stream-api-secret',
  STREAM_WEBHOOK_SECRET: 'stream-webhook-secret',
  GEMINI_API_KEY: 'gemini-api-key',
  INNGEST_ENCRYPTION_KEY: 'test-inngest-encryption-key-minimum-32ch',
  SIGNATURE_HASH_SALT: 'test-signature-hash-salt-minimum-32-chars',
  PENDING_EMAIL_COOKIE_SECRET: 'test-pending-email-cookie-secret-min-32-chars',
  ...validContentSids,
};

const WHATSAPP_UI_FLAGS = [
  'NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED',
  'NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED',
  'NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED',
] as const;

const CONTENT_SID_KEYS = [
  'TWILIO_CONTENT_SID_LEMBRETE_24H',
  'TWILIO_CONTENT_SID_LEMBRETE_2H',
  'TWILIO_CONTENT_SID_LINK_VIDEO',
  'TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA',
  'TWILIO_CONTENT_SID_CANCELAMENTO_AVISO',
] as const;

describe('clientEnvSchema', () => {
  it('parses a valid client env', () => {
    expect(clientEnvSchema.parse(validClient)).toEqual(parsedClient);
  });

  it('rejects a non-URL Supabase URL', () => {
    const result = clientEnvSchema.safeParse({
      ...validClient,
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('NEXT_PUBLIC_SUPABASE_URL');
    }
  });

  it('rejects an empty anon key', () => {
    const result = clientEnvSchema.safeParse({
      ...validClient,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    });
    expect(result.success).toBe(false);
  });

  it.each(WHATSAPP_UI_FLAGS)('defaults %s to false when omitted', (flag) => {
    const parsed = clientEnvSchema.parse(validClient) as Record<string, unknown>;
    expect(parsed[flag]).toBe(false);
  });

  it.each(WHATSAPP_UI_FLAGS)(
    'parses the literal "false" string as boolean false for %s',
    (flag) => {
      // Guards against the z.coerce.boolean() footgun, which would coerce the
      // non-empty string "false" to `true`.
      const parsed = clientEnvSchema.parse({ ...validClient, [flag]: 'false' }) as Record<
        string,
        unknown
      >;
      expect(parsed[flag]).toBe(false);
    },
  );

  it.each(WHATSAPP_UI_FLAGS)('parses the literal "true" string as boolean true for %s', (flag) => {
    const parsed = clientEnvSchema.parse({ ...validClient, [flag]: 'true' }) as Record<
      string,
      unknown
    >;
    expect(parsed[flag]).toBe(true);
  });

  it.each(WHATSAPP_UI_FLAGS)('rejects a %s value outside the enum', (flag) => {
    const result = clientEnvSchema.safeParse({ ...validClient, [flag]: '1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty(flag);
    }
  });

  it('keeps the three WhatsApp UI flags independent of one another', () => {
    const parsed = clientEnvSchema.parse({
      ...validClient,
      NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED: 'true',
      NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED: 'false',
      NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED: 'false',
    });
    expect(parsed.NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED).toBe(true);
    expect(parsed.NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED).toBe(false);
    expect(parsed.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED).toBe(false);
  });

  it('no longer accepts the removed NEXT_PUBLIC_WHATSAPP_UI_ENABLED as a known key', () => {
    // The legacy single flag was removed with no alias; an unknown extra key is
    // stripped (not surfaced) rather than mapped onto any of the new flags.
    const parsed = clientEnvSchema.parse({
      ...validClient,
      NEXT_PUBLIC_WHATSAPP_UI_ENABLED: 'true',
    }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('NEXT_PUBLIC_WHATSAPP_UI_ENABLED');
    expect(parsed.NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED).toBe(false);
  });
});

describe('serverEnvSchema', () => {
  it('parses a valid server env', () => {
    const parsed = serverEnvSchema.parse(validServer);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBe('service-key');
  });

  it('defaults LOG_LEVEL to info when omitted', () => {
    const withoutLevel = omit(validServer, 'LOG_LEVEL');
    const parsed = serverEnvSchema.parse(withoutLevel);
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('rejects an invalid LOG_LEVEL', () => {
    const result = serverEnvSchema.safeParse({ ...validServer, LOG_LEVEL: 'verbose' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing service-role key', () => {
    const withoutSecret = omit(validServer, 'SUPABASE_SERVICE_ROLE_KEY');
    const result = serverEnvSchema.safeParse(withoutSecret);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('rejects a malformed DATABASE_URL', () => {
    const result = serverEnvSchema.safeParse({ ...validServer, DATABASE_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('parses the five platform Content SIDs when present', () => {
    const parsed = serverEnvSchema.parse(validServer);
    expect(parsed.TWILIO_CONTENT_SID_LEMBRETE_24H).toBe('HX24h');
    expect(parsed.TWILIO_CONTENT_SID_LEMBRETE_2H).toBe('HX2h');
    expect(parsed.TWILIO_CONTENT_SID_LINK_VIDEO).toBe('HXvideo');
    expect(parsed.TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA).toBe('HXconfirm');
    expect(parsed.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO).toBe('HXcancel');
  });

  it.each(CONTENT_SID_KEYS)('fails boot validation when %s is missing', (key) => {
    const result = serverEnvSchema.safeParse(omit(validServer, key));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty(key);
    }
  });

  it.each(CONTENT_SID_KEYS)('rejects an empty %s', (key) => {
    const result = serverEnvSchema.safeParse({ ...validServer, [key]: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty(key);
    }
  });
});
