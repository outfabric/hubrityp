import { describe, expect, it } from 'vitest';

import {
  generateStorageFilename,
  sanitizeDisplayName,
} from '@/modules/medical-records/lib/filename-sanitizer';

// ---------------------------------------------------------------------------
// sanitizeDisplayName
// ---------------------------------------------------------------------------

describe('sanitizeDisplayName', () => {
  it('returns the original name when it is already clean', () => {
    expect(sanitizeDisplayName('relatorio.pdf')).toBe('relatorio.pdf');
  });

  it('strips path traversal sequences', () => {
    const result = sanitizeDisplayName('../../etc/passwd.pdf');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
    expect(result).toBe('etcpasswd.pdf');
  });

  it('strips backslash path separators', () => {
    const result = sanitizeDisplayName('C:\\Users\\evil\\payload.exe');
    expect(result).not.toContain('\\');
    expect(result).toBe('C:Usersevilpayload.exe');
  });

  it('strips forward slash path separators', () => {
    const result = sanitizeDisplayName('path/to/file.pdf');
    expect(result).not.toContain('/');
    expect(result).toBe('pathtofile.pdf');
  });

  it('removes control characters', () => {
    const result = sanitizeDisplayName('file\x00name\x1F.pdf');
    expect(result).toBe('filename.pdf');
  });

  it('removes C1 control characters (U+007F-U+009F)', () => {
    const result = sanitizeDisplayName('test\x7Fname\x80.pdf');
    expect(result).toBe('testname.pdf');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeDisplayName('  arquivo.pdf  ')).toBe('arquivo.pdf');
  });

  it('returns fallback name when input is empty', () => {
    expect(sanitizeDisplayName('')).toBe('arquivo-sem-nome');
  });

  it('returns fallback name when input becomes empty after sanitization', () => {
    // Only path separators and traversal — nothing left
    expect(sanitizeDisplayName('../../')).toBe('arquivo-sem-nome');
  });

  it('truncates names longer than 255 characters', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const result = sanitizeDisplayName(longName);
    expect(result.length).toBe(255);
  });

  it('preserves names at exactly 255 characters', () => {
    const exactName = 'b'.repeat(255);
    expect(sanitizeDisplayName(exactName)).toBe(exactName);
    expect(sanitizeDisplayName(exactName).length).toBe(255);
  });

  it('handles a name that is only whitespace', () => {
    expect(sanitizeDisplayName('   ')).toBe('arquivo-sem-nome');
  });

  it('preserves Unicode characters (accented, CJK)', () => {
    expect(sanitizeDisplayName('relatório_março.pdf')).toBe('relatório_março.pdf');
  });
});

// ---------------------------------------------------------------------------
// generateStorageFilename
// ---------------------------------------------------------------------------

describe('generateStorageFilename', () => {
  it('returns a UUID-based filename with the given extension', () => {
    const result = generateStorageFilename('pdf');
    // UUID v4 format: 8-4-4-4-12 hex digits + dot + extension
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
  });

  it('strips a leading dot from the extension', () => {
    const result = generateStorageFilename('.png');
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
    expect(result).not.toContain('..');
  });

  it('generates unique filenames on successive calls', () => {
    const a = generateStorageFilename('jpg');
    const b = generateStorageFilename('jpg');
    expect(a).not.toBe(b);
  });
});
