import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @google/genai before the module under test is imported.
// We use a class stub that records the constructor arg so we can assert on it.
const mockGoogleGenAI = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

// Mock serverEnv to provide a deterministic API key without requiring real env.
vi.mock('@/shared/env', () => ({
  serverEnv: { GEMINI_API_KEY: 'test-gemini-key-123' },
}));

describe('getGeminiClient', () => {
  beforeEach(() => {
    // Reset the module registry between tests so the singleton is fresh.
    vi.resetModules();
    mockGoogleGenAI.mockClear();
  });

  it('returns the same instance across multiple calls (singleton)', async () => {
    const { getGeminiClient } = await import('@/modules/ai-transcription/server/gemini-client');

    const first = getGeminiClient();
    const second = getGeminiClient();

    expect(first).toBe(second);
    // Constructor should only have been called once.
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);
    expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-key-123' });
  });

  it('creates a new instance after module re-import (fresh singleton per module load)', async () => {
    const mod1 = await import('@/modules/ai-transcription/server/gemini-client');
    mod1.getGeminiClient();
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);

    // Reset modules to simulate a fresh process (singleton is module-scoped).
    vi.resetModules();
    mockGoogleGenAI.mockClear();

    const mod2 = await import('@/modules/ai-transcription/server/gemini-client');
    mod2.getGeminiClient();
    expect(mockGoogleGenAI).toHaveBeenCalledTimes(1);
  });

  it('is guarded by server-only (source file contains the import)', () => {
    // The `server-only` package throws at import time when bundled for the
    // client, preventing accidental inclusion in the browser bundle. In tests
    // we alias it to a no-op stub (see vitest.config.ts), so we verify the
    // guard at the source level: the first meaningful line must be
    // `import 'server-only'`.
    const srcPath = path.resolve(
      __dirname,
      '../../../../../modules/ai-transcription/server/gemini-client.ts',
    );
    const source = fs.readFileSync(srcPath, 'utf-8');

    // The import must be present and must be the first import statement.
    const lines = source.split('\n').filter((l) => l.trim().length > 0);
    const firstNonEmpty = lines[0]?.trim();
    expect(firstNonEmpty).toBe("import 'server-only';");
  });
});
