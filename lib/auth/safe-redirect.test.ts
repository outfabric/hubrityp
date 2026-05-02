import { describe, expect, it } from 'vitest';

import { safeRedirect } from './safe-redirect';

const FALLBACK = '/dashboard';

describe('safeRedirect', () => {
  describe('accepted same-origin paths', () => {
    it('returns a simple relative path unchanged', () => {
      expect(safeRedirect('/patients', FALLBACK)).toBe('/patients');
    });

    it('returns a deeper relative path unchanged', () => {
      expect(safeRedirect('/dashboard/settings/profile', FALLBACK)).toBe(
        '/dashboard/settings/profile',
      );
    });

    it('preserves a query string on a relative path', () => {
      expect(safeRedirect('/dashboard?x=1', FALLBACK)).toBe('/dashboard?x=1');
    });

    it('preserves multiple query parameters', () => {
      expect(safeRedirect('/dashboard?foo=bar&baz=qux', FALLBACK)).toBe(
        '/dashboard?foo=bar&baz=qux',
      );
    });

    it('preserves a fragment on a relative path', () => {
      expect(safeRedirect('/dashboard#section', FALLBACK)).toBe('/dashboard#section');
    });

    it('returns the lone `/` (root) unchanged', () => {
      expect(safeRedirect('/', FALLBACK)).toBe('/');
    });
  });

  describe('null / empty inputs fall back', () => {
    it('returns fallback when target is null', () => {
      expect(safeRedirect(null, FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback when target is undefined', () => {
      expect(safeRedirect(undefined, FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback when target is an empty string', () => {
      expect(safeRedirect('', FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('non-rooted paths fall back', () => {
    it('returns fallback for a path that does not start with /', () => {
      expect(safeRedirect('dashboard', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for a query-only string (no leading /)', () => {
      expect(safeRedirect('?next=true', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for a fragment-only string', () => {
      expect(safeRedirect('#anchor', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for an absolute http URL', () => {
      expect(safeRedirect('http://evil.com/x', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for an absolute https URL', () => {
      expect(safeRedirect('https://evil.example.com/x', FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('protocol-relative URLs fall back', () => {
    it('returns fallback for //evil.com', () => {
      expect(safeRedirect('//evil.com', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for //evil.com/path', () => {
      expect(safeRedirect('//evil.com/admin', FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('scheme-bearing paths fall back', () => {
    it('returns fallback for javascript: scheme', () => {
      expect(safeRedirect('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for data: scheme', () => {
      expect(safeRedirect('data:text/html,<script>alert(1)</script>', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for mailto: scheme', () => {
      expect(safeRedirect('mailto:foo@bar.com', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for a path with embedded colon before the first internal slash', () => {
      // `/foo:bar/baz` could be parsed by some routers as a scheme — reject
      // defensively to avoid surprises if browser/proxy normalisation kicks in.
      expect(safeRedirect('/foo:bar/baz', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback when the entire path before the next / is colon-bearing', () => {
      expect(safeRedirect('/javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
    });

    it('allows colons that appear AFTER the first internal slash (query/fragment safe)', () => {
      // A colon in the query string is normal (`?ts=12:34`); only colons in the
      // path's first segment indicate a scheme.
      expect(safeRedirect('/dashboard/foo?ts=12:34', FALLBACK)).toBe('/dashboard/foo?ts=12:34');
    });
  });

  describe('backslash-bearing paths fall back', () => {
    it('returns fallback for a path containing a backslash', () => {
      // Some browsers normalize `\\evil.com` to `//evil.com`. Reject any
      // backslash anywhere in the value.
      expect(safeRedirect('/\\evil.com', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for a path with backslash in the middle', () => {
      expect(safeRedirect('/dashboard\\foo', FALLBACK)).toBe(FALLBACK);
    });

    it('returns fallback for /\\\\evil.com', () => {
      expect(safeRedirect('/\\\\evil.com', FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('fallback is honoured verbatim', () => {
    it('returns the literal fallback value the caller provides', () => {
      expect(safeRedirect(null, '/login')).toBe('/login');
      expect(safeRedirect('', '/custom')).toBe('/custom');
      expect(safeRedirect('http://x.com', '/elsewhere')).toBe('/elsewhere');
    });
  });
});
