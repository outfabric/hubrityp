/**
 * Maps classification severity levels to Salvia design-system token pairs.
 *
 * Used by ScaleSummaryCard (Badge variant) and ScaleHistoryChart
 * (ClassificationDot fill). Centralizing the mapping avoids
 * divergence between the card badge and the chart dot colors.
 *
 * Token rules per design-system/rules.md:
 * - success-50/700 for "minimal"
 * - warning-50/700 for "mild" and "moderate"
 * - danger-50/700 for "severe"
 * - info-50/700 for "domains" (WHOQOL-Bref multi-domain)
 */

import type { BadgeProps } from '@/shared/ui/badge';

import type { ClassificationResult } from './types';

type SeverityLevel = ClassificationResult['severity'];

// ---------------------------------------------------------------------------
// Badge variant mapping (for ScaleSummaryCard)
// ---------------------------------------------------------------------------

export function severityToBadgeVariant(
  severity: SeverityLevel,
): NonNullable<BadgeProps['variant']> {
  switch (severity) {
    case 'minimal':
      return 'success';
    case 'mild':
    case 'moderate':
      return 'warning';
    case 'severe':
      return 'danger';
    case 'domains':
      return 'info';
    default: {
      // Exhaustive check — if a new severity is added, TS will catch it
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Chart dot fill color (CSS variable references for Recharts)
// ---------------------------------------------------------------------------

const SEVERITY_DOT_COLORS: Record<SeverityLevel, string> = {
  minimal: 'var(--color-success-500)',
  mild: 'var(--color-warning-500)',
  moderate: 'var(--color-warning-500)',
  severe: 'var(--color-danger-500)',
  domains: 'var(--color-info-500)',
};

export function severityToDotFill(severity: SeverityLevel | undefined | null): string {
  if (!severity) return 'var(--color-brand-500)';
  return SEVERITY_DOT_COLORS[severity] ?? 'var(--color-brand-500)';
}
