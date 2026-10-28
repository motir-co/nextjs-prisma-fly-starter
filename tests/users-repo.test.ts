import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  createUser,
  findUserByEmail,
  verifyPassword,
  findOrCreateOAuthUser,
} from '@/lib/users/repo';
import { DuplicateEmailError } from '@/lib/users/errors';
import { truncateAuthTables } from './helpers/db';

beforeEach(async () => {
  await truncateAuthTables();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('createUser', () => {
  it('creates a user with a credential account row', async () => {
    const user = await createUser({
      email: 'alice@example.com',
      password: 'hunter2hunter2',
      name: 'Alice',
    });

    expect(user.email).toBe('alice@example.com');
    expect(user.emailVerified).toBe(false);

    const credential = await db.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
    });
    expect(credential).not.toBeNull();
    expect(credential!.password).toMatch(/^\$argon2id\$/);
  });

  it('normalizes email to lowercase on write', async () => {
    const user = await createUser({
      email: 'Alice@Example.COM',
      password: 'hunter2hunter2',
    });
    expect(user.email).toBe('alice@example.com');
  });

  it('throws DuplicateEmailError on a second create with the same email', async () => {
    await createUser({ email: 'alice@example.com', password: 'hunter2hunter2' });
    await expect(
      createUser({ email: 'alice@example.com', password: 'different-password' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('treats different-case duplicates as the same email', async () => {
    await createUser({ email: 'alice@example.com', password: 'hunter2hunter2' });
    await expect(
      createUser({ email: 'ALICE@example.com', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    await createUser({ email: 'alice@example.com', password: 'hunter2hunter2' });
    expect(await verifyPassword('alice@example.com', 'hunter2hunter2')).toBe(true);
  });

  it('returns false for the wrong password', async () => {
    await createUser({ email: 'alice@example.com', password: 'hunter2hunter2' });
    expect(await verifyPassword('alice@example.com', 'wrong')).toBe(false);
  });

  it('returns false (no throw) for an unknown email', async () => {
    expect(await verifyPassword('nobody@example.com', 'whatever')).toBe(false);
  });

  it('returns false for an OAuth-only user (no credential account)', async () => {
    await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-1',
      email: 'oauth@example.com',
    });
    expect(await verifyPassword('oauth@example.com', 'anything')).toBe(false);
  });
});

describe('findUserByEmail', () => {
  it('finds a user case-insensitively', async () => {
    await createUser({ email: 'alice@example.com', password: 'hunter2hunter2' });
    const found = await findUserByEmail('ALICE@example.COM');
    expect(found?.email).toBe('alice@example.com');
  });

  it('returns null for an unknown email', async () => {
    expect(await findUserByEmail('nobody@example.com')).toBeNull();
  });
});

describe('findOrCreateOAuthUser', () => {
  it('creates a new user when neither the OAuth account nor email exists', async () => {
    const user = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-1',
      email: 'newcomer@example.com',
      name: 'Newcomer',
      image: 'https://example.com/pic.png',
    });

    expect(user.email).toBe('newcomer@example.com');
    expect(user.emailVerified).toBe(true);
    expect(user.name).toBe('Newcomer');

    const credential = await db.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
    });
    expect(credential).toBeNull();

    const oauth = await db.account.findUnique({
      where: {
        providerId_accountId: { providerId: 'google', accountId: 'google-uid-1' },
      },
    });
    expect(oauth?.userId).toBe(user.id);
  });

  it('links to an existing email/password user (auto-link policy)', async () => {
    const existing = await createUser({
      email: 'alice@example.com',
      password: 'hunter2hunter2',
      name: 'Alice',
    });
    expect(existing.emailVerified).toBe(false);

    const linked = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-alice',
      email: 'alice@example.com',
    });

    expect(linked.id).toBe(existing.id);
    expect(linked.emailVerified).toBe(true);

    // Both Account rows now exist for the same user.
    const accounts = await db.account.findMany({ where: { userId: existing.id } });
    expect(accounts).toHaveLength(2);
    const providers = accounts.map((a) => a.providerId).sort();
    expect(providers).toEqual(['credential', 'google']);
  });

  it('is idempotent — same (provider, providerAccountId) returns the same user', async () => {
    const first = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-repeat',
      email: 'repeat@example.com',
    });
    const second = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-repeat',
      email: 'repeat@example.com',
    });
    expect(second.id).toBe(first.id);

    const accountCount = await db.account.count({
      where: { providerId: 'google', accountId: 'google-uid-repeat' },
    });
    expect(accountCount).toBe(1);
  });

  it('refreshes tokens on a repeat sign-in', async () => {
    await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-tokens',
      email: 'tokens@example.com',
      accessToken: 'old-access',
    });
    await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: 'google-uid-tokens',
      email: 'tokens@example.com',
      accessToken: 'new-access',
    });

    const account = await db.account.findUnique({
      where: {
        providerId_accountId: {
          providerId: 'google',
          accountId: 'google-uid-tokens',
        },
      },
    });
    expect(account?.accessToken).toBe('new-access');
  });
});
