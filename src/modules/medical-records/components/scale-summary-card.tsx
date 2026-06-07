'use client';

import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History } from 'lucide-react';
import { useState } from 'react';

import type { ScaleSummary, TimeseriesPoint } from '@/modules/medical-records';
import { scaleByKey } from '@/modules/medical-records/lib/scales';
import {
  classificationToSeverity,
  severityToBadgeVariant,
} from '@/modules/medical-records/lib/scales/severity-tokens';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import { ScaleHistoryChart } from './scale-history-chart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// classificationToSeverity is imported from the shared severity-tokens helper

/**
 * Format the classification label for display.
 * WHOQOL-Bref stores JSON domain scores — show "4 dominios" instead.
 */
function formatClassificationLabel(classification: string | null): string {
  if (!classification) return 'Sem classificação';
  try {
    const parsed: unknown = JSON.parse(classification);
    if (typeof parsed === 'object' && parsed !== null && 'physical' in parsed) {
      return '4 domínios';
    }
  } catch {
    // Not JSON — return as-is
  }
  return classification;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScaleSummaryCardProps {
  summary: ScaleSummary;
  timeseries: TimeseriesPoint[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Summary card for a single scale showing:
 * - Scale label
 * - Last application date (dd/MM/yyyy)
 * - Last score as text
 * - Severity Badge (success/warning/danger per Salvia rules)
 * - "Ver historico completo" button that opens a Sheet with ScaleHistoryChart
 *
 * Follows Salvia Card pattern: radius xl, shadow xs, padding space-6.
 */
export function ScaleSummaryCard({ summary, timeseries }: ScaleSummaryCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const scaleDef = scaleByKey(summary.scaleKey);
  const scaleLabel = scaleDef?.label ?? summary.scaleKey;

  const severity = classificationToSeverity(summary.lastClassification);
  const classificationLabel = formatClassificationLabel(summary.lastClassification);
  const badgeVariant = severity ? severityToBadgeVariant(severity) : 'neutral';

  const formattedDate = format(parseISO(summary.lastDate), 'dd/MM/yyyy', { locale: ptBR });

  const scoreDisplay =
    summary.lastScore !== null ? `Pontuação: ${summary.lastScore}` : 'Sem pontuação total';

  return (
    <>
      <Card className="p-6" data-testid={`scale-summary-card-${summary.scaleKey}`}>
        {/* Top row: label + Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-text-primary text-base font-medium">{scaleLabel}</h4>
            <p className="text-text-secondary mt-1 text-sm">{scoreDisplay}</p>
          </div>
          <Badge variant={badgeVariant}>{classificationLabel}</Badge>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-text-tertiary text-xs">Última aplicação: {formattedDate}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            data-testid={`scale-history-btn-${summary.scaleKey}`}
          >
            <History className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Ver histórico completo
          </Button>
        </div>
      </Card>

      {/* History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-[560px]">
          <SheetHeader className="px-6 pt-6">
            <SheetTitle>Histórico — {scaleLabel}</SheetTitle>
            <SheetDescription>Evolução das aplicações ao longo do tempo.</SheetDescription>
          </SheetHeader>
          <div className="px-6 py-4">
            <ScaleHistoryChart scaleKey={summary.scaleKey} timeseries={timeseries} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
