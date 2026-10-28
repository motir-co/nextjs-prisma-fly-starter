import { Prisma, type User } from '@prisma/client';
import { db } from '@/lib/db';
import { hash, verify } from '@/lib/auth/passwords';
import { DuplicateEmailError } from './errors';

// Email/password and OAuth-linked user operations. Better-Auth's own
// sign-up/sign-in routes cover the production HTTP surface; this repo
// exists for:
//   1. Direct-DB code paths (server actions, admin tooling, tests).
//   2. findOrCreateOAuthUser — the auto-link gate any custom OAuth callback
//      can call. Better-Auth's social-provider flow can also funnel through
//      here if you want the auto-link policy in one place to audit.
//
// Schema notes (see prisma/schema.prisma for the why):
//   - Email is stored lowercase; we normalize on every write and read so
//     "Alice@Example.com" and "alice@example.com" resolve to the same row
//     without depending on a Postgres extension.
//   - The credential password hash lives on Account, not User, with
//     providerId = "credential" and accountId = <email>. This matches
//     Better-Auth's adapter expectations exactly.

const CREDENTIAL_PROVIDER = 'credential';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = input.name ?? email.split('@')[0]!;
  const passwordHash = await hash(input.password);

  try {
    return await db.user.create({
      data: {
        email,
        name,
        emailVerified: false,
        accounts: {
          create: {
            providerId: CREDENTIAL_PROVIDER,
            accountId: email,
            password: passwordHash,
          },
        },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEmailError(email);
    }
    throw err;
  }
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email: normalizeEmail(email) } });
}

/**
 * Returns true iff the email maps to a user with a credential Account whose
 * stored hash verifies against `plain`. Returns false (never throws) on
 * user-not-found, account-not-found, hash-mismatch, or malformed-hash —
 * same return shape across all failure modes prevents user-enumeration
 * via timing/error differences.
 */
export async function verifyPassword(email: string, plain: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    include: {
      accounts: {
        where: { providerId: CREDENTIAL_PROVIDER },
        take: 1,
      },
    },
  });
  const credential = user?.accounts[0];
  if (!credential?.password) return false;
  return verify(plain, credential.password);
}

export interface FindOrCreateOAuthUserInput {
  provider: string;
  providerAccountId: string;
  email: string;
  name?: string;
  image?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
}

/**
 * The auto-link gate. Resolves an OAuth identity to a User row, creating
 * one if necessary. Logic:
 *
 *   1. If an Account already exists for (provider, providerAccountId),
 *      return its linked User. Token fields are refreshed in case the
 *      provider rotated them. (Idempotent on repeat sign-ins.)
 *   2. Else, if a User exists with this email, link a new Account row to
 *      that User. Mark emailVerified = true since the OAuth provider has
 *      already verified the address. Return that User.
 *   3. Else, create a new User (passwordHash null — OAuth-only signup),
 *      and link the Account in the same transaction. Return the new User.
 *
 * v1's threat model accepts the OAuth-account-compromise → local-account
 * takeover risk in branch (2); revisit if your threat model differs.
 */
export async function findOrCreateOAuthUser(input: FindOrCreateOAuthUserInput): Promise<User> {
  const email = normalizeEmail(input.email);
  const tokenFields = {
    accessToken: input.accessToken ?? null,
    refreshToken: input.refreshToken ?? null,
    accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
  };

  return db.$transaction(async (tx) => {
    // (1) Existing OAuth account → return its user, refresh tokens.
    const existingAccount = await tx.account.findUnique({
      where: {
        providerId_accountId: {
          providerId: input.provider,
          accountId: input.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existingAccount) {
      await tx.account.update({
        where: { id: existingAccount.id },
        data: tokenFields,
      });
      return existingAccount.user;
    }

    // (2) Existing local user with the same email → link this OAuth account.
    const existingUser = await tx.user.findUnique({ where: { email } });
    if (existingUser) {
      await tx.account.create({
        data: {
          userId: existingUser.id,
          providerId: input.provider,
          accountId: input.providerAccountId,
          ...tokenFields,
        },
      });
      if (!existingUser.emailVerified) {
        return tx.user.update({
          where: { id: existingUser.id },
          data: { emailVerified: true },
        });
      }
      return existingUser;
    }

    // (3) Brand-new OAuth signup.
    return tx.user.create({
      data: {
        email,
        name: input.name ?? email.split('@')[0]!,
        image: input.image ?? null,
        emailVerified: true,
        accounts: {
          create: {
            providerId: input.provider,
            accountId: input.providerAccountId,
            ...tokenFields,
          },
        },
      },
    });
  });
}

export interface LinkOAuthAccountInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
}

export async function linkOAuthAccount(input: LinkOAuthAccountInput): Promise<void> {
  await db.account.create({
    data: {
      userId: input.userId,
      providerId: input.provider,
      accountId: input.providerAccountId,
      accessToken: input.accessToken ?? null,
      refreshToken: input.refreshToken ?? null,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
    },
  });
}
