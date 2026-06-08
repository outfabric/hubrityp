// Allowlist parser that maps a deep-link `status` query param onto the initial
// tab of the AI-transcription review list (design D1, RF-12.03/RF-12.16,
// RNF-12.05).
//
// SECURITY: the input here is a raw search param (`string | string[] |
// undefined`) controlled by whoever crafts the URL. This parser treats it as
// fully untrusted: it never throws, never reflects the raw value, and always
// collapses to a known-safe member of `TRANSCRIPTION_TABS`. Only the closed
// allowlist below produces a non-default result.

export const TRANSCRIPTION_TABS = ['pending', 'reviewed', 'failed'] as const;
export type TranscriptionTab = (typeof TRANSCRIPTION_TABS)[number];

// Closed allowlist: only `status=ready` deep-links to the `pending` tab. Any
// other value falls through to the default.
const STATUS_TO_TAB: Readonly<Record<string, TranscriptionTab>> = { ready: 'pending' };

export const DEFAULT_TRANSCRIPTION_TAB: TranscriptionTab = 'pending';

export function resolveInitialTabFromStatus(raw: string | string[] | undefined): TranscriptionTab {
  // Reject anything that is not a single string (covers `undefined` and the
  // repeated-param `string[]` case that Next.js produces for `?status=a&status=b`).
  if (typeof raw !== 'string') return DEFAULT_TRANSCRIPTION_TAB;
  return STATUS_TO_TAB[raw] ?? DEFAULT_TRANSCRIPTION_TAB;
}
