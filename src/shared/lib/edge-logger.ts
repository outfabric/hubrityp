// Edge-runtime-safe structured logger.
//
// Why a separate module from `src/shared/lib/logger.ts`:
//   - The canonical `logger` is a `pino` instance with a `pino-pretty`
//     transport in dev. `pino-pretty` uses `worker_threads`, which the
//     Edge runtime does not expose — importing `logger` inside
//     `src/middleware.ts` would crash the worker at module-instantiation
//     time, before any request is served.
//   - The canonical logger also pulls `serverEnv` (which imports
//     `'server-only'`); `'server-only'` is permitted on Edge but the
//     `process.env.LOG_LEVEL` validation it performs adds startup cost we
//     don't need here.
//
// Surface: a minimal pino-shaped API (`debug`, `info`, `warn`, `error`)
// that emits a single line of JSON via `console.<level>`. Vercel's Edge
// log capture preserves both stdout and stderr structured payloads, so
// downstream tooling (Logflare, Datadog) sees the same shape it sees from
// the Node-side `logger`. The intent is "good enough for grepping a
// middleware decision in dev"; production observability on the Edge can
// be revisited if request volumes warrant it.
//
// Single-knob silence: when `globalThis.__EDGE_LOGGER_SILENT` is `true`,
// every call no-ops. Test setup files (vitest, playwright) flip the flag
// so middleware decisions don't pollute test output. Production never
// touches the flag. We use `globalThis` rather than `process.env` because
// the Edge runtime exposes only a subset of `process.env`, while
// `globalThis` is universally writable.
type LogPayload = Record<string, unknown>;

declare global {
  var __EDGE_LOGGER_SILENT: boolean | undefined;
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', payload: LogPayload, msg: string): void {
  if (globalThis.__EDGE_LOGGER_SILENT) return;

  // Stable, pino-compatible field order for downstream parsers: level,
  // time, msg, then the user payload. `level` is encoded as the numeric
  // code pino uses (10/20/30/40/50) so existing dashboards keep working.
  const levelCode: Record<typeof level, number> = {
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
  };

  const entry = {
    level: levelCode[level],
    time: Date.now(),
    msg,
    ...payload,
  };

  // `console[level]` is the canonical Edge-runtime sink; Vercel maps
  // each level to its dashboard severity column.
  console[level](JSON.stringify(entry));
}

export const edgeLogger = {
  debug(payload: LogPayload, msg: string): void {
    emit('debug', payload, msg);
  },
  info(payload: LogPayload, msg: string): void {
    emit('info', payload, msg);
  },
  warn(payload: LogPayload, msg: string): void {
    emit('warn', payload, msg);
  },
  error(payload: LogPayload, msg: string): void {
    emit('error', payload, msg);
  },
};
