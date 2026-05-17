'use client';

import { format } from 'date-fns';
import { AlertCircle, Loader2 } from 'lucide-react';

import type { AutoSaveStatus } from '@/modules/patients/lib/use-auto-save';
import { cn } from '@/shared/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AutoSaveIndicatorProps {
  status: AutoSaveStatus;
  lastSavedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the auto-save status for evolution editors.
 *
 * States:
 * - idle/saved with lastSavedAt: "Salvo as HH:MM" in text-tertiary caption
 * - saving: spinner + "Salvando..."
 * - error: AlertCircle icon + "Erro ao salvar" in danger-700
 *
 * Respects `prefers-reduced-motion`: spinner animation is disabled via
 * the `motion-reduce:animate-none` utility.
 */
export function AutoSaveIndicator({ status, lastSavedAt }: AutoSaveIndicatorProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="flex h-5 items-center gap-1.5"
      data-testid="auto-save-indicator"
    >
      {status === 'saving' && (
        <>
          <Loader2
            className={cn('text-text-tertiary h-3.5 w-3.5 animate-spin motion-reduce:animate-none')}
            aria-hidden="true"
          />
          <span className="text-text-tertiary text-xs">Salvando...</span>
        </>
      )}

      {status === 'error' && (
        <>
          <AlertCircle className="text-danger-700 h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-danger-700 text-xs">Erro ao salvar</span>
        </>
      )}

      {(status === 'saved' || status === 'idle') && lastSavedAt && (
        <span className="text-text-tertiary text-xs">Salvo as {format(lastSavedAt, 'HH:mm')}</span>
      )}
    </div>
  );
}
