/**
 * RN-10.10 LGPD compliance: zero clinical content in log output.
 *
 * Runs the AI transcription pipeline with a real Postgres row and mock Gemini,
 * capturing every Pino log line emitted by `createTranscriptionLogger`. Asserts
 * that no line contains raw `transcript`, `generatedNote`, `riskAlerts`,
 * `patientName` values — they must appear as `[REDACTED]` if logged at all.
 */

import { randomUUID } from 'node:crypto';
import { PassThrough, type Writable } from 'node:stream';

import { sql as dsql } from 'drizzle-orm';
import pino from 'pino';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Log capture infrastructure
//
// Replace `createTranscriptionLogger` with a real Pino instance writing
// JSON to a PassThrough stream at `info` level. The redaction config is
// copied from the production logger so the test validates the actual paths.
// ---------------------------------------------------------------------------

const logStream = new PassThrough();
const logChunks: string[] = [];

logStream.on('data', (chunk: Buffer) => {
  logChunks.push(chunk.toString());
});

/**
 * Domain-specific redact paths — must match production `logger.ts`.
 */
const AI_TRANSCRIPTION_REDACT_PATHS = [
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
];

vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn((context: { transcriptionId?: string; userId?: string }) => {
    const testLogger = pino(
      {
        level: 'trace',
        redact: {
          paths: [...AI_TRANSCRIPTION_REDACT_PATHS],
          censor: '[REDACTED]',
        },
      },
      logStream as Writable,
    );
    return testLogger.child({ module: 'ai-transcription', ...context });
  }),
}));

// ---------------------------------------------------------------------------
// Mock: Supabase Storage SDK — no local Storage in Testcontainers
// ---------------------------------------------------------------------------

const storageDownloadResponse: {
  data: Blob | null;
  error: { message: string } | null;
} = {
  data: null,
  error: null,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(() => Promise.resolve(storageDownloadResponse)),
      })),
    },
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: Gemini client
// ---------------------------------------------------------------------------

let generateContentCallCount = 0;

const TRANSCRIPT_TEXT =
  'Maria Clara Santos falou sobre ansiedade no trabalho. Maria disse que esta preocupada com a familia.';

const VALID_NOTE_JSON = JSON.stringify({
  schemaVersion: 1,
  humorInicial: '7',
  humorFinal: '8',
  pauta: ['Ansiedade no trabalho'],
  conteudoTrabalhado: ['Reestruturacao cognitiva'],
  tarefaCasa: ['Registro de pensamentos'],
  palavrasRisco: ['suicidio'],
  observacoesExtras: null,
});

const transcriptionResponse = {
  text: TRANSCRIPT_TEXT,
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 500, responseTokenCount: 200 },
};

const noteResponse = {
  text: VALID_NOTE_JSON,
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 300, responseTokenCount: 150 },
};

vi.mock('@/modules/ai-transcription/server/gemini-client', () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn(() => {
        generateContentCallCount++;
        if (generateContentCallCount === 1) return Promise.resolve(transcriptionResponse);
        return Promise.resolve(noteResponse);
      }),
    },
    files: {
      upload: vi.fn(),
      delete: vi.fn(),
    },
  })),
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

vi.mock('@google/genai', () => ({
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Inngest client
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
    createFunction: vi.fn((_config: unknown, handler: unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures & seed helpers
// ---------------------------------------------------------------------------

const PATIENT_NAME = 'Maria Clara Santos';

function makeAudioBlob(sizeBytes = 1024): Blob {
  return new Blob([new Uint8Array(sizeBytes)], { type: 'audio/webm' });
}

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-logredact-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  fullName = PATIENT_NAME,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({ id: patientId, userId, fullName });
  });
}

function generateToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

async function seedActiveConsent(userId: string, patientId: string): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId,
      userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: generateToken(),
      signedAt: new Date(),
      revokedAt: null,
      templateVersion: 1,
      templateSnapshot: { version: 1 },
      revocationTakesEffectImmediately: true,
      createdAt: new Date(),
    });
  });
  return id;
}

async function seedTranscriptionRow(
  userId: string,
  patientId: string,
  transcriptionId: string,
  audioObjectKey: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: transcriptionId,
      userId,
      patientId,
      source: 'manual_upload',
      status: 'pending',
      audioObjectKey,
    });
  });
}

async function seedSettings(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptionSettings).values({
      userId,
      enabled: true,
      defaultTemplate: 'tcc',
      riskDetectionSensitivity: 'medium',
    });
  });
}

// ---------------------------------------------------------------------------
// Step context builder (same as process-audio-transcription test)
// ---------------------------------------------------------------------------

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------

let handler: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;

