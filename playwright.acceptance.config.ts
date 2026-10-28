import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// The ACCEPTANCE lane (MOTIR-1941; ported from motir-core's MOTIR-1632 /
// MOTIR-1700 lane, already carrying MOTIR-1937's scoping).
//
// The main suite (playwright.config.ts) records `video: 'retain-on-failure'` —
// a clip only when a test FAILS. Story acceptance needs the opposite: a clip of
// the GREEN run, published as the story's acceptance receipt for a human to
// watch and approve. So acceptance specs run in their OWN lane with
// `video: 'on'` + `trace: 'on'`, and the main lane is left untouched.
//
// `testMatch` is `acceptance*.spec.ts`; the main config `testIgnore`s the same
// pattern, so an acceptance spec never runs twice (once unrecorded).
//
// ⚠️ WHO PUBLISHES — CHANGED 2026-09-01 (MOTIR-4097, following motir-core's
// MOTIR-4096). This lane's `outputDir` used to be read by a vendored CI uploader
// (`scripts/upload-acceptance-video.mjs`), which POSTed the video + trace +
// chapters to Motir. That uploader is RETIRED: the receipt is published by the
// AGENT, over the Motir MCP surface, and the lane's job now ends at the
// Playwright report artifact the clips and sidecars land in.
// What is unchanged is the PRODUCTION side, and it is what this config still
// owes: each spec declares its target story via the `acceptanceStory()` helper →
// `acceptance-story.json` sidecar, and `chapter()` writes `chapters.json` beside
// it, so whoever publishes can resolve a recording to its story. A failing run
// leaves no video — a red acceptance E2E still produces no receipt.

loadEnv();

// A SEPARATE default port from the main lane (3000) so both can run
// concurrently and a stray sibling server is never reused here.
const USING_CUSTOM_ORIGIN = Boolean(process.env['E2E_BASE_URL']) || Boolean(process.env['PORT']);
const BASE_URL = process.env['E2E_BASE_URL'] ?? `http://localhost:${process.env['PORT'] ?? '3200'}`;
const PORT = new URL(BASE_URL).port || '3200';

export default defineConfig({
  testDir: 'tests/e2e',
  // Only the acceptance specs. Everything else is the main lane's.
  testMatch: /acceptance.*\.spec\.ts/,
  // Generous next to the main lane's 30s: an acceptance spec is deliberately
  // PACED for a human watching the recording (see the `beat()` / `chapter()`
  // helpers), so it takes longer by design.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  // NO retries, even in CI. A retry would record a SECOND clip for the same
  // spec, and whoever publishes would then have to choose between them — a
  // receipt of an attempt nobody chose. A flaky acceptance spec is a bug to fix.
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'out/playwright-report-acceptance' }],
  ],
  outputDir: 'out/playwright-output-acceptance',
  use: {
    baseURL: BASE_URL,
    // The whole point of the lane: record every run, pass or fail.
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'] && !USING_CUSTOM_ORIGIN,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      EMAIL_PROVIDER: 'file',
      EMAIL_OUTBOX_PATH: path.resolve('/tmp/starter-acceptance-emails.jsonl'),
      E2E_TEST_OAUTH: '1',
      E2E_TEST_OAUTH_USER_PATH: path.resolve('/tmp/starter-acceptance-oauth-user.json'),
      BETTER_AUTH_URL: BASE_URL,
      E2E_DISABLE_RATE_LIMIT: '1',
    },
  },
});
