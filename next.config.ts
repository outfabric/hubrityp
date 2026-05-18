import type { NextConfig } from 'next';

// Derive HTTP and WebSocket origins from NEXT_PUBLIC_SUPABASE_URL so that
// GoTrue, REST, Storage, and Realtime connections are permitted by the CSP.
// Falls back to an empty string when the var is absent (CI, storybook, etc.).
function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return '';
  try {
    const { protocol, host } = new URL(raw);
    return `${protocol}//${host}`;
  } catch {
    return '';
  }
}

// When SUPABASE_PUBLIC_URL is set (Docker dev), signed Storage URLs are
// rewritten to this origin before reaching the browser. The CSP must also
// permit it so that <img>/<iframe> loads succeed.
function supabasePublicOrigin(): string {
  const raw = process.env.SUPABASE_PUBLIC_URL;
  if (!raw) return '';
  try {
    const { protocol, host } = new URL(raw);
    return `${protocol}//${host}`;
  } catch {
    return '';
  }
}

function supabaseConnectSrc(): string {
  const origin = supabaseOrigin();
  if (!origin) return '';
  try {
    const { protocol, host } = new URL(origin);
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
      // Supabase Storage signed URLs serve images and PDFs from the project origin.
      // In Docker dev, SUPABASE_PUBLIC_URL is the browser-facing origin (signed
      // URLs are rewritten to it), so it must also be permitted.
      `img-src 'self' data: blob:${supabaseOrigin() ? ` ${supabaseOrigin()}` : ''}${supabasePublicOrigin() ? ` ${supabasePublicOrigin()}` : ''}`,
      `connect-src 'self'${supabaseConnectSrc()}`,
      "font-src 'self' data:",
      // PDF preview iframe loads signed URLs from Supabase Storage
      `frame-src 'self'${supabaseOrigin() ? ` ${supabaseOrigin()}` : ''}${supabasePublicOrigin() ? ` ${supabasePublicOrigin()}` : ''}`,
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js auto-detects `src/app/` as the App Router root, so no `app` config is needed here.
  // pdfkit uses Node's `fs` at runtime to load built-in font metrics (.afm)
  // and must NOT be bundled by Turbopack — keep it as an external require.
  serverExternalPackages: ['pdfkit'],
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
