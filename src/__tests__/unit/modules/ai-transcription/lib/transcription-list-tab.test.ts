import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_TAB,
  resolveInitialTabFromStatus,
} from '@/modules/ai-transcription/lib/transcription-list-tab';

describe('resolveInitialTabFromStatus', () => {
  it("maps the allowlisted 'ready' status to the 'pending' tab", () => {
    expect(resolveInitialTabFromStatus('ready')).toBe('pending');
  });

  it('returns the default tab when the param is undefined', () => {
    expect(resolveInitialTabFromStatus(undefined)).toBe(DEFAULT_TRANSCRIPTION_TAB);
    expect(DEFAULT_TRANSCRIPTION_TAB).toBe('pending');
  });

  it('returns the default tab for an unknown status', () => {
    expect(resolveInitialTabFromStatus('xyz')).toBe('pending');
  });

  it('returns the default tab for an empty string', () => {
    expect(resolveInitialTabFromStatus('')).toBe('pending');
  });

  it('returns the default tab for a repeated (array) param', () => {
    expect(resolveInitialTabFromStatus(['ready', 'reviewed'])).toBe('pending');
  });
});
