// E2E: Google OAuth golden path — intercepted at the HTTP boundary.
//
// @smoke — second of two specs in Story 1.1's E2E suite.
//
// What's mocked:
//   - The browser-side hop to https://accounts.google.com/o/oauth2/v2/auth
//     is intercepted by Playwright's page.route() and 302'd to
//     /api/auth/callback/google?code=...&state=... (state echoed back
//     verbatim because Better-Auth's callback verifies it).
//   - The server-side token exchange to https://oauth2.googleapis.com/token
//     is intercepted by an undici MockAgent installed in instrumentation.ts
//     (enabled by E2E_TEST_OAUTH=1, which the playwright config injects
//     into the dev server's env). The mock returns a synthetic id_token
//     whose JWT payload Better-Auth's google provider decodes (no
//     signature check on this code path) to extract sub/email/name.
//
// What's NOT mocked:
//   - Better-Auth's full callback handler, account-linking logic,
//     user/account/session writes — all run against the real Postgres.
//
// Two synthetic users used in three parts:
//   - GOOGLE_USER_EMAIL / GOOGLE_USER_SUB: a Google-first user. Parts 1
//     (sign-up via Google) and 2 (sign-in via Google returns same row).
//   - EMAIL_FIRST_EMAIL / EMAIL_FIRST_PASSWORD: a credentials-first user.
//     Part 3 exercises the auto-link direction — email/password signup
//     then later Google sign-in with the same email links into the
//     existing User, promotes emailVerified to true, and the User ends
//     up with both credential and google Account rows.
//
// Reverse direction (Google-first then email/password) is intentionally
// NOT exercised here — OAuth-only users have no credential Account row
// with a password hash, so credential sign-in returns INVALID_PASSWORD.
// Flagged in the PR body as a future Subtask.

import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { resetDatabase, db } from './_helpers/db-reset';

// See the matching note in auth-credentials.spec.ts — the smoke
// dashboard's POST-form sign-out returns 415, so we drop the session
// cookie instead. Better-Auth's session lives in a cookie only.
async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

const TEST_USER_PATH =
  process.env['E2E_TEST_OAUTH_USER_PATH'] ?? '/tmp/starter-test-oauth-user.json';

const GOOGLE_USER_EMAIL = 'google-e2e@example.com';
const GOOGLE_USER_SUB = 'google-sub-001';
const GOOGLE_USER_NAME = 'Google E2E User';

const EMAIL_FIRST_EMAIL = 'email-first-e2e@example.com';
const EMAIL_FIRST_PASSWORD = 'email-first-password-123';
const EMAIL_FIRST_SUB = 'google-sub-002';

// Writes the synthetic user profile that the dev server's mock token
// endpoint will return on the next exchange. Each step that triggers a
// Google sign-in must call this beforehand so the mock returns the right
// identity for that step.
async function setSyntheticGoogleUser(profile: {
  sub: string;
  email: string;
  name: string;
}): Promise<void> {
  await writeFile(TEST_USER_PATH, JSON.stringify({ ...profile, emailVerified: true }), 'utf8');
}

// Intercept the browser's hop to accounts.google.com and 302 it directly
// back to Better-Auth's callback. The `state` query param MUST be echoed
// back unchanged — Better-Auth verifies it to prevent CSRF.
async function installGoogleAuthorizeIntercept(page: Page): Promise<void> {
  await page.route('**/accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state') ?? '';
    const redirectUri =
      url.searchParams.get('redirect_uri') ?? 'http://localhost:3000/api/auth/callback/google';
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', `mock-auth-code-${Date.now()}`);
    callback.searchParams.set('state', state);
    callback.searchParams.set('scope', 'openid email profile');
    await route.fulfill({
      status: 302,
      headers: { location: callback.toString() },
      body: '',
    });
  });
}

test.beforeEach(async ({ page }) => {
  await resetDatabase();
  await installGoogleAuthorizeIntercept(page);
});

test.afterAll(async () => {
  await db.$disconnect();
});

