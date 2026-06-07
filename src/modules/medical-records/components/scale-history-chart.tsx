'use client';

import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TimeseriesPoint } from '@/modules/medical-records';
import {
  classificationToSeverity,
  severityToDotFill,
} from '@/modules/medical-records/lib/scales/severity-tokens';
import type { ClassificationResult } from '@/modules/medical-records/lib/scales/types';

// ---------------------------------------------------------------------------
// Max score per scale — used for YAxis domain
// ---------------------------------------------------------------------------

const MAX_SCORE_MAP: Record<string, number> = {
  phq9: 27,
  gad7: 21,
  audit: 40,
  sdq: 40,
  'whoqol-bref': 100,
};

function maxScoreForScale(scaleKey: string): number {
  return MAX_SCORE_MAP[scaleKey] ?? 100;
}

// ---------------------------------------------------------------------------
// WHOQOL-Bref domain labels (for multi-line chart)
// ---------------------------------------------------------------------------

const WHOQOL_DOMAIN_KEYS = ['physical', 'psychological', 'social', 'environmental'] as const;
const WHOQOL_DOMAIN_LABELS: Record<string, string> = {
  physical: 'Físico',
  psychological: 'Psicológico',
  social: 'Social',
  environmental: 'Ambiental',
};
const WHOQOL_DOMAIN_COLORS: Record<string, string> = {
  physical: 'var(--color-brand-500)',
  psychological: 'var(--color-info-500)',
  social: 'var(--color-success-500)',
  environmental: 'var(--color-warning-500)',
};

// ---------------------------------------------------------------------------
// Parse WHOQOL domain JSON from classification string
// ---------------------------------------------------------------------------

interface WhoqolDomains {
  physical: number;
  psychological: number;
  social: number;
  environmental: number;
}

function parseWhoqolDomains(classification: string | null): WhoqolDomains | null {
  if (!classification) return null;
  try {
    const parsed: unknown = JSON.parse(classification);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'physical' in parsed &&
      'psychological' in parsed &&
      'social' in parsed &&
      'environmental' in parsed
    ) {
      return parsed as WhoqolDomains;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WHOQOL-Bref data transformation (flatten domains into separate data keys)
// ---------------------------------------------------------------------------

interface WhoqolDataPoint {
  appliedAt: string;
  dateLabel: string;
  physical: number;
  psychological: number;
  social: number;
  environmental: number;
}

function buildWhoqolData(timeseries: TimeseriesPoint[]): WhoqolDataPoint[] {
  // Timeseries comes newest-first from the server; chart should be chronological
  const sorted = [...timeseries].reverse();
  return sorted
    .map((point) => {
      const domains = parseWhoqolDomains(point.classification);
      if (!domains) return null;
      return {
        appliedAt: point.appliedAt,
        dateLabel: format(parseISO(point.appliedAt), 'dd/MM', { locale: ptBR }),
        ...domains,
      };
    })
    .filter((d): d is WhoqolDataPoint => d !== null);
}

// ---------------------------------------------------------------------------
// Standard (non-WHOQOL) data transformation
// ---------------------------------------------------------------------------

interface StandardDataPoint {
  appliedAt: string;
  dateLabel: string;
  totalScore: number;
  classification: string | null;
  severity: ClassificationResult['severity'] | null;
}

// classificationToSeverity is imported from the shared severity-tokens helper

function buildStandardData(timeseries: TimeseriesPoint[]): StandardDataPoint[] {
  const sorted = [...timeseries].reverse();
  return sorted
    .filter((p) => p.totalScore !== null)
    .map((point) => ({
      appliedAt: point.appliedAt,
      dateLabel: format(parseISO(point.appliedAt), 'dd/MM', { locale: ptBR }),
      totalScore: point.totalScore!,
      classification: point.classification,
      severity: classificationToSeverity(point.classification),
    }));
}

// ---------------------------------------------------------------------------
// Custom ClassificationDot
// ---------------------------------------------------------------------------

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: StandardDataPoint;
  r?: number;
}

function ClassificationDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined) return null;
  const fill = severityToDotFill(payload?.severity);
  return <circle cx={cx} cy={cy} r={4} fill={fill} stroke="none" data-testid="chart-dot" />;
}

function ClassificationActiveDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined) return null;
  const fill = severityToDotFill(payload?.severity);
  return <circle cx={cx} cy={cy} r={6} fill={fill} stroke="none" />;
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadItem {
  payload: StandardDataPoint | WhoqolDataPoint;
  name: string;
  value: number;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function StandardChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]!.payload as StandardDataPoint;
  return (
    <div className="border-border bg-surface rounded-lg border p-3 shadow-sm">
      <p className="text-text-primary text-sm font-medium">
        {format(parseISO(data.appliedAt), 'dd/MM/yyyy', { locale: ptBR })}
      </p>
      <p className="text-text-secondary text-sm">Pontuação: {data.totalScore}</p>
      {data.classification && <p className="text-text-tertiary text-xs">{data.classification}</p>}
    </div>
  );
}

function WhoqolChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]!.payload as WhoqolDataPoint;
  return (
    <div className="border-border bg-surface rounded-lg border p-3 shadow-sm">
      <p className="text-text-primary mb-1 text-sm font-medium">
        {format(parseISO(data.appliedAt), 'dd/MM/yyyy', { locale: ptBR })}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-text-secondary text-sm">
          <span style={{ color: entry.color }}>
            {WHOQOL_DOMAIN_LABELS[entry.name] ?? entry.name}
          </span>
          : {entry.value}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScaleHistoryChartProps {
  scaleKey: string;
  timeseries: TimeseriesPoint[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Line chart for scale application history following Salvia design rules.
 *
 * Standard scales: single totalScore line in brand-500, ClassificationDot
 * colored by severity.
 *
 * WHOQOL-Bref: 4 domain lines (Physical, Psychological, Social, Environmental)
 * parsed from the JSON classification string.
 */
export function ScaleHistoryChart({ scaleKey, timeseries }: ScaleHistoryChartProps) {
  const isWhoqol = scaleKey === 'whoqol-bref';
  const maxScore = maxScoreForScale(scaleKey);

  if (timeseries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-text-tertiary text-sm">Nenhum dado disponível para o gráfico.</p>
      </div>
    );
  }

  if (isWhoqol) {
    const data = buildWhoqolData(timeseries);
    if (data.length === 0) {
      return (
        <div className="flex items-center justify-center py-8">
          <p className="text-text-tertiary text-sm">Nenhum dado disponível para o gráfico.</p>
        </div>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-surface-muted)" strokeDasharray="3 3" />
          <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} stroke="var(--color-text-tertiary)" />
          <YAxis
            domain={[0, maxScore]}
            tick={{ fontSize: 12 }}
            stroke="var(--color-text-tertiary)"
          />
          <Tooltip content={<WhoqolChartTooltip />} />
          {WHOQOL_DOMAIN_KEYS.map((domain) => (
            <Line
              key={domain}
              type="monotone"
              dataKey={domain}
              name={domain}
              stroke={WHOQOL_DOMAIN_COLORS[domain]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Standard scale (single totalScore line)
  const data = buildStandardData(timeseries);
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-text-tertiary text-sm">Nenhum dado disponível para o gráfico.</p>
      </div>
    );
  }

  return (
    <div data-testid="scale-history-chart">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-surface-muted)" strokeDasharray="3 3" />
          <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} stroke="var(--color-text-tertiary)" />
          <YAxis
            domain={[0, maxScore]}
            tick={{ fontSize: 12 }}
            stroke="var(--color-text-tertiary)"
          />
          <Tooltip content={<StandardChartTooltip />} />
          <Line
            type="monotone"
            dataKey="totalScore"
            stroke="var(--color-brand-500)"
            strokeWidth={2}
            dot={<ClassificationDot />}
            activeDot={<ClassificationActiveDot />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
