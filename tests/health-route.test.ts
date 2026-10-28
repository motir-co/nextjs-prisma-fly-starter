import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// THE HEALTH ROUTE ANSWERS WITH NOTHING CONFIGURED (MOTIR-9810). Every deploy
// waits on it before sending traffic, so it must not depend on a database or a
// secret: a suspended serverless database or a preview without Google must not
// read as a broken release.

const SOURCE = readFileSync(join(__dirname, '..', 'app/api/health/route.ts'), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('GET /api/health', () => {
  it('answers 200 {"status":"ok"} with the database and auth variables unset', async () => {
    for (const name of [
      'DATABASE_URL',
      'DATABASE_URL_UNPOOLED',
      'BETTER_AUTH_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]) {
      vi.stubEnv(name, '');
    }
    vi.resetModules();
    const { GET } = await import('@/app/api/health/route');

    const res = GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('is a leaf: it imports nothing from lib/auth or lib/db', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]@\/lib\/(auth|db)/);
    expect(SOURCE).not.toMatch(/\bimport\b[^;]*['"]\.\.?\//);
  });

  it('is rendered per request, never cached at build time', () => {
    expect(SOURCE).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});
