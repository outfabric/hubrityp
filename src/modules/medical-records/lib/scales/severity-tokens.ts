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
// Classification label → severity mapping
// ---------------------------------------------------------------------------

/**
 * Derive severity from the classification label stored in the DB.
 *
 * The server persists the human-readable label (e.g. "Depressao minima",
 * "Uso nocivo", "Limitrofe") — NOT the severity enum. This function
 * reverse-maps the label back to the severity tier for badge/dot coloring.
 *
 * Exhaustive mapping per scale (cross-referenced against source definitions):
 *   PHQ-9: Minimo→minimal, Leve→mild, Moderado→moderate, Moderadamente grave→severe, Grave→severe
 *   GAD-7: Minimo→minimal, Leve→mild, Moderado→moderate, Grave→severe
 *   AUDIT: Baixo risco→minimal, Uso de risco→mild, Uso nocivo→moderate, Provavel dependencia→severe
 *   SDQ:   Normal→minimal, Limitrofe→mild, Anormal→severe
 *   WHOQOL-Bref: JSON object (domains) → 'domains'
 */
export function classificationToSeverity(classification: string | null): SeverityLevel | null {
  if (!classification) return null;
  const lower = classification.toLowerCase();

  // WHOQOL-Bref stores a JSON object — detect before keyword matching
  try {
    const parsed: unknown = JSON.parse(classification);
    if (typeof parsed === 'object' && parsed !== null && 'physical' in parsed) {
      return 'domains';
    }
  } catch {
    // Not JSON — continue with keyword matching
  }

  // SDQ: "Anormal" must be checked before "normal" to avoid false match
  if (lower.includes('anormal')) return 'severe';
  // SDQ: "Normal" (excluding "anormal" which was caught above)
  if (lower.includes('normal')) return 'minimal';
  // SDQ: "Limitrofe"
  if (lower.includes('limitrofe')) return 'mild';

  // AUDIT: "Provavel dependencia" — must be checked before generic "risco"
  if (lower.includes('dependencia')) return 'severe';
  // AUDIT: "Uso nocivo" — must be checked before "uso de risco"
  if (lower.includes('nocivo')) return 'moderate';
  // AUDIT: "Uso de risco" — checked after "nocivo" to avoid substring match
  if (lower.includes('uso de risco')) return 'mild';
  // AUDIT: "Baixo risco"
  if (lower.includes('baixo risco')) return 'minimal';

  // PHQ-9/GAD-7: "Moderadamente grave" — must be checked before "moderada"
  if (lower.includes('moderadamente grave')) return 'severe';
  // PHQ-9/GAD-7: "Grave" / "Severa"
  if (lower.includes('grave') || lower.includes('severa') || lower.includes('severe'))
    return 'severe';
  // PHQ-9/GAD-7: "Moderado" / "Moderada"
  if (lower.includes('moderad')) return 'moderate';
  // PHQ-9/GAD-7: "Leve" / "Mild"
  if (lower.includes('leve') || lower.includes('mild')) return 'mild';
  // PHQ-9/GAD-7: "Minimo" / "Minima" / "Minimal"
  if (lower.includes('minim')) return 'minimal';

  // Fallback: if none of the known labels match, return null (unknown)
  return null;
}

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
