import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { serverEnv } from '@/shared/env';

// Singleton Gemini SDK client. Instantiated lazily on first call so the module
// can be imported without side-effects during testing (the env is only read
// when `getGeminiClient()` is actually invoked).
let client: GoogleGenAI | null = null;

/**
 * Returns the singleton `GoogleGenAI` client configured with the project's
 * `GEMINI_API_KEY`. Safe to call from any server-side code path (Server
 * Actions, Route Handlers, Inngest functions).
 *
 * The client is created once and reused for the lifetime of the process,
 * avoiding redundant allocations.
 */
export function getGeminiClient(): GoogleGenAI {
  if (client === null) {
    client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
  }
  return client;
}
