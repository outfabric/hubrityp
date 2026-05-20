import { describe, expect, it } from 'vitest';

import {
  buildScaleChartSvg,
  type ScaleChartDataPoint,
  type ScaleChartOptions,
} from '@/modules/medical-records/lib/exports/scale-chart-svg';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBaseOptions(overrides?: Partial<ScaleChartOptions>): ScaleChartOptions {
  return {
    scaleName: 'PHQ-9',
    scoreRange: { min: 0, max: 27 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------

describe('buildScaleChartSvg', () => {
  it('returns a string starting with <svg and ending with </svg>', () => {
    const svg = buildScaleChartSvg([{ date: '2026-01-15', score: 10 }], makeBaseOptions());

    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toMatch(/<\/svg>$/);
  });

  // ---------------------------------------------------------------------------
  // Empty array
  // ---------------------------------------------------------------------------

  describe('empty data array', () => {
    it('renders an SVG with "Sem dados suficientes" text', () => {
      const svg = buildScaleChartSvg([], makeBaseOptions());

      expect(svg).toMatch(/^<svg\b/);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).toContain('Sem dados suficientes');
    });

    it('does not contain circles or polyline', () => {
      const svg = buildScaleChartSvg([], makeBaseOptions());

      expect(svg).not.toContain('<circle');
      expect(svg).not.toContain('<polyline');
    });
  });

  // ---------------------------------------------------------------------------
  // Single data point
  // ---------------------------------------------------------------------------

  describe('single data point', () => {
    it('renders exactly one circle', () => {
      const svg = buildScaleChartSvg([{ date: '2026-03-10', score: 14 }], makeBaseOptions());

      const circleMatches = svg.match(/<circle\b/g);
      expect(circleMatches).toHaveLength(1);
    });

    it('does not render a polyline', () => {
      const svg = buildScaleChartSvg([{ date: '2026-03-10', score: 14 }], makeBaseOptions());

      expect(svg).not.toContain('<polyline');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple data points
  // ---------------------------------------------------------------------------

  describe('multiple data points', () => {
    const multiData: ScaleChartDataPoint[] = [
      { date: '2026-01-10', score: 8 },
      { date: '2026-02-15', score: 12 },
      { date: '2026-03-20', score: 5 },
    ];

    it('renders one circle per data point', () => {
      const svg = buildScaleChartSvg(multiData, makeBaseOptions());

      const circleMatches = svg.match(/<circle\b/g);
      expect(circleMatches).toHaveLength(3);
    });

    it('renders a polyline connecting the points', () => {
      const svg = buildScaleChartSvg(multiData, makeBaseOptions());
      expect(svg).toContain('<polyline');
    });
  });

  // ---------------------------------------------------------------------------
  // Threshold lines
  // ---------------------------------------------------------------------------

  describe('threshold lines', () => {
    it('renders horizontal lines with threshold labels', () => {
      const svg = buildScaleChartSvg(
        [{ date: '2026-01-10', score: 10 }],
        makeBaseOptions({
          thresholds: [
            { value: 5, label: 'Leve' },
            { value: 15, label: 'Moderado' },
          ],
        }),
      );

      // Each threshold produces a <line> with stroke-dasharray and a <text> label
      expect(svg).toContain('Leve');
      expect(svg).toContain('Moderado');
      // Dashed lines for thresholds
      expect(svg).toContain('stroke-dasharray');
    });

    it('does not render thresholds outside the visible range', () => {
      const svg = buildScaleChartSvg(
        [{ date: '2026-01-10', score: 10 }],
        makeBaseOptions({
          scoreRange: { min: 0, max: 27 },
          thresholds: [{ value: 30, label: 'OutOfRange' }],
        }),
      );

      expect(svg).not.toContain('OutOfRange');
    });
  });

  // ---------------------------------------------------------------------------
  // Sorting (out-of-order data)
  // ---------------------------------------------------------------------------

  describe('data point sorting', () => {
    it('produces ascending X-axis despite out-of-order input', () => {
      const outOfOrder: ScaleChartDataPoint[] = [
        { date: '2026-03-20', score: 5 },
        { date: '2026-01-10', score: 8 },
        { date: '2026-02-15', score: 12 },
      ];

      const inOrder: ScaleChartDataPoint[] = [
        { date: '2026-01-10', score: 8 },
        { date: '2026-02-15', score: 12 },
        { date: '2026-03-20', score: 5 },
      ];

      const svgOutOfOrder = buildScaleChartSvg(outOfOrder, makeBaseOptions());
      const svgInOrder = buildScaleChartSvg(inOrder, makeBaseOptions());

      // Both should produce identical SVG because the builder sorts internally
      expect(svgOutOfOrder).toBe(svgInOrder);
    });
  });

  // ---------------------------------------------------------------------------
  // No filters/masks/transforms
  // ---------------------------------------------------------------------------

  describe('SVG compatibility', () => {
    it('does not contain <filter>, <mask>, or <transform> elements', () => {
      const svg = buildScaleChartSvg(
        [
          { date: '2026-01-10', score: 8 },
          { date: '2026-02-15', score: 12 },
        ],
        makeBaseOptions({
          thresholds: [{ value: 10, label: 'Moderado' }],
        }),
      );

      expect(svg).not.toMatch(/<(filter|mask)\b/);
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot test for a known fixture
  // ---------------------------------------------------------------------------

  describe('snapshot', () => {
    it('matches snapshot for 3 PHQ-9 data points spanning 3 months', () => {
      const fixture: ScaleChartDataPoint[] = [
        { date: '2026-01-15', score: 18 },
        { date: '2026-02-15', score: 12 },
        { date: '2026-03-15', score: 6 },
      ];

      const svg = buildScaleChartSvg(
        fixture,
        makeBaseOptions({
          width: 500,
          height: 200,
          thresholds: [
            { value: 5, label: 'Leve', color: '#facc15' },
            { value: 10, label: 'Moderado', color: '#f97316' },
            { value: 20, label: 'Grave', color: '#ef4444' },
          ],
        }),
      );

      expect(svg).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Scale name escaping
  // ---------------------------------------------------------------------------

  describe('XML escaping', () => {
    it('escapes special XML characters in scale name', () => {
      const svg = buildScaleChartSvg(
        [{ date: '2026-01-15', score: 10 }],
        makeBaseOptions({ scaleName: 'Scale <A&B>' }),
      );

      expect(svg).toContain('Scale &lt;A&amp;B&gt;');
      // Should not contain the raw unescaped characters in an attribute context
      expect(svg).not.toContain('>Scale <A&B><');
    });
  });
});
