import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSsrServerClientMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: createSsrServerClientMock,
}));

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

beforeEach(() => {
  createSsrServerClientMock.mockReset();
  cookiesMock.mockReset();
  cookiesMock.mockResolvedValue({
    getAll: () => [{ name: 'sb-access-token', value: 'cookie-value' }],
    set: vi.fn(),
  });
  createSsrServerClientMock.mockReturnValue({ marker: 'server-client' });
});

describe('lib/supabase/server.createServerClient', () => {
  it('reads cookies from next/headers and constructs the client with the public env', async () => {
    const { createServerClient } = await import('./server');
    const client = await createServerClient();

    expect(client).toEqual({ marker: 'server-client' });
    expect(cookiesMock).toHaveBeenCalledTimes(1);
    expect(createSsrServerClientMock).toHaveBeenCalledTimes(1);

    const call = createSsrServerClientMock.mock.calls[0] as [
      string,
      string,
      { cookies: { getAll: () => unknown[] } },
    ];
    const [url, anonKey, options] = call;
    expect(url).toBe('http://127.0.0.1:54321');
    expect(anonKey).toBe('unit-test-anon-key');
    expect(options.cookies.getAll()).toEqual([{ name: 'sb-access-token', value: 'cookie-value' }]);
  });
});
