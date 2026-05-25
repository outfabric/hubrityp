import { describe, expect, it } from 'vitest';

describe('ai-transcription edge entrypoint', () => {
  it('edge.ts loads without throwing and exposes expected schemas', async () => {
    const edgeModule = await import('@/modules/ai-transcription/edge');

    // Schemas and branded type should be available
    expect(edgeModule.TranscriptionIdSchema).toBeDefined();
    expect(edgeModule.TranscriptionStatusSchema).toBeDefined();
    expect(edgeModule.TranscriptionSourceSchema).toBeDefined();
    expect(edgeModule.TranscriptionTemplateSchema).toBeDefined();
    expect(edgeModule.RiskSensitivitySchema).toBeDefined();
    expect(edgeModule.GeneratedNoteSchema).toBeDefined();
    expect(edgeModule.RiskAlertSchema).toBeDefined();
  });

  it('edge.ts does NOT export logger or pseudonymize (Node-only)', async () => {
    const edgeModule = await import('@/modules/ai-transcription/edge');

    // These should NOT be on the edge entrypoint
    expect(edgeModule).not.toHaveProperty('createTranscriptionLogger');
    expect(edgeModule).not.toHaveProperty('pseudonymizeTranscript');
  });
});

describe('ai-transcription main barrel', () => {
  it('exports pseudonymizeTranscript, createTranscriptionLogger, and schemas', async () => {
    const mainModule = await import('@/modules/ai-transcription');

    expect(mainModule.pseudonymizeTranscript).toBeDefined();
    expect(typeof mainModule.pseudonymizeTranscript).toBe('function');

    expect(mainModule.createTranscriptionLogger).toBeDefined();
    expect(typeof mainModule.createTranscriptionLogger).toBe('function');

    expect(mainModule.GeneratedNoteSchema).toBeDefined();
    expect(mainModule.RiskAlertSchema).toBeDefined();

    // Branded type schema
    expect(mainModule.TranscriptionIdSchema).toBeDefined();
  });
});
