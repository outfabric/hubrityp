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
};

describe('clientEnvSchema — Stream env vars', () => {
  it('rejects a missing NEXT_PUBLIC_STREAM_API_KEY', () => {
    const result = clientEnvSchema.safeParse(omit(validClient, 'NEXT_PUBLIC_STREAM_API_KEY'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('NEXT_PUBLIC_STREAM_API_KEY');
    }
  });

  it('rejects an empty NEXT_PUBLIC_STREAM_API_KEY', () => {
    const result = clientEnvSchema.safeParse({
      ...validClient,
      NEXT_PUBLIC_STREAM_API_KEY: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('NEXT_PUBLIC_STREAM_API_KEY');
    }
  });

  it('accepts a valid NEXT_PUBLIC_STREAM_API_KEY', () => {
    const result = clientEnvSchema.safeParse(validClient);
    expect(result.success).toBe(true);
  });
});

describe('serverEnvSchema — Stream env vars', () => {
  it('rejects a missing STREAM_API_KEY', () => {
    const result = serverEnvSchema.safeParse(omit(validServer, 'STREAM_API_KEY'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('STREAM_API_KEY');
    }
  });

  it('rejects an empty STREAM_API_KEY', () => {
    const result = serverEnvSchema.safeParse({ ...validServer, STREAM_API_KEY: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('STREAM_API_KEY');
    }
  });

  it('rejects a missing STREAM_API_SECRET', () => {
    const result = serverEnvSchema.safeParse(omit(validServer, 'STREAM_API_SECRET'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('STREAM_API_SECRET');
    }
  });

  it('rejects an empty STREAM_API_SECRET', () => {
    const result = serverEnvSchema.safeParse({ ...validServer, STREAM_API_SECRET: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('STREAM_API_SECRET');
    }
  });

  it('accepts valid Stream env vars alongside existing vars', () => {
    const parsed = serverEnvSchema.parse(validServer);
    expect(parsed.STREAM_API_KEY).toBe('stream-api-key');
    expect(parsed.STREAM_API_SECRET).toBe('stream-api-secret');
    expect(parsed.NEXT_PUBLIC_STREAM_API_KEY).toBe('stream-public-key');
  });
});
