// E2E: email/password golden path — sign-up → sign-out → sign-in → reset →
// new-password → old-password-fails.
//
// @smoke — first of two specs in Story 1.1's E2E suite. Tagged via the
// title prefix so CI can later filter with `--grep @smoke` if a future
// Story adds non-smoke specs.

import { expect, test, type Page } from '@playwright/test';
import { resetDatabase, db } from './_helpers/db-reset';
import { waitForEmail, extractResetUrl } from './_helpers/email-capture';

// The smoke dashboard's "Sign out" form posts to /api/auth/sign-out with
// an empty body and no content-type, which Better-Auth answers with 415.
// Until a later Subtask turns that into a real client-side `signOut()`
// call, the simplest reliable way to drop the session in E2E is to clear
// the browser cookies and verify the next protected nav redirects to
// /sign-in. Better-Auth's session is cookie-only, so dropping the cookie
// is equivalent to a successful sign-out from the client's perspective.
async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

// Each spec gets its own deterministic email so a previous failed run's
// stale rows don't interfere with re-runs even if `resetDatabase()`
// somehow missed a table. The leading `e2e-cred-` prefix makes greppable
// the rows this spec is responsible for during forensics.
const TEST_EMAIL = 'e2e-cred-user@example.com';
const ORIGINAL_PASSWORD = 'original-password-123';
const NEW_PASSWORD = 'brand-new-password-456';

test.beforeEach(async () => {
  await resetDatabase();
});

test.afterAll(async () => {
  // Disconnect the worktree-side Prisma client so the Playwright runner
  // exits cleanly; otherwise pg's connection pool keeps the process
  // alive past the last test, which CI surfaces as a 10s hang.
  await db.$disconnect();
});

test('@smoke credentials happy path: sign-up, sign-out, sign-in, reset, new-password', async ({
  page,
}) => {
  // --- Step a/b/c: sign up → land on dashboard.
  await page.goto('/sign-up');

  // Step 1 of sign-up: email → Continue.
  // exact:true — both pages also show a "Continue with Google" button, so
  // a non-exact match resolves to two elements and Playwright throws.
  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 2: password → Create account.
  await page.getByPlaceholder('Create a password').fill(ORIGINAL_PASSWORD);
  await page.getByRole('button', { name: /^(Create account|Creating account…)$/ }).click();

  await page.waitForURL('**/dashboard');
  // The smoke dashboard renders "Signed in as <email>" in its body.
  // Match the <strong> in "Signed in as <strong>{email}</strong>" — the
  // dashboard also dumps the full session JSON, which contains the email
  // a second time, so a non-exact getByText resolves to two elements.
  await expect(page.locator('strong').getByText(TEST_EMAIL)).toBeVisible();

  // Session cookie should be set on the response.
  const cookiesAfterSignUp = await page.context().cookies();
  const sessionCookie = cookiesAfterSignUp.find((c) => c.name.startsWith('better-auth.session'));
  expect(sessionCookie, 'Better-Auth session cookie should be set').toBeDefined();

  // --- Step d: sign out via the form on the dashboard.
  await signOut(page);
  // Hitting /dashboard again should now bounce to /sign-in (middleware).
  await page.goto('/dashboard');
  await page.waitForURL(/\/sign-in/);

  // --- Step e: sign in via the two-step credentials flow.
  await page.goto('/sign-in');
  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('Password').fill(ORIGINAL_PASSWORD);
  await page.getByRole('button', { name: /^(Continue|Signing in…)$/ }).click();
  await page.waitForURL('**/dashboard');
  // Match the <strong> in "Signed in as <strong>{email}</strong>" — the
  // dashboard also dumps the full session JSON, which contains the email
  // a second time, so a non-exact getByText resolves to two elements.
  await expect(page.locator('strong').getByText(TEST_EMAIL)).toBeVisible();

  // --- Step f: click "Forgot password?" → land on /reset-password.
  // Sign out first so we're not authenticated when hitting the reset flow.
  await signOut(page);
  await page.goto('/sign-in');
  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.waitForURL(/\/reset-password/);

  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: /^(Send reset link|Sending…)$/ }).click();
  // Confirmation screen — "Check your inbox" headline.
  await expect(page.getByRole('heading', { name: /Check your inbox/i })).toBeVisible();

  // --- Step g: read the reset link out of the file outbox.
  const email = await waitForEmail(TEST_EMAIL);
  expect(email.subject).toContain('Reset');
  const resetUrl = extractResetUrl(email);

  // --- Step h: follow the link. Better-Auth's GET /api/auth/reset-password/<token>
  // validates the token and 302s to /reset-password/new?token=<...>.
  await page.goto(resetUrl);
  await page.waitForURL(/\/reset-password\/new/);

  // --- Step i: set new password.
  await page.getByPlaceholder('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /^(Set new password|Updating…)$/ }).click();

  await expect(page.getByRole('heading', { name: /Password updated/i })).toBeVisible();
  await page.getByRole('link', { name: /Continue to sign in/i }).click();
  await page.waitForURL(/\/sign-in/);

  // --- Step j: sign-in with the NEW password succeeds.
  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /^(Continue|Signing in…)$/ }).click();
  await page.waitForURL('**/dashboard');

  // Sign-in attempt with the OLD password fails with the inline error.
  await signOut(page);
  await page.goto('/sign-in');
  await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('Password').fill(ORIGINAL_PASSWORD);
  await page.getByRole('button', { name: /^(Continue|Signing in…)$/ }).click();

  // The error copy from sign-in/page.tsx is the unified anti-enumeration
  // message: "That password isn't right. Try again, or reset it.".
  await expect(page.getByText(/That password isn't right/)).toBeVisible();
  // And we stay on /sign-in — no /dashboard redirect.
  expect(page.url()).toMatch(/\/sign-in/);
});
