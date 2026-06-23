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

// The WhatsApp UI flag is parsed from a "true"/"false" string and transformed
// into a boolean, so the parsed client env carries it even when the raw input
// omits it (it defaults to `false`).
const parsedClient = {
  ...validClient,
  NEXT_PUBLIC_WHATSAPP_UI_ENABLED: false,
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
};

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

  it('defaults NEXT_PUBLIC_WHATSAPP_UI_ENABLED to false when omitted', () => {
    const parsed = clientEnvSchema.parse(validClient);
    expect(parsed.NEXT_PUBLIC_WHATSAPP_UI_ENABLED).toBe(false);
  });

  it('parses the literal "false" string as the boolean false', () => {
    // Guards against the z.coerce.boolean() footgun, which would coerce the
    // non-empty string "false" to `true`.
    const parsed = clientEnvSchema.parse({
      ...validClient,
      NEXT_PUBLIC_WHATSAPP_UI_ENABLED: 'false',
    });
    expect(parsed.NEXT_PUBLIC_WHATSAPP_UI_ENABLED).toBe(false);
  });

  it('parses the literal "true" string as the boolean true', () => {
    const parsed = clientEnvSchema.parse({
      ...validClient,
      NEXT_PUBLIC_WHATSAPP_UI_ENABLED: 'true',
    });
    expect(parsed.NEXT_PUBLIC_WHATSAPP_UI_ENABLED).toBe(true);
  });

  it('rejects a NEXT_PUBLIC_WHATSAPP_UI_ENABLED value outside the enum', () => {
    const result = clientEnvSchema.safeParse({
      ...validClient,
      NEXT_PUBLIC_WHATSAPP_UI_ENABLED: '1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('NEXT_PUBLIC_WHATSAPP_UI_ENABLED');
    }
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
});