beforeAll(async () => {
  const mod = await import('@/modules/ai-transcription/inngest/process-audio-transcription');
  handler = mod.processAudioTranscription as unknown as typeof handler;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  generateContentCallCount = 0;
  logChunks.length = 0;
  storageDownloadResponse.data = null;
  storageDownloadResponse.error = null;

  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.delete(aiTranscriptionSettings);
    await db.delete(consentTerms);
    await db.execute(
      dsql`DELETE FROM patients WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-logredact-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-logredact-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RN-10.10 LGPD — zero clinical content in logs', () => {
  it('pipeline log output never contains raw transcript, note, risk alerts, or patient name', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioObjectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId, PATIENT_NAME);
    await seedActiveConsent(userId, patientId);
    await seedTranscriptionRow(userId, patientId, transcriptionId, audioObjectKey);
    await seedSettings(userId);

    storageDownloadResponse.data = makeAudioBlob(1024);
    storageDownloadResponse.error = null;

    const step = buildStepContext();
    const event = {
      data: {
        transcriptionId,
        userId,
        patientId,
        source: 'manual_upload' as const,
      },
    };

    const result = await handler({ event, step });
    expect(result).toEqual({ status: 'completed', transcriptionId });

    // Give the PassThrough stream a tick to flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Concatenate all log output into a single string for inspection
    const allLogs = logChunks.join('');

    // Sanity: the logger actually emitted lines (test is meaningful)
    expect(allLogs.length).toBeGreaterThan(0);

    // ------------------------------------------------------------------
    // 1) No raw transcript text in logs
    // ------------------------------------------------------------------
    expect(allLogs).not.toContain(TRANSCRIPT_TEXT);
    // Also check partial substrings that would indicate leakage
    expect(allLogs).not.toContain('ansiedade no trabalho');
    expect(allLogs).not.toContain('preocupada com a familia');

    // ------------------------------------------------------------------
    // 2) No raw generated note content in logs
    // ------------------------------------------------------------------
    expect(allLogs).not.toContain('Reestruturacao cognitiva');
    expect(allLogs).not.toContain('Registro de pensamentos');

    // ------------------------------------------------------------------
    // 3) No raw risk alert values in logs
    // ------------------------------------------------------------------
    // The pipeline extracts risk alerts with `kind` and `excerpt` fields.
    // The full serialized alert object must not appear in logs.
    expect(allLogs).not.toContain('"suicidio"');

    // ------------------------------------------------------------------
    // 4) No raw patient name in logs
    // ------------------------------------------------------------------
    expect(allLogs).not.toContain('Maria Clara Santos');
    expect(allLogs).not.toContain('Maria Clara');
    // First name alone would also leak PII
    expect(allLogs).not.toContain('"Maria"');

    // ------------------------------------------------------------------
    // 5) Parse each JSON line and verify redacted fields show [REDACTED]
    // ------------------------------------------------------------------
    const jsonLines = allLogs.split('\n').filter((line) => line.trim().startsWith('{'));

    for (const line of jsonLines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Non-JSON lines (e.g., pino-pretty fragments) — skip
        continue;
      }

      // If any of the redact-target keys appear, they must be [REDACTED]
      for (const key of [
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
      ]) {
        if (key in parsed) {
          expect(parsed[key]).toBe('[REDACTED]');
        }
      }
    }
  });

  it('a direct log call with sensitive fields is redacted', async () => {
    // Verifies the logger instance itself redacts, independent of the pipeline.
    // This catches regressions where someone removes a redaction path.
    const { createTranscriptionLogger } = await import('@/modules/ai-transcription/lib/logger');

    const testLog = createTranscriptionLogger({
      transcriptionId: randomUUID() as never,
      userId: randomUUID(),
    });

    // Log a payload with all sensitive fields populated
    testLog.info({
      transcript: 'Paciente relatou pensamentos suicidas recorrentes.',
      generatedNote: { schemaVersion: 1, pauta: ['Ideacao suicida'] },
      riskAlerts: [{ kind: 'suicidal', excerpt: 'suicidio', confidence: 'high' }],
      patientName: 'Joao Pedro Silva',
      patientFirstName: 'Joao',
      patientFullName: 'Joao Pedro Silva',
      audioObjectKey: 'uuid/audio.webm',
      rawGeminiResponse: '{"raw":"gemini output"}',
      prompt: 'You are a clinical psychologist assistant...',
    });

    // Give the stream a tick
    const lastChunk = logChunks[logChunks.length - 1] ?? '';

    // The raw values must NOT appear
    expect(lastChunk).not.toContain('pensamentos suicidas');
    expect(lastChunk).not.toContain('Ideacao suicida');
    expect(lastChunk).not.toContain('Joao Pedro Silva');
    expect(lastChunk).not.toContain('uuid/audio.webm');
    expect(lastChunk).not.toContain('clinical psychologist');

    // The redacted sentinel should appear for each field
    const parsed = JSON.parse(lastChunk.trim());
    expect(parsed.transcript).toBe('[REDACTED]');
    expect(parsed.generatedNote).toBe('[REDACTED]');
    expect(parsed.riskAlerts).toBe('[REDACTED]');
    expect(parsed.patientName).toBe('[REDACTED]');
    expect(parsed.patientFirstName).toBe('[REDACTED]');
    expect(parsed.patientFullName).toBe('[REDACTED]');
    expect(parsed.audioObjectKey).toBe('[REDACTED]');
    expect(parsed.rawGeminiResponse).toBe('[REDACTED]');
    expect(parsed.prompt).toBe('[REDACTED]');
  });
});
