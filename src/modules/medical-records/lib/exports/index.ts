// Barrel for prontuario export helpers.
//
// Re-exports Zod schemas, the expiry calculator, and the scale chart SVG
// builder. PDF section builders (Section 3) are NOT exported from here —
// they live under `../pdf/` and will be re-exported from a separate barrel.

// ---- Zod Schemas (filters + section toggles) --------------------------------
export {
  exportFiltersSchema,
  exportSectionsSchema,
  type ExportFilters,
  type ExportSections,
} from './export-schemas';

// ---- Expiry Calculator ------------------------------------------------------
export { computeExpiresAt, LARGE_EXPORT_THRESHOLD_BYTES } from './expiry-calculator';

// ---- Scale Chart SVG Builder ------------------------------------------------
export {
  buildScaleChartSvg,
  type ScaleChartDataPoint,
  type ScaleChartOptions,
  type ScaleChartThreshold,
} from './scale-chart-svg';
