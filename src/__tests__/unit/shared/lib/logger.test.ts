import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { redactPaths } from '@/shared/lib/logger';

interface CapturedEntry {
  user?: { email?: string; cpf?: string };
  token?: string;
  note?: string;
  msg?: string;
  [key: string]: unknown;
}

function makeCapturingLogger() {
  const entries: CapturedEntry[] = [];
  const logger = pino(
    {
      level: 'debug',
      redact: { paths: redactPaths, censor: '[Redacted]' },
    },
    {
      write(line: string): void {
        entries.push(JSON.parse(line) as CapturedEntry);
      },
    },
  );
  return { logger, entries };
}

describe('logger redaction', () => {
  it('redacts nested email field', () => {
    const { logger, entries } = makeCapturingLogger();
    logger.info({ user: { email: 'paciente@example.com' } }, 'msg');
    expect(entries[0]?.user?.email).toBe('[Redacted]');
  });

  it('redacts nested cpf field', () => {
    const { logger, entries } = makeCapturingLogger();
    logger.info({ user: { cpf: '12345678900' } }, 'msg');
    expect(entries[0]?.user?.cpf).toBe('[Redacted]');
  });

  it('redacts top-level token field', () => {
    const { logger, entries } = makeCapturingLogger();
    logger.info({ token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig' }, 'msg');
    expect(entries[0]?.token).toBe('[Redacted]');
  });

  it('redacts free-text note field that may carry clinical content', () => {
    const { logger, entries } = makeCapturingLogger();
    logger.info({ note: 'Paciente relatou ansiedade na sessão de hoje.' }, 'msg');
    expect(entries[0]?.note).toBe('[Redacted]');
  });

  it('does not redact safe fields', () => {
    const { logger, entries } = makeCapturingLogger();
    logger.info({ requestId: 'abc-123', user: { id: 'uuid-1' } }, 'msg');
    expect(entries[0]?.requestId).toBe('abc-123');
    expect(entries[0]?.user).toMatchObject({ id: 'uuid-1' });
  });
});
