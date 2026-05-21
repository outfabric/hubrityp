import '@testing-library/jest-dom/vitest';

// Polyfill ResizeObserver for jsdom — required by Radix UI primitives
// (Select, Switch, Dialog) that use `@radix-ui/react-use-size` internally.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Polyfill pointer capture and scrollIntoView for jsdom — required by
// Radix UI primitives (Select, Slider) that call these methods internally.
if (typeof HTMLElement !== 'undefined') {
  const proto = HTMLElement.prototype;
  if (!('hasPointerCapture' in proto)) {
    Object.defineProperty(proto, 'hasPointerCapture', { value: () => false });
  }
  if (!('setPointerCapture' in proto)) {
    Object.defineProperty(proto, 'setPointerCapture', { value: () => {} });
  }
  if (!('releasePointerCapture' in proto)) {
    Object.defineProperty(proto, 'releasePointerCapture', { value: () => {} });
  }
  if (!('scrollIntoView' in proto)) {
    Object.defineProperty(proto, 'scrollIntoView', { value: () => {} });
  }
}

// Unit tests run with NODE_ENV=test (set by Vitest) so the logger stays
// silent. They also need a baseline of valid env vars in case something
// pulls `src/shared/env/index.ts` during a test (the schema fails fast otherwise).
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-service-key';
// Stream SDK — dummy values so the Zod env validation passes when a test
// transitively imports `serverEnv` or `clientEnv`.
process.env.NEXT_PUBLIC_STREAM_API_KEY ??= 'unit-test-stream-public-key';
process.env.STREAM_API_KEY ??= 'unit-test-stream-api-key';
process.env.STREAM_API_SECRET ??= 'unit-test-stream-api-secret';

// The Edge-safe logger used by `src/middleware.ts` runs outside the pino
// pipeline (Edge runtime can't load pino's transport), so silencing pino
// alone leaves middleware-decision lines visible. Flip the global silence
// flag so test output stays focused on assertion failures.
globalThis.__EDGE_LOGGER_SILENT = true;
