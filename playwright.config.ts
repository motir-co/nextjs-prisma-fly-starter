import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Playwright doesn't pick up .env automatically the way Next.js does. The
// spec files import @/lib/db (via _helpers/db-reset) for DB assertions,
// which throws at module load if DATABASE_URL is missing. Load .env from
// the repo root before defineConfig() runs.
loadEnv();

// PRODECT_FINDINGS #8: the suite used to hardcode http://localhost:3000 for
// baseURL, webServer.url, and (implicitly) Better-Auth's trustedOrigins,
// blocking parallel-worktree runs while a sibling owned :3000. baseURL,
// webServer.url, the dev-server port, and BETTER_AUTH_URL (which lib/auth
// threads into both baseURL and trustedOrigins) now all derive from one
// source. Usage:  E2E_BASE_URL=http://localhost:3100 pnpm test:e2e  (or
// PORT=3100). Default stays :3000 so existing invocations are unchanged.
const USING_CUSTOM_ORIGIN = Boolean(process.env['E2E_BASE_URL']) || Boolean(process.env['PORT']);
const BASE_URL = process.env['E2E_BASE_URL'] ?? `http://localhost:${process.env['PORT'] ?? '3000'}`;
const PORT = new URL(BASE_URL).port || '3000';

/**
 * Playwright config for the starter's E2E auth smoke suite.
 *
 * Specs live in tests/e2e/. The webServer block spawns `pnpm dev` on
 * :3000 and waits for it to come up; in CI it's a fresh server per job,
 * locally it reuses an already-running dev server if one is up.
 *
 * Email delivery during E2E uses the dev-only 'file' provider from
 * lib/email.ts (see EMAIL_PROVIDER + EMAIL_OUTBOX_PATH below). The
 * specs read /tmp/starter-test-emails.jsonl to capture reset links.
 *
 * Tagged-suite convention: tests carry an `@smoke` tag in their
 * describe/test titles. Playwright doesn't have first-class tag filtering,
 * but CI can use `--grep @smoke` if non-smoke specs are added later.
 *
 * Workers are pinned to 1 because both specs touch the same auth tables
 * and `truncateAuthTables()` is global — parallel workers would race.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  // Acceptance specs belong to their OWN lane (playwright.acceptance.config.ts),
  // which records `video: 'on'` and publishes the clip as the story's acceptance
  // receipt. Without this ignore they would ALSO run here — unrecorded, and
  // paced-for-a-human, so slow for no benefit (MOTIR-1941).
  testIgnore: /acceptance.*\.spec\.ts/,
  // Each spec has its own truncate + sign-up flow; 30s is plenty for the
  // longest path (request reset → poll file outbox → follow link → set
  // new password).
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // CI: fail fast on .only and surface flakes via retry counts. Local:
  // no retries, so flakes don't get silently masked during development.
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'out/playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'out/playwright-report' }]],
  outputDir: 'out/playwright-output',
  use: {
    baseURL: BASE_URL,
    // Trace on failure keeps zips small (one per failing test) while
    // giving full debugging context.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // The webServer command is the same locally and in CI. Setting
    // EMAIL_PROVIDER=file + EMAIL_OUTBOX_PATH here ensures both
    // environments write reset emails to a file the specs can read.
    // NODE_ENV is left unset (Next dev sets it to 'development') so the
    // 'file' provider's production-guard doesn't fire.
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    // Reuse a running dev server locally for fast iteration — but NEVER when a
    // custom origin was requested (a worktree run), since the only server that
    // could be reused on that port is a sibling's, running different code.
    reuseExistingServer: !process.env['CI'] && !USING_CUSTOM_ORIGIN,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      EMAIL_PROVIDER: 'file',
      EMAIL_OUTBOX_PATH: path.resolve('/tmp/starter-test-emails.jsonl'),
      // E2E_TEST_OAUTH=1 makes instrumentation.ts install an undici
      // MockAgent that intercepts POSTs to oauth2.googleapis.com/token,
      // returning a synthetic id_token. See instrumentation.ts +
      // tests/e2e/auth-google.spec.ts for the wiring. Production builds
      // (and any local dev where this var isn't set) leave the dispatcher
      // untouched.
      E2E_TEST_OAUTH: '1',
      E2E_TEST_OAUTH_USER_PATH: path.resolve('/tmp/starter-test-oauth-user.json'),
      // PRODECT_FINDINGS #8: hand the dev server the same origin Playwright
      // drives, so /api/auth/* POSTs pass Better-Auth's CSRF origin guard on a
      // non-default port (lib/auth reads BETTER_AUTH_URL into trustedOrigins).
      BETTER_AUTH_URL: BASE_URL,
      // PRODECT_FINDINGS #9: disable Better-Auth's shared sign-in/sign-up
      // rate-limit bucket for the E2E dev server only (prod never sets this).
      E2E_DISABLE_RATE_LIMIT: '1',
    },
  },
});
