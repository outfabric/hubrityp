/**
 * Scales section renderer for prontuario export PDFs.
 *
 * For each scale instrument, renders a data table (date, score,
 * classification) and an embedded SVG line chart via svg-to-pdfkit.
 */

import SVGtoPDF from 'svg-to-pdfkit';

import { buildScaleChartSvg } from '../scale-chart-svg';
import type { ScaleChartThreshold } from '../scale-chart-svg';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaleApplicationRow {
  scaleKey: string;
  appliedAt: Date;
  totalScore: number | null;
  classification: string | null;
}

export interface ScaleGroup {
  scaleKey: string;
  scaleName: string;
  scoreRange: { min: number; max: number };
  thresholds?: ScaleChartThreshold[];
  applications: ScaleApplicationRow[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const SECTION_TITLE_FONT_SIZE = 14;
const SCALE_HEADING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 11;
const TABLE_FONT_SIZE = 9;
const TABLE_HEADER_FONT_SIZE = 9;

const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;

const CHART_WIDTH = 400;
const CHART_HEIGHT = 180;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDatePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Table renderer (per scale)
// ---------------------------------------------------------------------------

function renderScaleTable(doc: PdfDoc, applications: ScaleApplicationRow[]): void {
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);

  const colWidths = {
    date: contentWidth * 0.3,
    score: contentWidth * 0.25,
    classification: contentWidth * 0.45,
  };

  const startY = doc.y;

  // Header
  doc.font(FONT_BOLD).fontSize(TABLE_HEADER_FONT_SIZE);
  let x = leftMargin;
  doc.text('Data', x, startY, { width: colWidths.date });
  x += colWidths.date;
  doc.text('Pontuacao', x, startY, { width: colWidths.score });
  x += colWidths.score;
  doc.text('Classificacao', x, startY, { width: colWidths.classification });

  // Header underline
  const lineY = startY + HEADER_HEIGHT;
  doc
    .moveTo(leftMargin, lineY)
    .lineTo(leftMargin + contentWidth, lineY)
    .lineWidth(0.5)
    .stroke();

  // Rows
  doc.font(FONT_REGULAR).fontSize(TABLE_FONT_SIZE);
  let rowY = lineY + 4;

  for (const app of applications) {
    x = leftMargin;
    doc.text(formatDatePtBr(app.appliedAt), x, rowY, { width: colWidths.date });
    x += colWidths.date;
    doc.text(app.totalScore != null ? String(app.totalScore) : '-', x, rowY, {
      width: colWidths.score,
    });
    x += colWidths.score;
    doc.text(app.classification ?? '-', x, rowY, { width: colWidths.classification });

    rowY += ROW_HEIGHT;
  }

  doc.y = rowY;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Chart renderer (per scale)
// ---------------------------------------------------------------------------

function renderScaleChart(doc: PdfDoc, group: ScaleGroup): void {
  const dataPoints = group.applications
    .filter((a) => a.totalScore != null)
    .map((a) => ({
      date: a.appliedAt.toISOString(),
      score: a.totalScore as number,
    }));

  if (dataPoints.length === 0) return;

  const svgString = buildScaleChartSvg(dataPoints, {
    scaleName: group.scaleName,
    scoreRange: group.scoreRange,
    thresholds: group.thresholds,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  });

  doc.moveDown(0.5);

  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);
  // Center the chart horizontally
  const chartX = leftMargin + (contentWidth - CHART_WIDTH) / 2;
  const chartY = doc.y;

  SVGtoPDF(doc, svgString, chartX, chartY, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  });

  // Advance cursor past the chart
  doc.y = chartY + CHART_HEIGHT;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderScalesSection(doc: PdfDoc, groups: ScaleGroup[]): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Escalas');
  doc.moveDown(0.8);

  if (groups.length === 0) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Nenhuma aplicacao de escala registrada.');
    doc.moveDown(1);
    return;
  }

  for (const group of groups) {
    // Scale heading
    doc.font(FONT_BOLD).fontSize(SCALE_HEADING_FONT_SIZE).text(group.scaleName);
    doc.moveDown(0.5);

    if (group.applications.length === 0) {
      doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Sem aplicacoes registradas.');
      doc.moveDown(0.8);
      continue;
    }

    renderScaleTable(doc, group.applications);
    renderScaleChart(doc, group);
    doc.moveDown(1);
  }
}
