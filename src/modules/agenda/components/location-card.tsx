'use client';

import { CheckCircle2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
// Types
// ---------------------------------------------------------------------------

/** Location shape the card needs. Includes all fields the parent passes. */
export interface LocationCardData {
  id: string;
  name: string;
  address: string | null;
  type: string;
  color: string | null;
  arrivalInstructions: string | null;
  isDefault: boolean;
}

interface LocationCardProps {
  location: LocationCardData;
  /** Called when the user clicks "Editar". */
  onEdit: (location: LocationCardData) => void;
  /** Called when the user clicks "Marcar como padrao". */
  onSetDefault: (locationId: string) => void;
  /** Called when the user clicks "Excluir". */
  onDelete: (location: LocationCardData) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_BADGE_MAP: Record<string, { label: string; variant: 'neutral' | 'info' }> = {
  in_person: { label: 'Presencial', variant: 'neutral' },
  online: { label: 'Online', variant: 'info' },
  other: { label: 'Outro', variant: 'neutral' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Interactive card for a single location.
 *
 * Design System Salvia -- Card interactive:
 *   - border `border`, radius `xl`, padding `space-6`
 *   - hover border `border-strong`
 *   - Name h4 (16px/500)
 *   - Type Badge: in_person neutral "Presencial", online info "Online", other neutral "Outro"
 *   - Color dot (8px circle)
 *   - Address in body-sm text-secondary
 *   - Badge brand "Padrao" if is_default
 *   - Actions: MoreHorizontal (20px) opening DropdownMenu
 *   - Mobile: padding space-4
 */
export function LocationCard({ location, onEdit, onSetDefault, onDelete }: LocationCardProps) {
  const typeBadge = TYPE_BADGE_MAP[location.type] ?? {
    label: 'Outro',
    variant: 'neutral' as const,
  };

  return (
    <Card
      className="hover:border-border-strong border-border duration-fast p-4 transition-colors md:p-6"
      data-testid={`location-card-${location.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left content */}
        <div className="min-w-0 flex-1">
          {/* Name row with color dot */}
          <div className="mb-2 flex items-center gap-2">
            {location.color && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: location.color }}
                aria-hidden="true"
              />
            )}
            <h4 className="text-text-primary truncate text-base font-medium">{location.name}</h4>
          </div>

          {/* Badges row */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
            {location.isDefault && (
              <Badge variant="default" data-testid="location-default-badge">
                Padrao
              </Badge>
            )}
          </div>

          {/* Address */}
          {location.address && (
            <p className="text-text-secondary text-[13px]">{location.address}</p>
          )}
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Acoes para ${location.name}`}
              data-testid={`location-actions-${location.id}`}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onEdit(location)}
              data-testid={`location-edit-${location.id}`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </DropdownMenuItem>
            {!location.isDefault && (
              <DropdownMenuItem
                onClick={() => onSetDefault(location.id)}
                data-testid={`location-set-default-${location.id}`}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Marcar como padrao
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onDelete(location)}
              className="text-danger-500 focus:text-danger-500"
              data-testid={`location-delete-${location.id}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}
