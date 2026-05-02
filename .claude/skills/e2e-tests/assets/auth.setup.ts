import { test as setup } from '@playwright/test';
import { SignJWT } from 'jose';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authUsers, psicologos } from '@/lib/db/schema';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const AUTH_FILE = resolve(__dirname, 'playwright/.auth/user.json');
const SEED_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dr.seed@hubrityp.test',
  nome: 'Dr. Seed',
  crp: '06/000000',
};

setup('autentica psicólogo seed', async ({ page, baseURL }) => {
  await mkdir(resolve(AUTH_FILE, '..'), { recursive: true });

  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  const db = drizzle(pool);

  await db
    .insert(authUsers)
    .values({ id: SEED_USER.id, email: SEED_USER.email })
    .onConflictDoNothing();
  await db
    .insert(psicologos)
    .values({ id: SEED_USER.id, nome: SEED_USER.nome, crp: SEED_USER.crp })
    .onConflictDoNothing();
  await pool.end();

  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  const token = await new SignJWT({
    sub: SEED_USER.id,
    email: SEED_USER.email,
    role: 'authenticated',
    aud: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);

  const projectRef =
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0] ??
    'localhost';
  const cookieValue = JSON.stringify({
    access_token: token,
    token_type: 'bearer',
    user: { id: SEED_USER.id, email: SEED_USER.email },
  });

  await page.context().addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: encodeURIComponent(cookieValue),
      url: baseURL!,
    },
  ]);

  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: AUTH_FILE });
});
