import { describe, expect, it, vi } from 'vitest';

import { validateStreamUrl } from '@/modules/ai-transcription/inngest/ingest-stream-recording';

/**
 * SSRF payload tests for `ingestStreamRecording`.
 *
 * Verifies that the SSRF guard in `validateStreamUrl` (the entry point used
 * by `ingestStreamRecording`'s `download-from-stream` step) rejects specific
 * malicious payloads without making any network calls.
 *
 * Each payload targets a different SSRF vector:
 *   - 127.0.0.1 (loopback)
 *   - 169.254.169.254 (AWS IMDS — cloud metadata)
 *   - [::1] (IPv6 loopback)
 *   - 10.0.0.1 (private RFC 1918)
 *   - evil.com (public hostname not in the Stream CDN allowlist)
 */

describe('SSRF payloads for ingestStreamRecording', () => {
  // The DNS resolver should never be called for hosts not in the allowlist
  // (hostname check fails first). For completeness we provide a resolver
  // that would fail the test if invoked — proving no network call occurs.
  const failingDns = vi.fn((): Promise<string[]> => {
    return Promise.reject(new Error('DNS resolver should not be called for non-allowlisted hosts'));
  });

  it('rejects http://127.0.0.1/recordings/session/file.webm (loopback)', async () => {
    await expect(
      validateStreamUrl('http://127.0.0.1/recordings/session/file.webm', {
        resolveDns: failingDns,
      }),
    ).rejects.toThrow('SSRF: hostname "127.0.0.1" not in Stream CDN allowlist');

    // No network call was made
    expect(failingDns).not.toHaveBeenCalled();
  });

  it('rejects http://169.254.169.254/latest/meta-data (AWS IMDS)', async () => {
    await expect(
      validateStreamUrl('http://169.254.169.254/latest/meta-data', {
        resolveDns: failingDns,
      }),
    ).rejects.toThrow('SSRF: hostname "169.254.169.254" not in Stream CDN allowlist');

    expect(failingDns).not.toHaveBeenCalled();
  });

  it('rejects http://[::1]/recordings/session/file.webm (IPv6 loopback)', async () => {
    await expect(
      validateStreamUrl('http://[::1]/recordings/session/file.webm', {
        resolveDns: failingDns,
      }),
    ).rejects.toThrow('not in Stream CDN allowlist');

    expect(failingDns).not.toHaveBeenCalled();
  });

  it('rejects http://10.0.0.1/recordings/session/file.webm (private RFC 1918)', async () => {
    await expect(
      validateStreamUrl('http://10.0.0.1/recordings/session/file.webm', {
        resolveDns: failingDns,
      }),
    ).rejects.toThrow('SSRF: hostname "10.0.0.1" not in Stream CDN allowlist');

    expect(failingDns).not.toHaveBeenCalled();
  });

  it('rejects https://evil.com/recordings/session/file.webm (non-allowlisted public host)', async () => {
    await expect(
      validateStreamUrl('https://evil.com/recordings/session/file.webm', {
        resolveDns: failingDns,
      }),
    ).rejects.toThrow('SSRF: hostname "evil.com" not in Stream CDN allowlist');

    expect(failingDns).not.toHaveBeenCalled();
  });

  it('rejects all five payloads collectively without any network call', async () => {
    const payloads = [
      'http://127.0.0.1/recordings/session/file.webm',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/recordings/session/file.webm',
      'http://10.0.0.1/recordings/session/file.webm',
      'https://evil.com/recordings/session/file.webm',
    ];

    const tracker = vi.fn((): Promise<string[]> => {
      return Promise.reject(new Error('Should not resolve DNS'));
    });

    for (const url of payloads) {
      await expect(validateStreamUrl(url, { resolveDns: tracker })).rejects.toThrow(
        'not in Stream CDN allowlist',
      );
    }

    // Confirm zero DNS lookups across all payloads — the hostname check
    // short-circuits before DNS resolution for non-allowlisted hosts.
    expect(tracker).not.toHaveBeenCalled();
  });
});
