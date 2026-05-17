/**
 * scripts/build-cid10-data.ts
 *
 * Offline Node.js CLI that reads the Datasus CID-10 source CSV and outputs
 * a JSON file consumed by the application at runtime for in-memory search.
 *
 * Usage:
 *   npx tsx scripts/build-cid10-data.ts
 *
 * Source: Datasus CID-10 Tabular Data (CID-10-SUBCATEGORIAS.CSV)
 *   - Download page: http://www2.datasus.gov.br/cid10/V2008/download.htm
 *   - File description: http://www2.datasus.gov.br/cid10/V2008/descrcsv.htm
 *   - Raw file (mirror): https://raw.githubusercontent.com/cleytonferrari/CidDataSus/master/CIDImport/Repositorio/Resources/CID-10-SUBCATEGORIAS.CSV
 *
 * License: Public domain. Brazilian government open data published by the
 * Ministry of Health through Datasus. Freely available for use without
 * restrictions per Brazilian open data policy (Lei 12.527/2011).
 *
 * Input:  data/cid10-source.csv (UTF-8, semicolon-delimited, CODIGO;DESCRICAO)
 * Output: src/modules/medical-records/lib/cid10-data.json
 *         Array<{ code: string; description: string }>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface Cid10Entry {
  code: string;
  description: string;
}

const ROOT = path.resolve(import.meta.dirname, '..');
const INPUT_PATH = path.join(ROOT, 'data', 'cid10-source.csv');
const OUTPUT_PATH = path.join(ROOT, 'src', 'modules', 'medical-records', 'lib', 'cid10-data.json');

function stripBom(content: string): string {
  // Remove UTF-8 BOM if present (U+FEFF)
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

function parseCsv(content: string): Cid10Entry[] {
  const entries: Cid10Entry[] = [];
  const lines = content.split(/\r?\n/);

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    // Format: CODIGO;DESCRICAO
    const separatorIndex = line.indexOf(';');
    if (separatorIndex === -1) continue;

    const code = line.slice(0, separatorIndex).trim();
    const description = line.slice(separatorIndex + 1).trim();

    if (!code || !description) continue;

    entries.push({ code, description });
  }

  return entries;
}

function main(): void {
  console.log(`Reading source CSV: ${INPUT_PATH}`);

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`ERROR: Source file not found at ${INPUT_PATH}`);
    console.error('Ensure data/cid10-source.csv exists (CODIGO;DESCRICAO format, UTF-8).');
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_PATH, 'utf-8');
  const content = stripBom(raw);
  const entries = parseCsv(content);

  console.log(`Parsed ${entries.length} CID-10 entries`);

  if (entries.length < 12000) {
    console.error(
      `ERROR: Expected >12000 entries but got ${entries.length}. ` +
        'Source CSV may be incomplete or malformed.',
    );
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(outputDir, { recursive: true });

  // Write JSON output
  const json = JSON.stringify(entries, null, 0);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf-8');

  const fileSizeMB = (Buffer.byteLength(json, 'utf-8') / (1024 * 1024)).toFixed(2);
  console.log(`Written ${entries.length} entries to: ${OUTPUT_PATH}`);
  console.log(`File size: ${fileSizeMB} MB`);
  console.log('Done.');
}

main();
