import { AlertTriangle, Check, CheckCircle2, Clock, XCircle } from 'lucide-react';

import type { SessionStatus } from '@/modules/agenda/lib/session-status';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Status → visual mapping
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  SessionStatus,
  {
    label: string;
    variant: 'neutral' | 'success' | 'default' | 'danger' | 'warning';
    Icon: typeof Clock;
  }
> = {
  scheduled: { label: 'Agendada', variant: 'neutral', Icon: Clock },
  confirmed: { label: 'Confirmada', variant: 'success', Icon: CheckCircle2 },
  done: { label: 'Realizada', variant: 'default', Icon: Check },
  cancelled: { label: 'Cancelada', variant: 'danger', Icon: XCircle },
  no_show: { label: 'Falta', variant: 'warning', Icon: AlertTriangle },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionStatusBadgeProps {
  status: SessionStatus;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component (Server Component — no 'use client')
// ---------------------------------------------------------------------------

/**
 * Renders a semantic badge for a session lifecycle status.
 *
 * Design System Salvia:
 *   - Badge height 22px, padding 2px 10px, radius full, font 12px weight 500
 *   - Variant mapped per status: scheduled→neutral, confirmed→success,
 *     done→brand (default), cancelled→danger, no_show→warning
 *   - Lucide icon 16px inline with `aria-hidden="true"`
 */
export function SessionStatusBadge({ status, className }: SessionStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const { Icon } = config;

  return (
    <Badge
      variant={config.variant}
      className={cn('gap-1', className)}
      data-testid={`session-status-badge-${status}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
