import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { findOrCreateOAuthUser, createUser } from '@/lib/users/repo';
import { truncateAuthTables } from './helpers/db';

beforeEach(async () => {
  await truncateAuthTables();
});

describe('Better-Auth Google provider registration', () => {
  it('auth instance constructs without throwing when both Google env vars are set', async () => {
    // Defaults from vitest.config.ts populate the env; just import the
    // module and assert the export exists. If the provider registration
    // were broken, the module-load `requiredEnv` chain would throw here.
    const { auth } = await import('@/lib/auth');
    expect(auth).toBeDefined();
    expect(typeof auth.api.getSession).toBe('function');
  });

  describe('requiredEnv error path', () => {
    // Each variant unsets one env var, then re-imports the auth module after
    // resetting Vitest's module registry so we get a fresh module-load.
    // vi.unstubAllEnvs + vi.resetModules undo the changes so the rest of the
    // suite keeps the populated env from vitest.config.ts.
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('throws a clear error when GOOGLE_CLIENT_ID is missing', async () => {
      vi.stubEnv('GOOGLE_CLIENT_ID', '');
      vi.resetModules();
      await expect(import('@/lib/auth')).rejects.toThrow(/GOOGLE_CLIENT_ID is not set/);
    });

    it('throws a clear error when GOOGLE_CLIENT_SECRET is missing', async () => {
      vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
      vi.resetModules();
      await expect(import('@/lib/auth')).rejects.toThrow(/GOOGLE_CLIENT_SECRET is not set/);
    });
  });
});

// Re-verifies that the auto-link semantics 1.1.3 built into the repo still
// work end-to-end against the post-1.1.4 schema. Better-Auth's
// accountLinking.trustedProviders config delivers the same policy at the
// framework level for OAuth round-trips it owns; this test exercises the
// repo path that any future provider-Better-Auth-doesn't-natively-support
// would funnel through.
describe('findOrCreateOAuthUser auto-link path (Story 1.1 decision)', () => {
  it('links a Google sign-in to a pre-existing email/password user', async () => {
    const existing = await createUser({
      email: 'overlap@example.com',
      password: 'hunter2hunter2',
      name: 'Overlap',
    });
    expect(existing.emailVerified).toBe(false);

    const linked = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-overlap',
      email: 'overlap@example.com',
    });

    expect(linked.id).toBe(existing.id);
    expect(linked.emailVerified).toBe(true);

    const accounts = await db.account.findMany({ where: { userId: existing.id } });
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.providerId).sort()).toEqual(['credential', 'google']);
  });

  it('creates a brand-new User on first Google sign-in with an unknown email', async () => {
    const fresh = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-fresh',
      email: 'fresh@example.com',
      name: 'Fresh',
      image: 'https://example.com/fresh.png',
    });

    expect(fresh.email).toBe('fresh@example.com');
    expect(fresh.emailVerified).toBe(true);

    const credential = await db.account.findFirst({
      where: { userId: fresh.id, providerId: 'credential' },
    });
    expect(credential).toBeNull();
  });
});
