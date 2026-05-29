import { AlertTriangle } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';

export interface DraftWarningBannerProps {
  className?: string;
}

/**
 * Persistent warning shown while an AI-generated note is awaiting human review
 * (`status === 'ready'`). It reminds the psychologist that clinical
 * responsibility for the final content stays with them (RF-10.15).
 *
 * Pure presentational component (no hooks/events) so it is safe in a Server
 * Component. Rendered `sticky` at the top of the review surface so the warning
 * stays visible as the form scrolls. The `AlertTriangle` icon is decorative —
 * the message text already carries the meaning — so it is `aria-hidden`.
 */
export function DraftWarningBanner({ className }: DraftWarningBannerProps) {
  return (
    <Alert
      variant="warning"
      data-testid="draft-warning-banner"
      className={cn('sticky top-0 z-10', className)}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        Esta nota foi gerada por IA. Revise-a antes de salvar — você é responsável pelo conteúdo
        final.
      </AlertDescription>
    </Alert>
  );
}
