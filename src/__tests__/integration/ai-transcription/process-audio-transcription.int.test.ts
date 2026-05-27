import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock: Supabase Storage SDK — no local Storage in Testcontainers
// ---------------------------------------------------------------------------

const storageDownloadCalls: Array<{ bucket: string; path: string }> = [];
const storageDownloadResponse: { data: Blob | null; error: { message: string } | null } = {
  data: null,
  error: null,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn((bucket: string) => ({
        download: vi.fn((path: string) => {
          storageDownloadCalls.push({ bucket, path });
          return Promise.resolve(storageDownloadResponse);
        }),
      })),
    },
    // Realtime mock for broadcastAiReady
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: Gemini client — intercept generateContent and files API
// ---------------------------------------------------------------------------

const geminiGenerateContentCalls: Array<{ model: string; contents: unknown; config: unknown }> = [];
let transcriptionResponse: {
  text: string | undefined;
  candidates: Array<{ finishReason: string }>;
  usageMetadata: { promptTokenCount: number; responseTokenCount: number };
};
let noteResponse: {
  text: string | undefined;
  candidates: Array<{ finishReason: string }>;
  usageMetadata: { promptTokenCount: number; responseTokenCount: number };
};
let generateContentCallCount = 0;

const mockFilesUpload = vi.fn();
const mockFilesDelete = vi.fn();

