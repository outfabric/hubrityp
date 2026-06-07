'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Check, MoreHorizontal, Pencil, X } from 'lucide-react';

import type { HypothesisStatus } from '@/modules/medical-records/lib/schemas/hypothesis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

// ---------------------------------------------------------------------------
// Badge variant mapping (from design.md)
// ---------------------------------------------------------------------------

const STATUS_BADGE_MAP: Record<
  HypothesisStatus,
  { variant: 'warning' | 'success' | 'neutral'; label: string }
> = {
  investigating: { variant: 'warning', label: 'Em investigação' },
  confirmed: { variant: 'success', label: 'Confirmada' },
  discarded: { variant: 'neutral', label: 'Descartada' },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HypothesisCardData {
  id: string;
  description: string | null;
  cid10Code: string | null;
  cid10Description: string | null;
  status: HypothesisStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface HypothesisCardProps {
  hypothesis: HypothesisCardData;
  onEdit: (id: string) => void;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Individual hypothesis card following the Salvia card pattern:
 * radius xl, shadow xs, padding space-6.
 *
 * Top row: description/CID-10 (code in font-mono) + Badge (status-mapped).
 * Meta row: created_at formatted, updated_at if differs (body-sm, text-tertiary).
 * DropdownMenu with MoreHorizontal trigger: Editar, Confirmar, Descartar.
 */
export function HypothesisCard({ hypothesis, onEdit, onConfirm, onDiscard }: HypothesisCardProps) {
  const { id, description, cid10Code, cid10Description, status, createdAt, updatedAt } = hypothesis;
  const badge = STATUS_BADGE_MAP[status];

  const createdFormatted = format(new Date(createdAt), "dd 'de' MMM 'de' yyyy", { locale: ptBR });
  const updatedFormatted = format(new Date(updatedAt), "dd 'de' MMM 'de' yyyy", { locale: ptBR });
  const showUpdated = createdFormatted !== updatedFormatted;

  return (
    <Card className="p-6" data-testid={`hypothesis-card-${id}`}>
      {/* Top row: description/CID-10 + Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {cid10Code && (
            <div className="mb-1 flex items-center gap-2">
              <span className="text-brand-700 font-mono text-sm font-medium">{cid10Code}</span>
              {cid10Description && (
                <span className="text-text-secondary truncate text-sm">{cid10Description}</span>
              )}
            </div>
          )}
          {description && <p className="text-text-primary text-sm">{description}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Opções da hipótese"
                data-testid={`hypothesis-card-menu-${id}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit(id)}
                data-testid={`hypothesis-action-edit-${id}`}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              {status !== 'confirmed' && (
                <DropdownMenuItem
                  onClick={() => onConfirm(id)}
                  data-testid={`hypothesis-action-confirm-${id}`}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Confirmar
                </DropdownMenuItem>
              )}
              {status !== 'discarded' && (
                <DropdownMenuItem
                  onClick={() => onDiscard(id)}
                  data-testid={`hypothesis-action-discard-${id}`}
                >
                  <X className="mr-2 h-4 w-4" />
                  Descartar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Meta row */}
      <div className="text-text-tertiary mt-3 flex items-center gap-3 text-xs">
        <span>Criada em {createdFormatted}</span>
        {showUpdated && <span>Atualizada em {updatedFormatted}</span>}
      </div>
    </Card>
  );
}
