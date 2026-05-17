'use client';

import { ClipboardCheck, Scale } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { ListScalesForPatientResult, ScaleSummary } from '@/modules/medical-records';
import { Button } from '@/shared/ui/button';

import { ScaleSummaryCard } from './scale-summary-card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScalesTabProps {
  /** Patient UUID — used by the listing action. */
  patientId: string;
  /** Server action: list all distinct scales applied for this patient. */
  listScalesForPatient: (input: { patientId: string }) => Promise<ListScalesForPatientResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Container component for the "Escalas" prontuario tab.
 *
 * Responsibilities:
 * - Header row (h3 + primary "Aplicar nova escala" button)
 * - Loads scale summaries on mount via listScalesForPatient action
 * - Renders ScaleSummaryCard per scale or an empty state
 * - "Aplicar nova escala" opens ScaleSelectModal (section 11 — stubbed here)
 *
 * Follows the same data-fetch-in-useEffect pattern as HypothesesTab.
 */
export function ScalesTab({ patientId, listScalesForPatient }: ScalesTabProps) {
  const [scales, setScales] = useState<ScaleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Load scales on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const result = await listScalesForPatient({ patientId });
      if (!cancelled && result.ok) {
        setScales(result.scales);
      }
      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, listScalesForPatient]);

  // TODO(section 11): open ScaleSelectModal
  const handleApplyScale = useCallback(() => {
    // Stub — section 11 will replace this with modal open logic
  }, []);

  return (
    <div className="space-y-6" data-testid="scales-tab">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-text-primary text-lg font-semibold">Escalas aplicadas</h3>
        <Button onClick={handleApplyScale} data-testid="scales-apply-button">
          <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          Aplicar nova escala
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16" data-testid="scales-loading">
          <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : scales.length === 0 ? (
        <ScalesEmptyState onApply={handleApplyScale} />
      ) : (
        <div className="space-y-4" data-testid="scales-list">
          {scales.map((scale) => (
            <ScaleSummaryCard key={scale.scaleKey} summary={scale} timeseries={scale.timeseries} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (inline — mirrors HypothesesEmptyState pattern)
// ---------------------------------------------------------------------------

interface ScalesEmptyStateProps {
  onApply: () => void;
}

/**
 * Salvia empty state for the scales tab when no scales have been applied.
 *
 * Three parts per design rules:
 * - What is missing (icon + heading)
 * - Why it matters (description)
 * - What to do (CTA)
 */
function ScalesEmptyState({ onApply }: ScalesEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="scales-empty-state"
    >
      <Scale className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhuma escala aplicada</h4>
      <p className="text-text-secondary mb-4 max-w-sm text-sm">
        Aplique escalas psicometricas para acompanhar a evolucao do paciente ao longo do tratamento.
      </p>
      <Button onClick={onApply} data-testid="scales-empty-cta">
        Aplicar nova escala
      </Button>
    </div>
  );
}
