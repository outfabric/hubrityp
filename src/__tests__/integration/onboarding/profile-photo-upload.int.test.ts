import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { uploadProfilePhotoImpl } from '@/modules/onboarding';

// ---------------------------------------------------------------------------
// Section-5 server-validated profile photo upload (onboarding-wizard change).
//
// The Testcontainers setup provides raw Postgres only — there is no Supabase
// Storage API — so we exercise the action against a MOCK storage client that
// records every `upload(path, file, opts)` call. This is the same approach the
// ai-transcription upload-security suite uses. What we prove here is the part
// that lives entirely in our code (and is the actual security boundary):
//   * unauthenticated callers are rejected
//   * oversized files are rejected SERVER-side (nothing uploaded)
//   * non-image MIME types are rejected SERVER-side (nothing uploaded)
//   * a valid image uploads under a SERVER-generated UUID name (never the
//     user-supplied filename) in the owner-scoped prefix `<userId>/<uuid>.<ext>`
//   * two different users never collide — each upload lands under its own prefix
//
// The owner-scoped Storage RLS policies themselves (migration 0035) would be
// validated against a real Supabase Storage stack; the path-prefix assertion
// here proves our code keys objects under `auth.uid()`, which is what those
// policies enforce.
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const OBJECT_KEY_REGEX = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

interface RecordedUpload {
  path: string;
  contentType: string | undefined;
}

/**
 * Builds a mock Supabase client: a fixed authenticated user (or anonymous when
 * `userId` is null) plus a storage stub that records every upload call so the
 * test can assert the generated object key.
 */
function createMockSupabase(userId: string | null) {
  const uploads: RecordedUpload[] = [];

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn((path: string, _file: File, opts?: { contentType?: string }) => {
          uploads.push({ path, contentType: opts?.contentType });
          return Promise.resolve({ data: { path }, error: null });
        }),
      })),
    },
  } as unknown as Parameters<typeof uploadProfilePhotoImpl>[0];

  return { client, uploads };
}

function makeFormData(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return fd;
}

function imageFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('uploadProfilePhotoImpl — server-validated profile photo upload', () => {
  it('rejects an unauthenticated caller and uploads nothing', async () => {
    const { client, uploads } = createMockSupabase(null);

    const result = await uploadProfilePhotoImpl(
      client,
      makeFormData(imageFile('me.png', 'image/png', 1024)),
    );

    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
    expect(uploads).toHaveLength(0);
  });

  it('rejects when no file is present', async () => {
    const { client, uploads } = createMockSupabase(randomUUID());

    const result = await uploadProfilePhotoImpl(client, makeFormData(null));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('no_file');
    expect(uploads).toHaveLength(0);
  });

  it('rejects an oversized file SERVER-side (nothing uploaded)', async () => {
    const { client, uploads } = createMockSupabase(randomUUID());

    const result = await uploadProfilePhotoImpl(
      client,
      makeFormData(imageFile('huge.jpg', 'image/jpeg', MAX_FILE_SIZE_BYTES + 1)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('file_too_large');
    expect(uploads).toHaveLength(0);
  });

  it('rejects a non-image MIME type SERVER-side (nothing uploaded)', async () => {
    const { client, uploads } = createMockSupabase(randomUUID());

    // A PDF disguised by extension — the server validates the MIME, not the name.
    const result = await uploadProfilePhotoImpl(
      client,
      makeFormData(imageFile('photo.png', 'application/pdf', 1024)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('invalid_file_type');
    expect(uploads).toHaveLength(0);
  });

  it('accepts a valid image and stores it under a UUID name (not the supplied name) in the owner prefix', async () => {
    const userId = randomUUID();
    const { client, uploads } = createMockSupabase(userId);

    const result = await uploadProfilePhotoImpl(
      client,
      makeFormData(imageFile('My Secret Photo.png', 'image/png', 2048)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');

    // Object key is owner-scoped, UUID-named, with a MIME-derived extension.
    expect(result.objectKey).toMatch(OBJECT_KEY_REGEX);
    expect(result.objectKey.startsWith(`${userId}/`)).toBe(true);
    expect(result.objectKey).toMatch(/\.png$/);

    // The user-supplied filename never appears in the stored key.
    expect(result.objectKey).not.toContain('My Secret Photo');
    expect(result.objectKey.toLowerCase()).not.toContain('secret');

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toBe(result.objectKey);
    expect(uploads[0]!.contentType).toBe('image/png');
  });

  it('derives the extension from the MIME type, ignoring a spoofed filename extension', async () => {
    const userId = randomUUID();
    const { client } = createMockSupabase(userId);

    // Filename claims .gif, but MIME is webp → stored as .webp.
    const result = await uploadProfilePhotoImpl(
      client,
      makeFormData(imageFile('avatar.gif', 'image/webp', 1024)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.objectKey).toMatch(/\.webp$/);
    expect(result.objectKey).not.toContain('.gif');
  });

  it('isolates two users — each upload lands under its own owner prefix', async () => {
    const userA = randomUUID();
    const userB = randomUUID();

    const a = createMockSupabase(userA);
    const b = createMockSupabase(userB);

    const resultA = await uploadProfilePhotoImpl(
      a.client,
      makeFormData(imageFile('a.jpg', 'image/jpeg', 1024)),
    );
    const resultB = await uploadProfilePhotoImpl(
      b.client,
      makeFormData(imageFile('b.jpg', 'image/jpeg', 1024)),
    );

    expect(resultA.ok && resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) throw new Error('expected success');

    expect(resultA.objectKey.startsWith(`${userA}/`)).toBe(true);
    expect(resultB.objectKey.startsWith(`${userB}/`)).toBe(true);
    // No cross-prefix leakage.
    expect(resultA.objectKey.startsWith(`${userB}/`)).toBe(false);
    expect(resultB.objectKey.startsWith(`${userA}/`)).toBe(false);
  });
});
