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
  TWILIO_CONTENT_SID_LEMBRETE_24H: 'HX24h',
  TWILIO_CONTENT_SID_LEMBRETE_2H: 'HX2h',
  TWILIO_CONTENT_SID_LINK_VIDEO: 'HXvideo',
  TWILIO_CONTENT_SID_CANCELAMENTO_AVISO: 'HXcancel',
};

describe('serverEnvSchema — AI transcription env vars', () => {
  it('rejects when GEMINI_API_KEY is absent', () => {
    const result = serverEnvSchema.safeParse(omit(validServer, 'GEMINI_API_KEY'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('GEMINI_API_KEY');
    }
  });

  it('rejects when GEMINI_API_KEY is empty', () => {
    const result = serverEnvSchema.safeParse({ ...validServer, GEMINI_API_KEY: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('GEMINI_API_KEY');
    }
  });

  it('applies defaults for the five optional fields when omitted', () => {
    const parsed = serverEnvSchema.parse(validServer);
    expect(parsed.GEMINI_MODEL_TRANSCRIPTION).toBe('gemini-3.5-flash');
    expect(parsed.GEMINI_MODEL_NOTE).toBe('gemini-3.5-flash');
    expect(parsed.AI_TRANSCRIPTION_BUCKET).toBe('ai-transcription-audio');
    expect(parsed.AI_TRANSCRIPTION_AUDIO_TTL_HOURS).toBe(24);
    expect(parsed.AI_TRANSCRIPTION_MAX_AUDIO_MB).toBe(200);
  });

  it('rejects AI_TRANSCRIPTION_AUDIO_TTL_HOURS below minimum (12 < 24)', () => {
    const result = serverEnvSchema.safeParse({
      ...validServer,
      AI_TRANSCRIPTION_AUDIO_TTL_HOURS: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('AI_TRANSCRIPTION_AUDIO_TTL_HOURS');
    }
  });

  it('rejects AI_TRANSCRIPTION_AUDIO_TTL_HOURS above maximum (169 > 168)', () => {
    const result = serverEnvSchema.safeParse({
      ...validServer,
      AI_TRANSCRIPTION_AUDIO_TTL_HOURS: '169',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('AI_TRANSCRIPTION_AUDIO_TTL_HOURS');
    }
  });

  it('accepts AI_TRANSCRIPTION_AUDIO_TTL_HOURS at boundary values (24 and 168)', () => {
    const low = serverEnvSchema.safeParse({
      ...validServer,
      AI_TRANSCRIPTION_AUDIO_TTL_HOURS: '24',
    });
    expect(low.success).toBe(true);

    const high = serverEnvSchema.safeParse({
      ...validServer,
      AI_TRANSCRIPTION_AUDIO_TTL_HOURS: '168',
    });
    expect(high.success).toBe(true);
  });

  it('rejects GEMINI_MODEL_TRANSCRIPTION that does not match the regex', () => {
    const result = serverEnvSchema.safeParse({
      ...validServer,
      GEMINI_MODEL_TRANSCRIPTION: 'gpt-4',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('GEMINI_MODEL_TRANSCRIPTION');
    }
  });

  it('accepts a valid custom GEMINI_MODEL_TRANSCRIPTION', () => {
    const parsed = serverEnvSchema.parse({
      ...validServer,
      GEMINI_MODEL_TRANSCRIPTION: 'gemma-3n-e4b',
    });
    expect(parsed.GEMINI_MODEL_TRANSCRIPTION).toBe('gemma-3n-e4b');
  });
});

describe('clientEnvSchema — AI transcription env vars exclusion', () => {
  it('does NOT contain GEMINI_API_KEY in its shape', () => {
    const shape = clientEnvSchema.shape;
    expect(shape).not.toHaveProperty('GEMINI_API_KEY');
  });

  it('does NOT contain any AI_TRANSCRIPTION_* key in its shape', () => {
    const keys = Object.keys(clientEnvSchema.shape);
    const aiKeys = keys.filter((k) => k.startsWith('AI_TRANSCRIPTION_') || k.startsWith('GEMINI_'));
    expect(aiKeys).toEqual([]);
  });
});
