import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw-server';
import { rawPool } from './db';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await rawPool.end();
});
