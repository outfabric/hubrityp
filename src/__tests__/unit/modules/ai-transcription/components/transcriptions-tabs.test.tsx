import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TranscriptionId } from '@/modules/ai-transcription';
import type { TranscriptionListBuckets, TranscriptionListItem } from '@/modules/ai-transcription';
import { TranscriptionsTabs } from '@/modules/ai-transcription/components/transcriptions-tabs';

afterEach(() => {
  cleanup();
});

// Minimal valid row per bucket so each tab has content and the global empty
// state never short-circuits this component. The exact card rendering is not
// under test here — we only assert which tab is seeded as active.
function makeItem(overrides: Partial<TranscriptionListItem> = {}): TranscriptionListItem {
  return {
    transcriptionId: '00000000-0000-0000-0000-000000000001' as TranscriptionId,
    status: 'ready',
    templateUsed: 'tcc',
    patientFirstName: 'Ana',
    sessionDate: new Date('2026-06-01T12:00:00Z'),
    createdAt: new Date('2026-06-01T12:00:00Z'),
    ...overrides,
  };
}

const buckets: TranscriptionListBuckets = {
  pending: [makeItem({ status: 'ready' })],
  reviewed: [makeItem({ status: 'reviewed' })],
  failed: [makeItem({ status: 'failed' })],
};

// Radix Tabs marks the active trigger with `data-state="active"`.
function activeTabTestId(): string | null {
  const list = screen.getByTestId('transcriptions-tabs');
  const active = list.querySelector('[role="tab"][data-state="active"]');
  return active?.getAttribute('data-testid') ?? null;
}

describe('TranscriptionsTabs initial tab', () => {
  it('keeps "tab-pending" active when initialTab is omitted', () => {
    render(<TranscriptionsTabs buckets={buckets} />);

    expect(activeTabTestId()).toBe('tab-pending');
  });

  it('keeps "tab-pending" active when initialTab="pending"', () => {
    render(<TranscriptionsTabs buckets={buckets} initialTab="pending" />);

    expect(activeTabTestId()).toBe('tab-pending');
  });

  it('seeds "tab-reviewed" as active when initialTab="reviewed"', () => {
    render(<TranscriptionsTabs buckets={buckets} initialTab="reviewed" />);

    expect(activeTabTestId()).toBe('tab-reviewed');
  });

  it('seeds "tab-failed" as active when initialTab="failed"', () => {
    render(<TranscriptionsTabs buckets={buckets} initialTab="failed" />);

    expect(activeTabTestId()).toBe('tab-failed');
  });
});
