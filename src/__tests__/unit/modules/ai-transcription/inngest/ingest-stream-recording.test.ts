import { describe, expect, it } from 'vitest';

import {
  downloadRecording,
  extractStreamRecordingParts,
  hasValidAudioMagic,
  isAllowedStreamHost,
  isPrivateIP,
  STREAM_HOST_ALLOWLIST,
  validateStreamUrl,
} from '@/modules/ai-transcription/inngest/ingest-stream-recording';

// ---------------------------------------------------------------------------
// isAllowedStreamHost
// ---------------------------------------------------------------------------

describe('isAllowedStreamHost', () => {
  it('allows exact match of stream-io-cdn.com', () => {
    expect(isAllowedStreamHost('stream-io-cdn.com')).toBe(true);
  });

  it('allows subdomains of stream-io-cdn.com', () => {
    expect(isAllowedStreamHost('us-east.stream-io-cdn.com')).toBe(true);
    expect(isAllowedStreamHost('eu-west.stream-io-cdn.com')).toBe(true);
    expect(isAllowedStreamHost('a.b.c.stream-io-cdn.com')).toBe(true);
  });

  it('rejects unrelated hostnames', () => {
    expect(isAllowedStreamHost('evil.com')).toBe(false);
    expect(isAllowedStreamHost('example.com')).toBe(false);
    expect(isAllowedStreamHost('notstream-io-cdn.com')).toBe(false);
  });

  it('rejects hostnames that merely contain the CDN domain', () => {
    expect(isAllowedStreamHost('fake-stream-io-cdn.com')).toBe(false);
    expect(isAllowedStreamHost('stream-io-cdn.com.evil.com')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAllowedStreamHost('Stream-IO-CDN.COM')).toBe(true);
    expect(isAllowedStreamHost('US-EAST.STREAM-IO-CDN.COM')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPrivateIP
// ---------------------------------------------------------------------------

describe('isPrivateIP', () => {
  it('detects 10.x.x.x as private', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
  });

  it('detects 172.16-31.x.x as private', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
  });

  it('does not flag 172.15.x.x or 172.32.x.x as private', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('detects 192.168.x.x as private', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  it('detects 127.x.x.x (loopback) as private', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('detects 169.254.x.x (link-local) as private', () => {
    expect(isPrivateIP('169.254.1.1')).toBe(true);
  });

  it('detects 0.x.x.x ("this network") as private', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('detects IPv6 loopback ::1 as private', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('detects IPv6 link-local fe80:: as private', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
  });

  it('does not flag public IPs as private', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  it('returns false for invalid IP strings', () => {
    expect(isPrivateIP('not-an-ip')).toBe(false);
    expect(isPrivateIP('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateStreamUrl
// ---------------------------------------------------------------------------

describe('validateStreamUrl', () => {
  it('accepts a URL with an allowed Stream CDN hostname', async () => {
    const url = await validateStreamUrl(
      'https://us-east.stream-io-cdn.com/recordings/abc.webm',
      {},
    );
    expect(url.hostname).toBe('us-east.stream-io-cdn.com');
  });

  it('rejects a URL with a non-allowed hostname', async () => {
    await expect(validateStreamUrl('https://evil.com/recordings/abc.webm', {})).rejects.toThrow(
      'SSRF: hostname "evil.com" not in Stream CDN allowlist',
    );
  });

  it('rejects when DNS resolves to a private IP', async () => {
    const resolveDns = () => Promise.resolve(['10.0.0.1']);

    await expect(
      validateStreamUrl('https://stream-io-cdn.com/recordings/abc.webm', {
        resolveDns,
      }),
    ).rejects.toThrow('SSRF: hostname "stream-io-cdn.com" resolves to private IP 10.0.0.1');
  });

  it('accepts when DNS resolves to a public IP', async () => {
    const resolveDns = () => Promise.resolve(['203.0.113.1']);

    const url = await validateStreamUrl('https://stream-io-cdn.com/recordings/abc.webm', {
      resolveDns,
    });
    expect(url.hostname).toBe('stream-io-cdn.com');
  });

  it('proceeds when DNS resolution fails (CDN may use CNAMEs)', async () => {
    const resolveDns = () => Promise.reject(new Error('ENOTFOUND'));

    // Should not throw — DNS failure is tolerated when hostname is in allowlist
    const url = await validateStreamUrl('https://stream-io-cdn.com/recordings/abc.webm', {
      resolveDns,
    });
    expect(url.hostname).toBe('stream-io-cdn.com');
  });

  it('supports a custom host allowlist (for testing)', async () => {
    const url = await validateStreamUrl('https://localhost:3000/file.webm', {
      hostAllowlist: ['localhost'],
    });
    expect(url.hostname).toBe('localhost');
  });

  it('rejects invalid URL strings', async () => {
    await expect(validateStreamUrl('not-a-url', {})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// hasValidAudioMagic
// ---------------------------------------------------------------------------

describe('hasValidAudioMagic', () => {
  it('recognizes WebM (EBML header)', () => {
    const buf = Buffer.alloc(16);
    buf[0] = 0x1a;
    buf[1] = 0x45;
    buf[2] = 0xdf;
    buf[3] = 0xa3;
    expect(hasValidAudioMagic(buf)).toBe(true);
  });

  it('recognizes MP3 with ID3v2 tag', () => {
    const buf = Buffer.alloc(16);
    buf.write('ID3', 0);
    expect(hasValidAudioMagic(buf)).toBe(true);
  });

  it('recognizes MP3 with sync word', () => {
    const buf = Buffer.alloc(16);
    buf[0] = 0xff;
    buf[1] = 0xfb;
    expect(hasValidAudioMagic(buf)).toBe(true);
  });

  it('recognizes WAV (RIFF header)', () => {
    const buf = Buffer.alloc(16);
    buf.write('RIFF', 0);
    buf.write('WAVE', 8);
    expect(hasValidAudioMagic(buf)).toBe(true);
  });

  it('recognizes MP4/M4A (ftyp atom)', () => {
    const buf = Buffer.alloc(16);
    buf[4] = 0x66; // f
    buf[5] = 0x74; // t
    buf[6] = 0x79; // y
    buf[7] = 0x70; // p
    expect(hasValidAudioMagic(buf)).toBe(true);
  });

  it('rejects garbage bytes', () => {
    const buf = Buffer.alloc(16);
    buf.fill(0x42);
    expect(hasValidAudioMagic(buf)).toBe(false);
  });

  it('rejects empty buffer', () => {
    expect(hasValidAudioMagic(Buffer.alloc(0))).toBe(false);
  });

  it('rejects buffer too short (< 4 bytes)', () => {
    expect(hasValidAudioMagic(Buffer.from([0x1a, 0x45]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// downloadRecording
// ---------------------------------------------------------------------------

describe('downloadRecording', () => {
  it('returns a Buffer on successful download', async () => {
    const content = Buffer.from('fake-audio-data');
    const mockFetch = () => Promise.resolve(new Response(content, { status: 200 }));

    const result = await downloadRecording(new URL('https://cdn.example.com/file.webm'), mockFetch);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('fake-audio-data');
  });

  it('throws on HTTP error', async () => {
    const mockFetch = () =>
      Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    await expect(
      downloadRecording(new URL('https://cdn.example.com/file.webm'), mockFetch),
    ).rejects.toThrow('Stream download failed: HTTP 404 Not Found');
  });

  it('throws on empty response', async () => {
    const mockFetch = () => Promise.resolve(new Response(new ArrayBuffer(0), { status: 200 }));

    await expect(
      downloadRecording(new URL('https://cdn.example.com/file.webm'), mockFetch),
    ).rejects.toThrow('Stream download returned empty body');
  });
});

// ---------------------------------------------------------------------------
// extractStreamRecordingParts
// ---------------------------------------------------------------------------

describe('extractStreamRecordingParts', () => {
  it('extracts session and filename from a typical Stream recording URL', () => {
    const url = new URL(
      'https://us-east.stream-io-cdn.com/recordings/default/call123/session456/rec.webm',
    );
    const parts = extractStreamRecordingParts(url);
    expect(parts).toEqual({ session: 'session456', filename: 'rec.webm' });
  });

  it('handles URLs with fewer path segments', () => {
    const url = new URL('https://cdn.example.com/session/file.webm');
    const parts = extractStreamRecordingParts(url);
    expect(parts).toEqual({ session: 'session', filename: 'file.webm' });
  });

  it('returns null when filename has no extension', () => {
    const url = new URL('https://cdn.example.com/session/noext');
    const parts = extractStreamRecordingParts(url);
    expect(parts).toBeNull();
  });

  it('returns null for single-segment paths (insufficient context)', () => {
    const url = new URL('https://cdn.example.com/file.webm');
    // Only 1 segment after filtering — need at least 2 (session + filename)
    const parts = extractStreamRecordingParts(url);
    expect(parts).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// STREAM_HOST_ALLOWLIST
// ---------------------------------------------------------------------------

describe('STREAM_HOST_ALLOWLIST', () => {
  it('contains stream-io-cdn.com', () => {
    expect(STREAM_HOST_ALLOWLIST).toContain('stream-io-cdn.com');
  });

  it('is a readonly array', () => {
    expect(Array.isArray(STREAM_HOST_ALLOWLIST)).toBe(true);
  });
});
