'use client';

/**
 * EditScopeDialog — reusable modal for choosing the scope of a recurring
 * session edit (or cancellation).
 *
 * Follows the Google Calendar "edit recurring event" pattern with three scope
 * options: "this", "this_and_future", "all". The parent controls open state
 * and handles the selected scope via the `onSelect` callback.
 *
 * Design System Salvia:
 *   - AlertDialog: max-width 480px, radius `2xl`, padding `space-8`
 *   - Title h3 (18px/600)
 *   - Description body `text-secondary`
 *   - 3 stacked Button secondary, full-width, text-left, gap `space-3`
 *   - Each button: padding `space-3 space-4`, radius `lg`
 *   - Cancel: Button ghost "Cancelar"
 *   - Focus trapped; Escape closes
 */

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';

import type { EditScope } from '../lib/compute-edit-scope';

// ---------------------------------------------------------------------------
// Scope option definitions
// ---------------------------------------------------------------------------

interface ScopeOption {
  value: EditScope;
  label: string;
  subtitle: string;
}

const SCOPE_OPTIONS: readonly ScopeOption[] = [
  {
    value: 'this',
    label: 'Apenas esta sessão',
    subtitle: 'As demais sessões da série não serão alteradas',
  },
  {
    value: 'this_and_future',
    label: 'Esta e todas as próximas',
    subtitle: 'Sessões anteriores permanecem como estão',
  },
  {
    value: 'all',
    label: 'Toda a série',
    subtitle: 'Todas as sessões futuras serão atualizadas',
  },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EditScopeDialogProps {
  /** Whether the dialog is open. Controlled by the parent. */
  open: boolean;
  /** Called when the dialog requests to close (cancel, escape, click outside). */
  onOpenChange: (open: boolean) => void;
  /** Called when the user selects a scope. */
  onSelect: (scope: EditScope) => void;
  /** Dialog title — defaults to "Editar sessão recorrente". */
  title?: string;
  /** Dialog description — defaults to a generic edit description. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditScopeDialog({
  open,
  onOpenChange,
  onSelect,
  title = 'Editar sessão recorrente',
  description = 'Escolha o escopo da alteração para esta sessão recorrente.',
}: EditScopeDialogProps) {
  function handleScopeClick(scope: EditScope) {
    onSelect(scope);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="edit-scope-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3" role="group" aria-label="Escopo da edição">
          {SCOPE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant="secondary"
              data-testid={`scope-${option.value}`}
              className="h-auto w-full items-start justify-start rounded-lg px-4 py-3 text-left"
              onClick={() => handleScopeClick(option.value)}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-text-primary text-sm font-medium">{option.label}</span>
                <span className="text-text-tertiary text-xs font-normal">{option.subtitle}</span>
              </div>
            </Button>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="ghost" data-testid="scope-cancel">
              Cancelar
            </Button>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
