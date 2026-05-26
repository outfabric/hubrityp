import { describe, expect, it } from 'vitest';

import {
  validateAudioMagicNumbers,
  type MimeValidationResult,
} from '@/modules/ai-transcription/server/validators/mime';

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid magic-number headers for each format
// ---------------------------------------------------------------------------

/**
 * Builds a minimal MP3 buffer. The sync word `0xFF 0xFB` marks the start of
 * an MPEG audio frame (MPEG1, Layer 3).
 */
function buildMp3Buffer(): Buffer {
  const buf = Buffer.alloc(128);
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = 0x90;
  buf[3] = 0x00;
  return buf;
}

/**
 * Builds a minimal WAV (RIFF) buffer: `RIFF<size>WAVEfmt `.
 */
function buildWavBuffer(): Buffer {
  const buf = Buffer.alloc(128);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(120, 4); // chunk size (dummy)
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  return buf;
}

/**
 * Builds a minimal M4A buffer: an `ftyp` box with brand `M4A `.
 */
function buildM4aBuffer(): Buffer {
  const buf = Buffer.alloc(128);
  buf.writeUInt32BE(24, 0); // box size
  buf.write('ftyp', 4);
  buf.write('M4A ', 8);
  return buf;
}

/**
 * Builds a minimal WebM buffer: a valid EBML header with DocType `webm`.
 *
 * Structure:
 *   EBML element ID (4 bytes) + data size + child elements ending with
 *   DocType = "webm".
 */
function buildWebmBuffer(): Buffer {
  const buf = Buffer.alloc(4096);

  // EBML element ID
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;

  // Data size: 19 bytes (VINT: 0x93 = 0x80 | 0x13)
  buf[4] = 0x93;

  // EBMLVersion = 1
  buf[5] = 0x42;
  buf[6] = 0x86;
  buf[7] = 0x81;
  buf[8] = 0x01;

  // EBMLReadVersion = 1
  buf[9] = 0x42;
  buf[10] = 0xf7;
  buf[11] = 0x81;
  buf[12] = 0x01;

  // EBMLMaxIDLength = 4
  buf[13] = 0x42;
  buf[14] = 0xf2;
  buf[15] = 0x81;
  buf[16] = 0x04;

  // EBMLMaxSizeLength = 8
  buf[17] = 0x42;
  buf[18] = 0xf3;
  buf[19] = 0x81;
  buf[20] = 0x08;

  // DocType = "webm" (Element ID 0x4282, size 4, payload "webm")
  buf[21] = 0x42;
  buf[22] = 0x82;
  buf[23] = 0x84;
  buf[24] = 0x77; // 'w'
  buf[25] = 0x65; // 'e'
  buf[26] = 0x62; // 'b'
  buf[27] = 0x6d; // 'm'

  // DocTypeVersion = 2
  buf[28] = 0x42;
  buf[29] = 0x87;
  buf[30] = 0x81;
  buf[31] = 0x02;

  // DocTypeReadVersion = 2
  buf[32] = 0x42;
  buf[33] = 0x85;
  buf[34] = 0x81;
  buf[35] = 0x02;

  return buf;
}

/**
 * Builds a buffer with the Windows PE/EXE magic number (`MZ`).
 */
function buildExeBuffer(): Buffer {
  const buf = Buffer.alloc(128);
  buf[0] = 0x4d; // 'M'
  buf[1] = 0x5a; // 'Z'
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateAudioMagicNumbers', () => {
  // ---- (a) MP3 → ok -------------------------------------------------------
  it('accepts a valid MP3 buffer declared as audio/mpeg', async () => {
    const result = await validateAudioMagicNumbers(buildMp3Buffer(), 'audio/mpeg');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/mpeg',
    });
  });

  // ---- (b) WAV → ok -------------------------------------------------------
  it('accepts a valid WAV buffer declared as audio/wav', async () => {
    const result = await validateAudioMagicNumbers(buildWavBuffer(), 'audio/wav');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/wav',
    });
  });

  it('accepts WAV with legacy declared type audio/x-wav via normalization', async () => {
    const result = await validateAudioMagicNumbers(buildWavBuffer(), 'audio/x-wav');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/wav',
    });
  });

  // ---- (c) M4A → ok -------------------------------------------------------
  it('accepts a valid M4A buffer declared as audio/x-m4a', async () => {
    const result = await validateAudioMagicNumbers(buildM4aBuffer(), 'audio/x-m4a');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/x-m4a',
    });
  });

  it('accepts M4A when declared as audio/mp4 (compatible MPEG-4 audio types)', async () => {
    const result = await validateAudioMagicNumbers(buildM4aBuffer(), 'audio/mp4');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/x-m4a',
    });
  });

  // ---- (d) WebM → ok ------------------------------------------------------
  it('accepts a valid WebM buffer declared as audio/webm', async () => {
    const result = await validateAudioMagicNumbers(buildWebmBuffer(), 'audio/webm');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/webm',
    });
  });

  it('accepts WebM when declared as video/webm (both normalize to audio/webm)', async () => {
    const result = await validateAudioMagicNumbers(buildWebmBuffer(), 'video/webm');

    expect(result).toEqual<MimeValidationResult>({
      ok: true,
      detected: 'audio/webm',
    });
  });

  // ---- (e) MP3 disguised as audio/wav → mismatch --------------------------
  it('rejects MP3 bytes disguised as audio/wav (declared mismatch)', async () => {
    const result = await validateAudioMagicNumbers(buildMp3Buffer(), 'audio/wav');

    expect(result).toEqual<MimeValidationResult>({
      ok: false,
      reason: 'mismatch',
    });
  });

  // ---- (f) PE/EXE bytes declared as audio/mpeg → not_allowed ---------------
  it('rejects PE/EXE bytes declared as audio/mpeg (not an allowed type)', async () => {
    const result = await validateAudioMagicNumbers(buildExeBuffer(), 'audio/mpeg');

    expect(result).toEqual<MimeValidationResult>({
      ok: false,
      reason: 'not_allowed',
    });
  });

  // ---- (g) Random 64-byte buffer → undetected ------------------------------
  it('returns undetected for a random 64-byte buffer', async () => {
    // Deliberately avoid any known magic numbers in the first bytes
    const buf = Buffer.alloc(64, 0x42);
    buf[0] = 0x01;
    buf[1] = 0x02;

    const result = await validateAudioMagicNumbers(buf, 'audio/mpeg');

    expect(result).toEqual<MimeValidationResult>({
      ok: false,
      reason: 'undetected',
    });
  });

  // ---- Additional edge cases -----------------------------------------------

  it('rejects a detected audio type that is not in the allowlist (e.g. audio/flac)', async () => {
    // FLAC magic number: "fLaC"
    const flac = Buffer.alloc(128);
    flac.write('fLaC', 0);

    const result = await validateAudioMagicNumbers(flac, 'audio/x-flac');

    expect(result).toEqual<MimeValidationResult>({
      ok: false,
      reason: 'not_allowed',
    });
  });
});
