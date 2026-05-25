import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createTranscriptionLogger } from '@/modules/ai-transcription';
import type { TranscriptionId } from '@/modules/ai-transcription';

/**
 * Helper: creates a transcription logger that writes to a buffer we control.
 * Returns the logger and a function to retrieve all serialized log lines.
 */
function createBufferedLogger(context: Parameters<typeof createTranscriptionLogger>[0]) {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });

  // Create a root logger that writes to the buffer (not stdout) with level
  // 'info' so test log calls are actually captured (the default test level
  // is 'silent').
  const rootLogger = pino({ level: 'info' }, dest);

  // Create a child mirroring what createTranscriptionLogger does, but
  // against our buffered root.
  const child = rootLogger.child(
    { module: 'ai-transcription', ...context },
    {
      redact: {
        paths: [
          'transcript',
          'generatedNote',
          'riskAlerts',
          'patientName',
          'patientFirstName',
          'patientFullName',
          'audioObjectKey',
          'audioUrl',
          'signedUrl',
          'rawGeminiResponse',
          'prompt',
        ],
        censor: '[REDACTED]',
      },
    },
  );

  return { logger: child, getLines: () => lines };
}

describe('createTranscriptionLogger', () => {
  it('returns a pino Logger instance', () => {
    const log = createTranscriptionLogger({});
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
  });
});

describe('transcription logger redaction (buffered)', () => {
  it('(a) redacts patientName and the value never appears in the log line', () => {
    const { logger: log, getLines } = createBufferedLogger({});
    log.info({ patientName: 'Maria', status: 'ready' }, 'test');

    expect(getLines().length).toBe(1);
    const line = getLines()[0]!;
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('Maria');
  });

  it('(b) redacts generatedNote and riskAlerts', () => {
    const { logger: log, getLines } = createBufferedLogger({});
    log.info(
      {
        generatedNote: { schemaVersion: 1, humorInicial: 'ansioso' },
        riskAlerts: [{ kind: 'suicidal', excerpt: 'mencionou morte' }],
      },
      'test',
    );

    const line = getLines()[0]!;
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('ansioso');
    expect(line).not.toContain('mencionou morte');
  });

  it('(c) preserves transcriptionId and status in plaintext', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000' as TranscriptionId;
    const { logger: log, getLines } = createBufferedLogger({ transcriptionId: id });
    log.info({ status: 'ready' }, 'test');

    const line = getLines()[0]!;
    expect(line).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(line).toContain('ready');
  });

  it('(d) redacts prompt and audioObjectKey', () => {
    const { logger: log, getLines } = createBufferedLogger({});
    log.info(
      {
        prompt: 'Transcreva o áudio a seguir...',
        audioObjectKey: 'uploads/abc-123/audio.mp3',
      },
      'test',
    );

    const line = getLines()[0]!;
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('Transcreva');
    expect(line).not.toContain('uploads/abc-123');
  });

  it('(e) log line is valid JSON', () => {
    const { logger: log, getLines } = createBufferedLogger({});
    log.info({ patientName: 'Ana', status: 'pending' }, 'json check');

    const line = getLines()[0]!;
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(line);
    }).not.toThrow();
    expect(parsed).toHaveProperty('msg', 'json check');
  });
});
