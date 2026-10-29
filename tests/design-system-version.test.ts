import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// MOTIR-10048 — the design ids Motir writes into motir.design.json are the ids
// motir-core accepts, and motir-core validates them against the LATEST published
// @motir/design-system. An installed package older than that may not know a
// chosen id, and resolveAxesToApplied then falls back to the default design
// without a word (0.1.0 had no `amethyst` palette; the user's palette was lost).
// So the installed package must BE the latest release: when motir-core publishes
// a new one, this fails until the starter is bumped.
//
// The registry is asked through `npm view`, which honours the machine's npm
// proxy settings. Offline on a laptop the check is skipped; on CI an
// unreachable registry fails it, so the guard can never go quiet there.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installed = (
  JSON.parse(
    readFileSync(resolve(repoRoot, 'node_modules/@motir/design-system/package.json'), 'utf8'),
  ) as { version: string }
).version;

function latestPublished(): string | null {
  try {
    return execFileSync('npm', ['view', '@motir/design-system', 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
}

const latest = latestPublished();
const reachable = latest !== null || Boolean(process.env.CI);

describe.skipIf(!reachable)(
  `@motir/design-system is the latest release${reachable ? '' : ' (SKIPPED: npm registry unreachable)'}`,
  () => {
    it('the installed package is the version motir-core validates design choices against', () => {
      expect(latest, 'npm view @motir/design-system version failed').not.toBeNull();
      expect(installed).toBe(latest);
    });
  },
);
