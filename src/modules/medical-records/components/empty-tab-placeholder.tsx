import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EmptyTabPlaceholderProps {
  /** Lucide icon component to display above the heading. */
  icon: LucideIcon;
  /** Contextual description below the heading. */
  description: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Salvia empty-state pattern for prontuario tabs that are not yet functional.
 *
 * Renders:
 * - Lucide icon in text-tertiary
 * - h4 "Em breve"
 * - Description in text-secondary
 * - No CTA
 */
export function EmptyTabPlaceholder({ icon: Icon, description }: EmptyTabPlaceholderProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="empty-tab-placeholder"
    >
      <Icon className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Em breve</h4>
      <p className="text-text-secondary max-w-sm text-sm">{description}</p>
    </div>
  );
}