test('@smoke Google OAuth happy path + email-first auto-link', async ({ page }) => {
  // --- Part 1: brand-new Google sign-up via /sign-up.
  await setSyntheticGoogleUser({
    sub: GOOGLE_USER_SUB,
    email: GOOGLE_USER_EMAIL,
    name: GOOGLE_USER_NAME,
  });

  await page.goto('/sign-up');
  await page.getByRole('button', { name: /^(Continue with Google|Connecting…)$/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('strong').getByText(GOOGLE_USER_EMAIL)).toBeVisible();

  // Exactly one user row + one google account row in the DB.
  const usersAfterFirst = await db.user.findMany({
    where: { email: GOOGLE_USER_EMAIL },
  });
  expect(usersAfterFirst).toHaveLength(1);
  const firstUserId = usersAfterFirst[0]!.id;
  const accountsAfterFirst = await db.account.findMany({
    where: { userId: firstUserId },
  });
  expect(accountsAfterFirst.map((a) => a.providerId).sort()).toEqual(['google']);

  // --- Part 2: sign out, sign back in via Google → same user row.
  await signOut(page);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /^(Continue with Google|Connecting…)$/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('strong').getByText(GOOGLE_USER_EMAIL)).toBeVisible();

  const usersAfterSecond = await db.user.findMany({
    where: { email: GOOGLE_USER_EMAIL },
  });
  expect(usersAfterSecond).toHaveLength(1);
  expect(usersAfterSecond[0]!.id).toBe(firstUserId);
  // Still just the one google account row — no duplicate.
  const accountsAfterSecond = await db.account.findMany({
    where: { userId: firstUserId },
  });
  expect(accountsAfterSecond).toHaveLength(1);

  // --- Part 3: email-first user signs in via Google with the same email
  //               → Better-Auth auto-links into the existing User row.
  //
  // This part exercises the supported auto-link direction declared by
  // Story 1.1's planner: trustedProviders: ['google'] +
  // requireLocalEmailVerified: false in lib/auth/index.ts. Better-Auth's
  // link-account.mjs guard:
  //
  //   - Provider is trusted (google in trustedProviders) → check passes.
  //   - requireLocalEmailVerified === false → no gate on the local
  //     user.emailVerified column.
  //   - userInfo.emailVerified true (our synthetic Google profile sets
  //     emailVerified: true; real Google always does for accounts.google.com
  //     identities) → linking proceeds.
  //
  // The link inserts a google Account row pointing at the existing
  // email-first userId AND promotes user.emailVerified to true (per
  // link-account.mjs line 48: if the incoming profile is verified and the
  // existing row isn't, set it). After this part, the email-first user
  // can sign in via either credentials or Google and lands on the same
  // identity.
  //
  // The REVERSE direction (Google-first user later using email/password)
  // remains unsupported — OAuth-only users have no credential Account row
  // with a password hash. Flagged in the PR body as a future Subtask.
  await signOut(page);

  // Create the credentials-first user by going through /sign-up.
  await page.goto('/sign-up');
  await page.getByPlaceholder('Email address').fill(EMAIL_FIRST_EMAIL);
  // exact:true — "Continue with Google" is also visible on this page.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('Create a password').fill(EMAIL_FIRST_PASSWORD);
  await page.getByRole('button', { name: /^(Create account|Creating account…)$/ }).click();
  await page.waitForURL('**/dashboard');

  // Snapshot the email-first user — there should be ONE row with a
  // credential account and emailVerified=false (verification UX is not
  // yet wired; the auto-link below will flip this to true).
  const emailFirstBefore = await db.user.findMany({
    where: { email: EMAIL_FIRST_EMAIL },
  });
  expect(emailFirstBefore).toHaveLength(1);
  const emailFirstUserId = emailFirstBefore[0]!.id;
  expect(emailFirstBefore[0]!.emailVerified).toBe(false);
  const credAccountBefore = await db.account.findMany({
    where: { userId: emailFirstUserId },
  });
  expect(credAccountBefore.map((a) => a.providerId).sort()).toEqual(['credential']);

  // Sign out, then sign in via Google with the SAME email. Expected:
  // Better-Auth links the new google Account row to the existing User,
  // promotes the User's emailVerified to true, lands on /dashboard.
  await signOut(page);
  await setSyntheticGoogleUser({
    sub: EMAIL_FIRST_SUB,
    email: EMAIL_FIRST_EMAIL,
    name: 'Email First E2E',
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /^(Continue with Google|Connecting…)$/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('strong').getByText(EMAIL_FIRST_EMAIL)).toBeVisible();

  // DB shape after auto-link:
  //   - Still exactly one User row for this email (no duplicate signup).
  //   - That User's id matches the one created during email/password sign-up.
  //   - emailVerified is now true (promoted by Better-Auth on the link).
  //   - Two Account rows on this userId: credential AND google.
  const emailFirstAfter = await db.user.findMany({
    where: { email: EMAIL_FIRST_EMAIL },
  });
  expect(emailFirstAfter).toHaveLength(1);
  expect(emailFirstAfter[0]!.id).toBe(emailFirstUserId);
  expect(emailFirstAfter[0]!.emailVerified).toBe(true);

  const accountsAfter = await db.account.findMany({
    where: { userId: emailFirstUserId },
  });
  expect(accountsAfter.map((a) => a.providerId).sort()).toEqual(['credential', 'google']);
});
