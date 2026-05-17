'use client';

import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDown, ArrowUp, CalendarIcon, Plus, Trash2 } from 'lucide-react';
import { useCallback, useId, useState } from 'react';

import type { Goal } from '@/modules/medical-records/lib/treatment-plan-schemas';
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
import { Calendar } from '@/shared/ui/calendar';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GoalsListProps {
  /** Current array of goals. */
  goals: Goal[];
  /** Callback when goals change (add, remove, edit, reorder). */
  onChange: (goals: Goal[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Editable list of therapeutic goals for the treatment plan.
 *
 * Each goal has:
 * - description (multiline textarea)
 * - target_date (shadcn Calendar in Popover)
 * - up/down reorder buttons
 * - remove button with AlertDialog confirmation
 *
 * "Adicionar objetivo" ghost button at the bottom adds a new empty goal.
 * Keyboard accessible: Tab through items, arrow buttons for reorder.
 */
export function GoalsList({ goals, onChange }: GoalsListProps) {
  const baseId = useId();

  const handleAdd = useCallback(() => {
    const maxOrder = goals.reduce((max, g) => Math.max(max, g.order), -1);
    const newGoal: Goal = {
      id: crypto.randomUUID(),
      description: '',
      targetDate: null,
      order: maxOrder + 1,
    };
    onChange([...goals, newGoal]);
  }, [goals, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(goals.filter((g) => g.id !== id));
    },
    [goals, onChange],
  );

  const handleUpdate = useCallback(
    (id: string, patch: Partial<Pick<Goal, 'description' | 'targetDate'>>) => {
      onChange(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },
    [goals, onChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const updated = [...goals];
      const temp = updated[index - 1]!;
      updated[index - 1] = { ...updated[index]!, order: temp.order };
      updated[index] = { ...temp, order: updated[index]!.order };
      // Re-sort by order
      updated.sort((a, b) => a.order - b.order);
      onChange(updated);
    },
    [goals, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= goals.length - 1) return;
      const updated = [...goals];
      const temp = updated[index + 1]!;
      updated[index + 1] = { ...updated[index]!, order: temp.order };
      updated[index] = { ...temp, order: updated[index]!.order };
      // Re-sort by order
      updated.sort((a, b) => a.order - b.order);
      onChange(updated);
    },
    [goals, onChange],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="goals-list">
      {goals.map((goal, index) => {
        const descriptionId = `${baseId}-goal-desc-${index}`;
        const dateId = `${baseId}-goal-date-${index}`;
        const hasError = goal.description.trim() === '';

        return (
          <GoalItem
            key={goal.id}
            goal={goal}
            index={index}
            totalCount={goals.length}
            descriptionId={descriptionId}
            dateId={dateId}
            hasError={hasError}
            onUpdate={handleUpdate}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onRemove={handleRemove}
          />
        );
      })}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 self-start"
        onClick={handleAdd}
        data-testid="goals-add-button"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Adicionar objetivo
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalItem (internal)
// ---------------------------------------------------------------------------

interface GoalItemProps {
  goal: Goal;
  index: number;
  totalCount: number;
  descriptionId: string;
  dateId: string;
  hasError: boolean;
  onUpdate: (id: string, patch: Partial<Pick<Goal, 'description' | 'targetDate'>>) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (id: string) => void;
}

function GoalItem({
  goal,
  index,
  totalCount,
  descriptionId,
  dateId,
  hasError,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
}: GoalItemProps) {
  const [dateOpen, setDateOpen] = useState(false);

  return (
    <div
      className="border-border bg-surface rounded-lg border p-4"
      data-testid={`goal-item-${index}`}
    >
      <div className="flex flex-col gap-3">
        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={descriptionId}>Descricao do objetivo</Label>
          <Textarea
            id={descriptionId}
            value={goal.description}
            onChange={(e) => onUpdate(goal.id, { description: e.target.value })}
            placeholder="Descreva o objetivo terapeutico..."
            aria-invalid={hasError}
            className="min-h-[60px]"
          />
          {hasError && (
            <span className="text-danger-700 text-xs" role="alert">
              Descricao obrigatoria
            </span>
          )}
        </div>

        {/* Target date + actions row */}
        <div className="flex items-end justify-between gap-3">
          {/* Date picker */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dateId}>Data alvo</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={dateId}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 font-normal"
                >
                  <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                  {goal.targetDate
                    ? format(parseISO(goal.targetDate), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
                    : 'Selecionar data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={goal.targetDate ? parseISO(goal.targetDate) : undefined}
                  onSelect={(date) => {
                    if (date) {
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      onUpdate(goal.id, { targetDate: `${year}-${month}-${day}` });
                    } else {
                      onUpdate(goal.id, { targetDate: null });
                    }
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Reorder + remove actions */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={index === 0}
              onClick={() => onMoveUp(index)}
              aria-label={`Mover objetivo ${index + 1} para cima`}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={index >= totalCount - 1}
              onClick={() => onMoveDown(index)}
              aria-label={`Mover objetivo ${index + 1} para baixo`}
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
                  aria-label={`Remover objetivo ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover objetivo</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tem certeza que deseja remover este objetivo? Esta acao nao pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onRemove(goal.id)}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}
