/**
 * Pure SVG builder for scale history line charts.
 *
 * Produces a self-contained `<svg>` string that can be embedded in a
 * PDFKit document via svg-to-pdfkit. Only simple SVG elements are used
 * (`<rect>`, `<line>`, `<circle>`, `<text>`, `<polyline>`, `<g>`) —
 * no filters, masks, or transforms (svg-to-pdfkit limitation).
 *
 * Deterministic coordinate math for snapshot-friendly unit tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaleChartDataPoint {
  /** ISO 8601 date string. */
  date: string;
  score: number;
}

export interface ScaleChartThreshold {
  value: number;
  label: string;
  color?: string;
}

export interface ScaleChartOptions {
  /** SVG width in px. @default 500 */
  width?: number;
  /** SVG height in px. @default 200 */
  height?: number;
  /** Scale instrument name shown as a title, e.g. "PHQ-9". */
  scaleName: string;
  /** Y-axis bounds. */
  scoreRange: { min: number; max: number };
  /** Horizontal classification lines drawn across the chart. */
  thresholds?: ScaleChartThreshold[];
}

// ---------------------------------------------------------------------------
// Layout constants (fixed padding around the chart area)
// ---------------------------------------------------------------------------

const PAD_TOP = 30;
const PAD_RIGHT = 20;
const PAD_BOTTOM = 50;
const PAD_LEFT = 45;

const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 200;

const FONT_SIZE_AXIS = 10;
const FONT_SIZE_TITLE = 12;
const FONT_SIZE_LABEL = 9;

const DOT_RADIUS = 4;

const AXIS_COLOR = '#666';
const LINE_COLOR = '#2563eb'; // blue-600
const DOT_COLOR = '#1d4ed8'; // blue-700
const DEFAULT_THRESHOLD_COLOR = '#ef4444'; // red-500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape XML-special characters to produce safe attribute/text values. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a Date as DD/MM/YY for compact X-axis labels (pt-BR convention). */
function formatDateLabel(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(2);
  return `${day}/${month}/${year}`;
}

/**
 * Pick which indices to show as X-axis labels to avoid overcrowding.
 * Always show first and last; add the middle index when there are >= 3 points.
 */
function pickLabelIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count === 2) return [0, 1];
  const mid = Math.floor(count / 2);
  return [0, mid, count - 1];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build an SVG string representing a line chart of scale scores over time.
 *
 * @param data    Array of `{ date, score }` objects (ISO date strings).
 * @param options Chart configuration — scale name, axis range, thresholds.
 * @returns       A complete `<svg>...</svg>` string.
 */
export function buildScaleChartSvg(
  data: ScaleChartDataPoint[],
  options: ScaleChartOptions,
): string {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const { scaleName, scoreRange, thresholds } = options;

  // -- Empty data: show placeholder text -----------------------------------
  if (data.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="#fafafa" />`,
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE_TITLE}" fill="${AXIS_COLOR}">Sem dados suficientes</text>`,
      '</svg>',
    ].join('');
  }

  // -- Sort by date ascending and convert to numeric pairs -----------------
  const sorted = [...data]
    .map((p) => ({ ts: new Date(p.date).getTime(), score: p.score, raw: new Date(p.date) }))
    .sort((a, b) => a.ts - b.ts);

  // -- Chart area bounds ---------------------------------------------------
  const chartLeft = PAD_LEFT;
  const chartRight = width - PAD_RIGHT;
  const chartTop = PAD_TOP;
  const chartBottom = height - PAD_BOTTOM;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  const yMin = scoreRange.min;
  const yMax = scoreRange.max;
  const yRange = yMax - yMin || 1; // avoid division by zero

  /** Map a score to a Y pixel (higher score = higher on chart = lower Y). */
  const toY = (score: number): number => {
    return chartBottom - ((score - yMin) / yRange) * chartHeight;
  };

  /** Map an index to an X pixel (evenly spaced when only one point). */
  const toX = (idx: number): number => {
    if (sorted.length === 1) return chartLeft + chartWidth / 2;
    return chartLeft + (idx / (sorted.length - 1)) * chartWidth;
  };

  const lines: string[] = [];

  // -- Open SVG ------------------------------------------------------------
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push(`<rect width="${width}" height="${height}" fill="#fafafa" />`);

  // -- Title ---------------------------------------------------------------
  lines.push(
    `<text x="${width / 2}" y="${FONT_SIZE_TITLE + 4}" text-anchor="middle" font-size="${FONT_SIZE_TITLE}" font-weight="bold" fill="#333">${escapeXml(scaleName)}</text>`,
  );

  // -- Y axis line ---------------------------------------------------------
  lines.push(
    `<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" stroke="${AXIS_COLOR}" stroke-width="1" />`,
  );

  // -- X axis line ---------------------------------------------------------
  lines.push(
    `<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" stroke="${AXIS_COLOR}" stroke-width="1" />`,
  );

  // -- Y axis labels (min, max, and mid) -----------------------------------
  const yMid = yMin + yRange / 2;
  const yLabelValues = [yMin, yMid, yMax];
  for (const v of yLabelValues) {
    const y = toY(v);
    lines.push(
      `<text x="${chartLeft - 6}" y="${y + 3}" text-anchor="end" font-size="${FONT_SIZE_AXIS}" fill="${AXIS_COLOR}">${v}</text>`,
    );
    // Light horizontal grid line
    lines.push(
      `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" />`,
    );
  }

  // -- X axis labels -------------------------------------------------------
  const labelIndices = pickLabelIndices(sorted.length);
  for (const idx of labelIndices) {
    const point = sorted[idx];
    if (!point) continue;
    const x = toX(idx);
    const label = formatDateLabel(point.raw);
    lines.push(
      `<text x="${x}" y="${chartBottom + 16}" text-anchor="middle" font-size="${FONT_SIZE_AXIS}" fill="${AXIS_COLOR}">${escapeXml(label)}</text>`,
    );
  }

  // -- Threshold lines -----------------------------------------------------
  if (thresholds) {
    for (const th of thresholds) {
      if (th.value < yMin || th.value > yMax) continue; // outside visible range
      const y = toY(th.value);
      const color = th.color ?? DEFAULT_THRESHOLD_COLOR;
      lines.push(
        `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="${escapeXml(color)}" stroke-width="1" stroke-dasharray="4 3" />`,
      );
      lines.push(
        `<text x="${chartRight + 2}" y="${y + 3}" font-size="${FONT_SIZE_LABEL}" fill="${escapeXml(color)}">${escapeXml(th.label)}</text>`,
      );
    }
  }

  // -- Data polyline (skip if single point) --------------------------------
  if (sorted.length > 1) {
    const points = sorted.map((p, i) => `${toX(i)},${toY(p.score)}`).join(' ');
    lines.push(
      `<polyline points="${points}" fill="none" stroke="${LINE_COLOR}" stroke-width="2" />`,
    );
  }

  // -- Data dots -----------------------------------------------------------
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!p) continue;
    const cx = toX(i);
    const cy = toY(p.score);
    lines.push(`<circle cx="${cx}" cy="${cy}" r="${DOT_RADIUS}" fill="${DOT_COLOR}" />`);
  }

  // -- Close SVG -----------------------------------------------------------
  lines.push('</svg>');

  return lines.join('');
}
