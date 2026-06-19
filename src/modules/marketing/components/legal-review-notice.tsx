import { Info } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * LegalReviewNotice — the "reference text, review with legal before publishing"
 * banner shown at the top of the public legal pages (Privacy Policy, Terms of
 * Use).
 *
 * The reference legal content shipped with the public site is a placeholder
 * draft; this notice makes that explicit so the draft is never mistaken for a
 * legally-vetted document. Rendered with the design-system `info` semantic
 * token (`info-50` surface + `info-700` text), per the DS rule "texto sobre
 * fundo colorido usa o tom 700 da mesma família".
 *
 * Presentational only — a stateless Server Component (no client hooks, no
 * user-specific data), safe to render in a Server Component page.
 */
export function LegalReviewNotice({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      // `role="note"` announces this as an aside/annotation rather than an
      // alert — it is informational, not an error condition.
      role="note"
      className={cn(
        'bg-info-50 text-info-700 flex items-start gap-3 rounded-xl p-4 text-sm',
        className,
      )}
    >
      {/* Decorative leading icon — the text alone carries the full meaning. */}
      <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <p>Texto de referência — revisar com o jurídico antes de publicar.</p>
    </div>
  );
}

LegalReviewNotice.displayName = 'LegalReviewNotice';