vi.mock('@/modules/ai-transcription/server/gemini-client', () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn((params: { model: string; contents: unknown; config: unknown }) => {
        geminiGenerateContentCalls.push(params);
        generateContentCallCount++;
        // First call is transcription, second is note generation
        if (generateContentCallCount === 1) return Promise.resolve(transcriptionResponse);
        return Promise.resolve(noteResponse);
      }),
    },
    files: {
      upload: mockFilesUpload,
      delete: mockFilesDelete,
    },
  })),
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: {
    BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Gemini SDK exports
// ---------------------------------------------------------------------------

vi.mock('@google/genai', () => ({
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
  HarmBlockThreshold: {
    BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Inngest client — capture sends
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
    createFunction: vi.fn((_config: unknown, handler: unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NOTE_JSON = JSON.stringify({
  schemaVersion: 1,
  humorInicial: '7',
  humorFinal: '8',
  pauta: ['Ansiedade no trabalho'],
  conteudoTrabalhado: ['Reestruturacao cognitiva'],
  tarefaCasa: ['Registro de pensamentos'],
  palavrasRisco: [],
  observacoesExtras: null,
});

function makeAudioBlob(sizeBytes = 1024): Blob {
  const buf = new Uint8Array(sizeBytes);
  return new Blob([buf], { type: 'audio/webm' });
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-pipeline-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  fullName = 'Maria Clara Santos',
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName,
    });
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

async function seedSettings(
  userId: string,
  template = 'tcc',
  sensitivity = 'medium',
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptionSettings).values({
      userId,
      enabled: true,
      defaultTemplate: template,
      riskDetectionSensitivity: sensitivity,
    });
  });
}

async function revokeConsent(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db
      .update(consentTerms)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(consentTerms.userId, userId),
          eq(consentTerms.patientId, patientId),
          eq(consentTerms.kind, 'ai_recording'),
        ),
      );
  });
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
  geminiGenerateContentCalls.length = 0;
  storageDownloadCalls.length = 0;
  generateContentCallCount = 0;
  mockFilesUpload.mockReset();
  mockFilesDelete.mockReset();
  storageDownloadResponse.data = null;
  storageDownloadResponse.error = null;

  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.delete(aiTranscriptionSettings);
    await db.delete(consentTerms);
    // Use TRUNCATE CASCADE to handle FK constraints from other tables (evolutions, etc.)
    await db.execute(
      dsql`DELETE FROM patients WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-pipeline-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-pipeline-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Step context builder
// ---------------------------------------------------------------------------

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processAudioTranscription — integration (real Postgres + mock Gemini)', () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('completes end-to-end: consent check, transcribe, pseudonymize, generate note, persist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioObjectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Clara Santos');
    await seedActiveConsent(userId, patientId);
    await seedTranscriptionRow(userId, patientId, transcriptionId, audioObjectKey);
    await seedSettings(userId, 'tcc', 'medium');

    // Mock storage download
    storageDownloadResponse.data = makeAudioBlob(1024);
    storageDownloadResponse.error = null;

    // Mock Gemini transcription response — includes patient name
    transcriptionResponse = {
      text: 'Maria Clara Santos falou sobre ansiedade no trabalho. Maria disse que esta preocupada.',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 500, responseTokenCount: 200 },
    };

    // Mock Gemini note response
    noteResponse = {
      text: VALID_NOTE_JSON,
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 300, responseTokenCount: 150 },
    };

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

    // Verify DB row was updated to 'ready'
    const { sql: sqlClient, db } = openClient();
    try {
      const [row] = await db
        .select({
          status: aiTranscriptions.status,
          generatedNote: aiTranscriptions.generatedNote,
          riskAlerts: aiTranscriptions.riskAlerts,
          templateUsed: aiTranscriptions.templateUsed,
          completedAt: aiTranscriptions.completedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(row).toBeDefined();
      expect(row!.status).toBe('ready');
      expect(row!.generatedNote).toBeDefined();
      expect(row!.templateUsed).toContain('tcc');
      expect(row!.completedAt).toBeInstanceOf(Date);
    } finally {
      await sqlClient.end();
    }

    // Verify pseudonymization: the note generation call should NOT contain "Maria" or "Santos"
    expect(geminiGenerateContentCalls).toHaveLength(2);
    const noteCall = geminiGenerateContentCalls[1]!;
    const noteContents =
      typeof noteCall.contents === 'string' ? noteCall.contents : JSON.stringify(noteCall.contents);
    expect(noteContents).not.toContain('Maria');
    expect(noteContents).not.toContain('Clara');
    expect(noteContents).not.toContain('Santos');
    expect(noteContents).toContain('Paciente');
  });

  // -----------------------------------------------------------------------
  // Consent revoked between step 1 and step 8
  // -----------------------------------------------------------------------

  it('aborts when consent is revoked before the pipeline starts', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioObjectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedTranscriptionRow(userId, patientId, transcriptionId, audioObjectKey);

    // Revoke consent before pipeline runs
    await revokeConsent(userId, patientId);

    storageDownloadResponse.data = makeAudioBlob();
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

    await expect(handler({ event, step })).rejects.toThrow('CONSENT_INACTIVE');

    // Verify no status transition happened
    const { sql: sqlClient, db } = openClient();
    try {
      const [row] = await db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      // Status should still be 'pending' — no writes after consent check
      expect(row!.status).toBe('pending');
    } finally {
      await sqlClient.end();
    }

    // Verify no Gemini calls were made
    expect(geminiGenerateContentCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Invalid JSON from Gemini
  // -----------------------------------------------------------------------

  it('throws retriable error when Gemini returns invalid JSON', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioObjectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Name');
    await seedActiveConsent(userId, patientId);
    await seedTranscriptionRow(userId, patientId, transcriptionId, audioObjectKey);
    await seedSettings(userId, 'livre', 'medium');

    storageDownloadResponse.data = makeAudioBlob();
    storageDownloadResponse.error = null;

    transcriptionResponse = {
      text: 'Transcript text here.',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, responseTokenCount: 50 },
    };

    // Return invalid JSON
    noteResponse = {
      text: 'This is not JSON at all, sorry!',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 200, responseTokenCount: 100 },
    };

    const step = buildStepContext();
    const event = {
      data: { transcriptionId, userId, patientId, source: 'manual_upload' as const },
    };

    await expect(handler({ event, step })).rejects.toThrow('invalid_response_schema');
  });

  // -----------------------------------------------------------------------
  // Safety block from Gemini
  // -----------------------------------------------------------------------

  it('throws NonRetriableError when Gemini returns safety block', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioObjectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Name');
    await seedActiveConsent(userId, patientId);
    await seedTranscriptionRow(userId, patientId, transcriptionId, audioObjectKey);

    storageDownloadResponse.data = makeAudioBlob();
    storageDownloadResponse.error = null;

    // Transcription returns safety block
    transcriptionResponse = {
      text: undefined,
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 100, responseTokenCount: 0 },
    };

    const step = buildStepContext();
    const event = {
      data: { transcriptionId, userId, patientId, source: 'manual_upload' as const },
    };

    await expect(handler({ event, step })).rejects.toThrow('GEMINI_SAFETY_BLOCK');
  });
});
