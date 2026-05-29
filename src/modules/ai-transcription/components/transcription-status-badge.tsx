import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  type LucideIcon,
} from 'lucide-react';

import type { TranscriptionStatus } from '@/modules/ai-transcription';
import { cn } from '@/shared/lib/utils';
import { Badge, type BadgeProps } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Status -> visual presentation map
//
// Each transcription status maps to a Salvia Badge variant, a pt-BR label, and
// a Lucide icon from the design-system icon map. Processing states collapse to
// a single neutral "Processando" because the user does not need to distinguish
// the internal pipeline stages (pending -> transcribing -> generating).
// ---------------------------------------------------------------------------

type StatusPresentation = {
  readonly variant: NonNullable<BadgeProps['variant']>;
  readonly label: string;
  readonly Icon: LucideIcon;
};

const STATUS_PRESENTATION: Record<TranscriptionStatus, StatusPresentation> = {
  pending: { variant: 'neutral', label: 'Processando', Icon: Loader2 },
  transcribing: { variant: 'neutral', label: 'Processando', Icon: Loader2 },
  generating: { variant: 'neutral', label: 'Processando', Icon: Loader2 },
  ready: { variant: 'info', label: 'Pronta para revisão', Icon: Info },
  reviewed: { variant: 'success', label: 'Salva no prontuário', Icon: CheckCircle2 },
  failed: { variant: 'danger', label: 'Falhou', Icon: AlertCircle },
  cancelled: { variant: 'warning', label: 'Cancelada', Icon: AlertTriangle },
};

export interface TranscriptionStatusBadgeProps {
  status: TranscriptionStatus;
  className?: string;
}

/**
 * Presentational badge that renders the current state of an AI transcription.
 *
 * Pure (no hooks, no events) so it is safe to render in a Server Component.
 * The badge carries the label both as visible text and as an `aria-label` so
 * assistive tech announces it without depending on the decorative icon.
 */
export function TranscriptionStatusBadge({ status, className }: TranscriptionStatusBadgeProps) {
  const { variant, label, Icon } = STATUS_PRESENTATION[status];

  return (
    <Badge
      variant={variant}
      aria-label={label}
      data-testid="transcription-status-badge"
      data-status={status}
      className={cn('gap-1', className)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}
