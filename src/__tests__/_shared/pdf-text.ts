/**
 * Minimal PDF text extractor for test assertions.
 *
 * PDFKit compresses content streams with FlateDecode (zlib). This helper
 * inflates each compressed stream and collects all PDF text operators
 * (`Tj`, `TJ`, `'`, and hex-encoded strings). It is NOT a general-purpose
 * PDF parser -- it handles only the subset PDFKit produces, which is enough
 * for sentinel-based assertions in integration and e2e tests.
 *
 * Shared between:
 *   - integration/medical-records/exports/personal-notes-exclusion.int.test.ts
 *   - e2e/seeded/prontuario/export.spec.ts
 */

import { inflateSync } from 'node:zlib';

/**
 * Extract text from a PDFKit-generated buffer by inflating FlateDecode streams
 * and collecting all PDF text operators (`Tj`, `TJ`, and `'`).
 */
export function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('binary');
  const texts: string[] = [];

  // Find streams by locating `stream\n...\nendstream` boundaries
  const streamStartRegex = /stream\r?\n/g;
  let startMatch;

  while ((startMatch = streamStartRegex.exec(raw)) !== null) {
    const dataStart = startMatch.index + startMatch[0].length;
    const endIdx = raw.indexOf('endstream', dataStart);
    if (endIdx <= dataStart) continue;

    // Trim trailing whitespace before endstream
    let dataEnd = endIdx;
    while (
      dataEnd > dataStart &&
      (raw.charCodeAt(dataEnd - 1) === 0x0a || raw.charCodeAt(dataEnd - 1) === 0x0d)
    ) {
      dataEnd--;
    }

    const streamBytes = Buffer.from(raw.substring(dataStart, dataEnd), 'binary');
    try {
      const inflated = inflateSync(streamBytes).toString('latin1');

      // Extract text from parenthesized Tj operators: `(text) Tj`
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(inflated)) !== null) {
        texts.push(tjMatch[1]!);
      }

      // Extract text from hex-encoded strings: `<hex> Tj` or inside `[...] TJ`
      // PDFKit often uses `<hexstring>` instead of `(string)` for text.
      const hexTjRegex = /<([0-9a-fA-F]+)>/g;
      let hexMatch;
      while ((hexMatch = hexTjRegex.exec(inflated)) !== null) {
        const hex = hexMatch[1]!;
        let decoded = '';
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
        }
        if (decoded.length > 0) {
          texts.push(decoded);
        }
      }
    } catch {
      // Not a zlib-compressed stream -- skip (e.g., image data, metadata)
    }
  }

  return texts.join('');
}
