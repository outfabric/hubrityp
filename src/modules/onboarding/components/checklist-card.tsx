'use client';

import { CheckCircle2, ChevronDown, Circle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';

import {
  CHECKLIST_ITEMS,
  isComplete,
  mandatoryCompletePct,
  type ChecklistState,
} from '../lib/checklist-items';

import { ChecklistCelebration } from './checklist-celebration';

/**
 * `ChecklistCard` — the dashboard's first-run onboarding checklist (client leaf).
 *
 * A presentational component: it receives the already-derived {@link ChecklistState}
 * as a prop (the server recomputes it via `recomputeChecklistImpl` and passes it
 * down). It holds NO data-access and NO PII — every item is a fixed catalog entry
 * (label + static, server-owned `actionTarget`), and the done/pending booleans are
 * the only per-user signal. Action targets are fixed app paths from
 * `CHECKLIST_ITEMS` (never built from user input), so the CTA `href`s are safe.
 *
 * Behavior (matches the `onboarding-checklist` spec):
 *   - Mandatory items render done (CheckCircle2) or pending (action button → target).
 *   - The bonus AI item carries a "Bônus" badge and is visually distinct.
 *   - The card is expandable (Collapsible). While any mandatory item is pending it
 *     starts expanded; once mandatory progress reaches 100% it collapses by default
 *     and shows the completion celebration.
 */

export interface ChecklistCardProps {
  /** Per-item done-state, derived server-side from authoritative data. */
  readonly state: ChecklistState;
  /**
   * Whether the card renders in read-only mode (Configurações → Ajuda → Primeiros
   * passos when everything is complete): no CTAs, never auto-expanded-as-todo.
   * Defaults to `false` (the dashboard mount, which exposes pending CTAs).
   */
  readonly readOnly?: boolean;
}

export function ChecklistCard({ state, readOnly = false }: ChecklistCardProps) {
  const pct = mandatoryCompletePct(state);
  const mandatoryComplete = pct === 100;

  // Collapsed by default once the mandatory checklist is complete (the spec's
  // "card collapses at 100%"); otherwise it leads expanded so pending steps are
  // visible. The user can still toggle it via the header trigger.
  const [open, setOpen] = useState(!mandatoryComplete);

  return (
    <Card data-testid="onboarding-checklist-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="p-0">
          <CollapsibleTrigger
            className="focus-visible:shadow-focus flex w-full items-center justify-between gap-3 rounded-xl p-6 text-left focus-visible:outline-none"
            data-testid="onboarding-checklist-trigger"
          >
            <div className="flex flex-col gap-1">
              <span className="text-text-primary text-lg leading-tight font-semibold">
                Primeiros passos
              </span>
              <span
                className="text-text-secondary text-sm"
                data-testid="onboarding-checklist-progress"
              >
                {pct}% concluído
              </span>
            </div>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'text-text-tertiary duration-fast shrink-0 transition-transform',
                open && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
        </CardHeader>

        {mandatoryComplete ? <ChecklistCelebration complete /> : null}

        <CollapsibleContent>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-3">
              {CHECKLIST_ITEMS.map((item) => {
                const done = isComplete(state, item.key);
                return (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-3"
                    data-testid={`onboarding-checklist-item-${item.key}`}
                    data-done={done ? 'true' : 'false'}
                  >
                    <span className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2
                          aria-hidden="true"
                          className="text-success-500 shrink-0"
                          data-testid={`onboarding-checklist-done-${item.key}`}
                        />
                      ) : (
                        <Circle aria-hidden="true" className="text-text-tertiary shrink-0" />
                      )}
                      <span
                        className={cn(
                          'text-sm',
                          done ? 'text-text-secondary' : 'text-text-primary',
                        )}
                      >
                        {item.label}
                      </span>
                      {!item.mandatory ? (
                        <Badge variant="brand" data-testid="onboarding-checklist-bonus-badge">
                          Bônus
                        </Badge>
                      ) : null}
                    </span>

                    {!done && !readOnly ? (
                      <Button asChild size="sm" variant="secondary" className="shrink-0">
                        <Link
                          href={item.actionTarget}
                          data-testid={`onboarding-checklist-action-${item.key}`}
                        >
                          {item.mandatory ? 'Concluir' : 'Experimentar'}
                        </Link>
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
