'use client';

import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  RotateCcw,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useState, useTransition } from 'react';

import { isSessionLocked } from '@/modules/agenda/lib/session-lock';
import {
  getAvailableActions,
  type Action,
  type SessionStatus,
} from '@/modules/agenda/lib/session-status';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Action → icon mapping
// ---------------------------------------------------------------------------

const ACTION_ICON: Record<Action['type'], typeof Check> = {
  confirm: CheckCircle2,
  reschedule: Calendar,
  cancel: XCircle,
  mark_done: Check,
  mark_no_show: AlertTriangle,
  view_record: FileText,
  add_payment: Wallet,
  reactivate: RotateCcw,
  hard_delete: Trash2,
  charge_no_show: Wallet,
};

const ACTION_VARIANT: Record<Action['type'], 'default' | 'secondary' | 'destructive' | 'link'> = {
  confirm: 'default',
  reschedule: 'secondary',
  cancel: 'destructive',
  mark_done: 'default',
  mark_no_show: 'secondary',
  view_record: 'link',
  add_payment: 'link',
  reactivate: 'secondary',
  hard_delete: 'destructive',
  charge_no_show: 'link',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionActionButtonsProps {
  status: SessionStatus;
  session: { updatedAt: Date; deletedAt: Date | null };
  /** Handler map — keyed by action type. Async handlers show loading state. */
  onAction: (actionType: Action['type']) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders status-dependent action buttons for a session.
 *
 * Design System Salvia:
 *   - Button size md (40px height, 15px font)
 *   - Variants per action type: primary for confirm/mark_done, secondary for
 *     reschedule/mark_no_show/reactivate, danger for cancel/hard_delete,
 *     link for view_record/add_payment/charge_no_show
 *   - Locked done sessions (>7 days): shows Alert info with Lock icon
 *   - Loading state on all async buttons
 */
export function SessionActionButtons({ status, session, onAction }: SessionActionButtonsProps) {
  const [isPending, startTransition] = useTransition();
  const [loadingAction, setLoadingAction] = useState<Action['type'] | null>(null);

  const locked = isSessionLocked({ status, updatedAt: session.updatedAt });

  // For done sessions past 7 days, show lock alert instead of action buttons
  if (status === 'done' && locked) {
    return (
      <Alert variant="info" data-testid="session-locked-alert">
        <Lock className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>Sessao bloqueada para edicao apos 7 dias</AlertDescription>
      </Alert>
    );
  }

  const actions = getAvailableActions(status, session);

  function handleClick(actionType: Action['type']) {
    setLoadingAction(actionType);
    startTransition(async () => {
      try {
        await onAction(actionType);
      } finally {
        setLoadingAction(null);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-3" data-testid="session-action-buttons">
      {actions.map((action) => {
        const Icon = ACTION_ICON[action.type];
        const variant = ACTION_VARIANT[action.type];
        const isLoading = isPending && loadingAction === action.type;
        const isDisabled = isPending;

        return (
          <Button
            key={action.type}
            variant={variant}
            disabled={isDisabled}
            onClick={() => handleClick(action.type)}
            data-testid={`action-btn-${action.type}`}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="h-4 w-4" aria-hidden="true" />
            )}
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}
