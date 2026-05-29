import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import type { TranscriptionId } from '@/modules/ai-transcription';
import { Badge } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Minimal projection of an `ai_transcriptions` row the card needs to surface
 * the "Nota IA" badge. The parent is expected to provide this from a batched
 * query that already filtered to the "pending review" bucket
 * (`status='ready' AND saved_to_prontuario=false`) — the card never queries
 * the DB itself, keeping it a pure presentational leaf.
 */
export interface ReadyTranscriptionRef {
  id: TranscriptionId;
}

interface SessionCardProps {
  /**
   * A transcription awaiting review for this session, if any. When `null`/
   * `undefined` the badge is not rendered. The parent passes the first row
   * matching `status='ready' AND saved_to_prontuario=false`.
   */
  readyTranscription?: ReadyTranscriptionRef | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReviewHref(transcriptionId: TranscriptionId): string {
  return `/dashboard/transcricoes/${transcriptionId}/revisar`;
}

// ---------------------------------------------------------------------------
// Component (Server Component — no 'use client')
// ---------------------------------------------------------------------------

/**
 * Agenda session card surface. Currently it only owns the AI-transcription
 * affordance: when a session has a transcription ready for review, it renders
 * a brand `Badge` linking to the review page.
 *
 * Design System Salvia (D10):
 *   - Badge variant `brand` (brand-100 bg + brand-700 text)
 *   - `Sparkles` Lucide icon at 14px (the fixed concept→icon for "IA")
 *   - Label "Nota IA" (no emoji — Salvia prohibits emojis in product UI)
 *   - Clickable link → `/dashboard/transcricoes/<id>/revisar`
 *   - Keyboard-focusable with a visible `shadow-focus` ring
 *   - `aria-label="Nota IA pronta para revisão"` for screen readers
 */
export function SessionCard({ readyTranscription }: SessionCardProps) {
  if (!readyTranscription) {
    return null;
  }

  return (
    <Link
      href={buildReviewHref(readyTranscription.id)}
      aria-label="Nota IA pronta para revisão"
      data-testid="session-card-ai-badge"
      className="focus-visible:shadow-focus rounded-full focus:outline-none"
    >
      <Badge variant="brand" className="gap-1">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Nota IA
      </Badge>
    </Link>
  );
}
