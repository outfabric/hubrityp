'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useCallback, useId } from 'react';

import type { Phase } from '@/modules/medical-records/lib/treatment-plan-schemas';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PhasesListProps {
  /** Current array of phases. */
  phases: Phase[];
  /** Callback when phases change (add, remove, edit, reorder). */
  onChange: (phases: Phase[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Editable list of treatment phases for the treatment plan.
 *
 * Each phase has:
 * - title (Input)
 * - description (Textarea)
 * - completed (Checkbox)
 * - up/down reorder buttons
 * - remove button with AlertDialog confirmation
 *
 * "Adicionar fase" ghost button at the bottom adds a new empty phase.
 * Keyboard accessible: Tab through items, arrow buttons for reorder.
 */
export function PhasesList({ phases, onChange }: PhasesListProps) {
  const baseId = useId();

  const handleAdd = useCallback(() => {
    const maxOrder = phases.reduce((max, p) => Math.max(max, p.order), -1);
    const newPhase: Phase = {
      id: crypto.randomUUID(),
      title: '',
      description: '',
      order: maxOrder + 1,
      completed: false,
    };
    onChange([...phases, newPhase]);
  }, [phases, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(phases.filter((p) => p.id !== id));
    },
    [phases, onChange],
  );

  const handleUpdate = useCallback(
    (id: string, patch: Partial<Pick<Phase, 'title' | 'description' | 'completed'>>) => {
      onChange(phases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [phases, onChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const updated = [...phases];
      const temp = updated[index - 1]!;
      updated[index - 1] = { ...updated[index]!, order: temp.order };
      updated[index] = { ...temp, order: updated[index]!.order };
      updated.sort((a, b) => a.order - b.order);
      onChange(updated);
    },
    [phases, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= phases.length - 1) return;
      const updated = [...phases];
      const temp = updated[index + 1]!;
      updated[index + 1] = { ...updated[index]!, order: temp.order };
      updated[index] = { ...temp, order: updated[index]!.order };
      updated.sort((a, b) => a.order - b.order);
      onChange(updated);
    },
    [phases, onChange],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="phases-list">
      {phases.map((phase, index) => {
        const titleId = `${baseId}-phase-title-${index}`;
        const descId = `${baseId}-phase-desc-${index}`;
        const completedId = `${baseId}-phase-completed-${index}`;
        const hasTitleError = phase.title.trim() === '';

        return (
          <div
            key={phase.id}
            className="border-border bg-surface rounded-lg border p-4"
            data-testid={`phase-item-${index}`}
          >
            <div className="flex flex-col gap-3">
              {/* Title + completed row */}
              <div className="flex items-start gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor={titleId}>Titulo da fase</Label>
                  <Input
                    id={titleId}
                    value={phase.title}
                    onChange={(e) => handleUpdate(phase.id, { title: e.target.value })}
                    placeholder="Ex: Fase de estabilizacao..."
                    aria-invalid={hasTitleError}
                  />
                  {hasTitleError && (
                    <span className="text-danger-700 text-xs" role="alert">
                      Titulo obrigatorio
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-7">
                  <Checkbox
                    id={completedId}
                    checked={phase.completed}
                    onCheckedChange={(checked) =>
                      handleUpdate(phase.id, { completed: checked === true })
                    }
                  />
                  <Label htmlFor={completedId} className="text-xs">
                    Concluida
                  </Label>
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={descId}>Descricao</Label>
                <Textarea
                  id={descId}
                  value={phase.description}
                  onChange={(e) => handleUpdate(phase.id, { description: e.target.value })}
                  placeholder="Descreva os objetivos e atividades desta fase..."
                  className="min-h-[60px]"
                />
              </div>

              {/* Reorder + remove actions */}
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={index === 0}
                  onClick={() => handleMoveUp(index)}
                  aria-label={`Mover fase ${index + 1} para cima`}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={index >= phases.length - 1}
                  onClick={() => handleMoveDown(index)}
                  aria-label={`Mover fase ${index + 1} para baixo`}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-text-tertiary hover:text-danger-700 h-8 w-8 p-0"
                      aria-label={`Remover fase ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover fase</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tem certeza que deseja remover esta fase? Esta acao nao pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRemove(phase.id)}>
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 self-start"
        onClick={handleAdd}
        data-testid="phases-add-button"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Adicionar fase
      </Button>
    </div>
  );
}
