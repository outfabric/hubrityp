import { describe, expect, it } from 'vitest';

import { postLoginRedirect } from '@/modules/auth/lib/post-login-redirect';

// Spec scenarios for `postLoginRedirect`. Each test maps to a status branch
// in the modified `signIn` requirement of
// `openspec/changes/add-account-signup-and-lifecycle/specs/authentication/spec.md`.

describe('postLoginRedirect', () => {
  describe('active', () => {
    it('returns /dashboard when no redirectTo is provided', () => {
      expect(postLoginRedirect('active', null)).toBe('/dashboard');
    });

    it('honours a same-origin redirectTo path', () => {
      expect(postLoginRedirect('active', '/patients')).toBe('/patients');
    });

    it('honours a deeper same-origin path with query string', () => {
      expect(postLoginRedirect('active', '/dashboard/settings?tab=billing')).toBe(
        '/dashboard/settings?tab=billing',
      );
    });

    it('falls back to /dashboard when redirectTo is empty', () => {
      expect(postLoginRedirect('active', '')).toBe('/dashboard');
    });

    it('falls back to /dashboard for a hostile absolute URL', () => {
      expect(postLoginRedirect('active', 'https://evil.example.com')).toBe('/dashboard');
    });

    it('falls back to /dashboard for a protocol-relative URL', () => {
      expect(postLoginRedirect('active', '//evil.example.com')).toBe('/dashboard');
    });

    it('falls back to /dashboard for a javascript: scheme', () => {
      expect(postLoginRedirect('active', 'javascript:alert(1)')).toBe('/dashboard');
    });
  });

  describe('pending_verification', () => {
    it('always returns /auth/verify-email — bloqueante page wins over redirectTo', () => {
      // Spec scenario: "Pending-verification user is redirected to the email
      // page" — and: "even if `redirectTo` was supplied (the bloqueante page
      // wins until the user is `active`)".
      expect(postLoginRedirect('pending_verification', null)).toBe('/auth/verify-email');
      expect(postLoginRedirect('pending_verification', '/dashboard')).toBe('/auth/verify-email');
      expect(postLoginRedirect('pending_verification', '/patients?ts=12')).toBe(
        '/auth/verify-email',
      );
    });
  });

  describe('pending_crp_validation', () => {
    it('always returns /auth/crp-review — bloqueante page wins over redirectTo', () => {
      expect(postLoginRedirect('pending_crp_validation', null)).toBe('/auth/crp-review');
      expect(postLoginRedirect('pending_crp_validation', '/dashboard')).toBe('/auth/crp-review');
    });
  });

  describe('suspended', () => {
    it('returns /login?reason=suspended', () => {
      expect(postLoginRedirect('suspended', null)).toBe('/login?reason=suspended');
    });

    it('ignores requestedRedirect for suspended users', () => {
      expect(postLoginRedirect('suspended', '/dashboard')).toBe('/login?reason=suspended');
    });
  });

  describe('cancelled', () => {
    it('returns /login?reason=cancelled', () => {
      expect(postLoginRedirect('cancelled', null)).toBe('/login?reason=cancelled');
    });

    it('ignores requestedRedirect for cancelled users', () => {
      expect(postLoginRedirect('cancelled', '/dashboard')).toBe('/login?reason=cancelled');
    });
  });
});
