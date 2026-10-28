import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createUser, verifyPassword } from '@/lib/users/repo';
import { truncateAuthTables } from './helpers/db';

// Integration tests for Better-Auth's password-reset flow against a real
// Postgres. Token storage / single-use / expiry semantics are owned by
// Better-Auth — we test the contract we care about (Verification row
// shape, single-use, expiry, no-enumeration, rate-limit), not Better-Auth
// internals. The rate-limit suite is in a separate describe block at the
// bottom because it shares Better-Auth's in-memory limiter state across
// cases and needs deterministic ordering.

const BASE_URL = 'http://localhost:3000';

// Best-effort header-only origin spoof for the handler-based requests
// below. The originCheck middleware compares against `baseURL` (set to
// http://localhost:3000 in lib/auth/index.ts), so this Origin satisfies it.
function buildHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'content-type': 'application/json',
    origin: BASE_URL,
    ...(extra ?? {}),
  };
}

function captureEmails(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((arg) => {
    if (typeof arg === 'string' && arg.startsWith('[EMAIL]')) {
      lines.push(arg);
    }
    // Drop everything else silently so test output stays clean.
  });
  return { lines, restore: () => spy.mockRestore() };
}

function tokenFromEmailLine(line: string): string {
  // Reset URL shape from better-auth password.mjs:
  //   ${baseURL}/api/auth/reset-password/${token}?callbackURL=...
  // Strip the prefix and the query string.
  const match = line.match(/\/api\/auth\/reset-password\/([A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error(`No reset token found in email line: ${line}`);
  }
  return match[1]!;
}

beforeEach(async () => {
  await truncateAuthTables();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('forget-password (auth.api.requestPasswordReset)', () => {
  let captured: ReturnType<typeof captureEmails>;

  beforeEach(() => {
    captured = captureEmails();
  });

  afterEach(() => {
    captured.restore();
  });

  it('creates a Verification row and sends the reset email with the token', async () => {
    const user = await createUser({
      email: 'reset-1@example.com',
      password: 'hunter2hunter2',
      name: 'Reset One',
    });

    await auth.api.requestPasswordReset({
      body: {
        email: 'reset-1@example.com',
        redirectTo: `${BASE_URL}/reset-password`,
      },
    });

    expect(captured.lines).toHaveLength(1);
    const token = tokenFromEmailLine(captured.lines[0]!);
    expect(token.length).toBeGreaterThan(0);

    // Verification row is keyed by `reset-password:<token>`, with the
    // value being the user id — see better-auth/dist/api/routes/password.mjs.
    const row = await db.verification.findFirst({
      where: { identifier: `reset-password:${token}` },
    });
    expect(row).not.toBeNull();
    expect(row!.value).toBe(user.id);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns success silently and sends no email for an unknown address (no enumeration)', async () => {
    const result = await auth.api.requestPasswordReset({
      body: {
        email: 'ghost@example.com',
        redirectTo: `${BASE_URL}/reset-password`,
      },
    });

    expect(result.status).toBe(true);
    expect(captured.lines).toHaveLength(0);

    const rowCount = await db.verification.count();
    expect(rowCount).toBe(0);
  });
});

describe('reset-password (auth.api.resetPassword)', () => {
  let captured: ReturnType<typeof captureEmails>;

  beforeEach(() => {
    captured = captureEmails();
  });

  afterEach(() => {
    captured.restore();
  });

  it('rotates the credential password hash and consumes the token (single-use)', async () => {
    await createUser({
      email: 'reset-2@example.com',
      password: 'oldpassword12',
      name: 'Reset Two',
    });

    await auth.api.requestPasswordReset({
      body: {
        email: 'reset-2@example.com',
        redirectTo: `${BASE_URL}/reset-password`,
      },
    });
    const token = tokenFromEmailLine(captured.lines[0]!);

    await auth.api.resetPassword({
      body: { token, newPassword: 'newpassword12' },
    });

    // The new password works; the old one does not — exercised against
    // the same argon2 verify path the login flow uses.
    expect(await verifyPassword('reset-2@example.com', 'newpassword12')).toBe(true);
    expect(await verifyPassword('reset-2@example.com', 'oldpassword12')).toBe(false);

    // Single-use: Better-Auth deletes the Verification row after a
    // successful reset (deleteVerificationByIdentifier in password.mjs).
    const rowAfter = await db.verification.findFirst({
      where: { identifier: `reset-password:${token}` },
    });
    expect(rowAfter).toBeNull();

    // A second reset attempt with the same token must fail — the row is
    // gone, so the handler hits the INVALID_TOKEN branch.
    await expect(
      auth.api.resetPassword({
        body: { token, newPassword: 'anotherpassword12' },
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' });
  });

  it('rejects an expired token', async () => {
    await createUser({
      email: 'reset-3@example.com',
      password: 'oldpassword12',
      name: 'Reset Three',
    });

    await auth.api.requestPasswordReset({
      body: {
        email: 'reset-3@example.com',
        redirectTo: `${BASE_URL}/reset-password`,
      },
    });
    const token = tokenFromEmailLine(captured.lines[0]!);

    // Backdate the row's expiry — simulates the user clicking the link
    // after the 1-hour window. We touch the DB directly rather than wait
    // an hour; the handler in better-auth's password.mjs checks
    // `verification.expiresAt < new Date()` so any past timestamp suffices.
    await db.verification.update({
      where: {
        id: (
          await db.verification.findFirstOrThrow({
            where: { identifier: `reset-password:${token}` },
          })
        ).id,
      },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      auth.api.resetPassword({
        body: { token, newPassword: 'newpassword12' },
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' });

    // The old password should still verify — the reset never landed.
    expect(await verifyPassword('reset-3@example.com', 'oldpassword12')).toBe(true);
  });
});

describe('rate limit on /request-password-reset', () => {
  // This block goes through auth.handler() with real synthetic Requests so
  // the rate-limiter middleware actually runs. The limiter keys by client
  // IP; getIp() falls back to 127.0.0.1 in test/dev when no
  // x-forwarded-for header is present, which is fine for this case —
  // every request in the loop shares the same key, so the 4th one trips
  // the configured 3/hour limit.
  //
  // Better-Auth's in-memory rate-limit storage is process-wide, so other
  // test files in this suite that touch /request-password-reset would
  // share state with this one. They don't (auth.api.* direct calls bypass
  // the limiter entirely, as the limiter requires a Request). If that
  // changes, this test should pin a unique x-forwarded-for IP per case.
  let captured: ReturnType<typeof captureEmails>;

  beforeEach(() => {
    captured = captureEmails();
  });

  afterEach(() => {
    captured.restore();
  });

  async function postForgetPassword(email: string): Promise<Response> {
    return auth.handler(
      new Request(`${BASE_URL}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          email,
          redirectTo: `${BASE_URL}/reset-password`,
        }),
      }),
    );
  }

  it('allows 3 requests in the window and rejects the 4th', async () => {
    await createUser({
      email: 'rl@example.com',
      password: 'hunter2hunter2',
      name: 'RL',
    });

    const r1 = await postForgetPassword('rl@example.com');
    const r2 = await postForgetPassword('rl@example.com');
    const r3 = await postForgetPassword('rl@example.com');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    const r4 = await postForgetPassword('rl@example.com');
    expect(r4.status).toBe(429);
  });
});
