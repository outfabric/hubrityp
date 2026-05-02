import { describe, expect, it } from 'vitest';

import { mapSupabaseUser } from './map-supabase-user';

describe('mapSupabaseUser', () => {
  it('returns null for null input', () => {
    expect(mapSupabaseUser(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(mapSupabaseUser(undefined)).toBeNull();
  });

  it('maps a populated user to { id, email } and drops every other field', () => {
    const supabaseUser = {
      id: 'abc',
      email: 'a@b.co',
      // Fields the rest of the app must never see leaking through this adapter.
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'Dra. Maria' },
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
      role: 'authenticated',
      phone: '+5511999999999',
    };

    const result = mapSupabaseUser(supabaseUser);

    expect(result).toEqual({ id: 'abc', email: 'a@b.co' });
    // Strict shape check: nothing else slipped through.
    expect(Object.keys(result ?? {})).toEqual(['id', 'email']);
  });

  it('returns null when id is missing', () => {
    const result = mapSupabaseUser({ email: 'a@b.co' });

    expect(result).toBeNull();
  });

  it('returns null when email is missing', () => {
    const result = mapSupabaseUser({ id: 'abc' });

    expect(result).toBeNull();
  });

  it('returns null when id is an empty string', () => {
    const result = mapSupabaseUser({ id: '', email: 'a@b.co' });

    expect(result).toBeNull();
  });

  it('returns null when email is an empty string', () => {
    const result = mapSupabaseUser({ id: 'abc', email: '' });

    expect(result).toBeNull();
  });

  it('returns null when id or email is null', () => {
    expect(mapSupabaseUser({ id: null, email: 'a@b.co' })).toBeNull();
    expect(mapSupabaseUser({ id: 'abc', email: null })).toBeNull();
  });
});
