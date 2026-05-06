import type { NextConfig } from 'next';

// Derive HTTP and WebSocket origins from NEXT_PUBLIC_SUPABASE_URL so that
// GoTrue, REST, and Realtime connections are permitted by the CSP.
// Falls back to an empty string when the var is absent (CI, storybook, etc.).
function supabaseConnectSrc(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return '';
  try {
    const { protocol, host } = new URL(raw);
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return ` ${protocol}//${host} ${wsProtocol}//${host}`;
  } catch {
    return '';
  }
}

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      `connect-src 'self'${supabaseConnectSrc()}`,
      "font-src 'self' data:",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js auto-detects `src/app/` as the App Router root, so no `app` config is needed here.
  // Defense-in-depth: ensure test files never leak into the production bundle even if a stray
  // import sneaks in. Tests are dead code from the bundler's perspective (no route imports them).
  outputFileTracingExcludes: {
    '/**': ['**/__tests__/**'],
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]);
  },
};

export default nextConfig;
