import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sálvia 3-part empty state for the AI transcription review list.
 *
 * Per `docs/design-system/rules.md` §Padrões UX an empty state always answers
 * three questions:
 *   - what's missing  → headline "Nenhuma transcrição ainda"
 *   - why it matters  → body explaining where notes will appear
 *   - what to do next → primary CTA "Ver pacientes" (link to /dashboard/pacientes)
 *
 * Pure (no hooks, no events) so it renders safely inside the Server Component
 * page. The `Sparkles` icon is the design-system icon for the AI concept and
 * is decorative (`aria-hidden`), the headline carries the meaning for AT.
 */
export function TranscriptionsEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="transcriptions-empty-state"
    >
      <Sparkles className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhuma transcrição ainda</h4>
      <p className="text-text-secondary mb-4 max-w-sm text-sm">
        Quando você enviar um áudio de sessão, as notas geradas aparecerão aqui.
      </p>
      <Button asChild>
        <Link href="/dashboard/pacientes" data-testid="transcriptions-empty-cta">
          Ver pacientes
        </Link>
      </Button>
    </div>
  );
}
