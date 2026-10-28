// ⚠️ THIS FILE HOLDS THE STARTER-LOCAL LANE ASSERTIONS that used to sit at the foot
// of the vendored `tests/acceptance-video-uploader.test.ts` (MOTIR-4097 moved them
// here, under motir-core's own name for the same file). Since MOTIR-7255 the
// uploader test is vendored again, verbatim, and these stay here — so the vendored
// file stays a pure copy and this one is the repo's own.
//
// A workflow file is not typechecked, linted or executed by any suite, so the
// properties that make this lane HONEST are asserted here or nowhere.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github/workflows');
const ACCEPTANCE_WORKFLOW = path.join(WORKFLOWS_DIR, 'acceptance-tests.yml');
const ACCEPTANCE_CONFIG = path.join(process.cwd(), 'playwright.acceptance.config.ts');

const workflow = fs.readFileSync(ACCEPTANCE_WORKFLOW, 'utf8');

/** The workflow with its comment lines dropped — what the file DOES, not what it says. */
function codeOf(yaml: string): string {
  return yaml
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const code = codeOf(workflow);

/**
 * The YAML block for one top-level job, comments already stripped.
 *
 * Windowed to the NEXT job key rather than sliced to end-of-file: a
 * slice-to-EOF window equals "this job" only while it is the last one in the
 * file, and silently swallows whatever gets appended after it.
 */
function job(name: string): string {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start, `no job \`${name}\` in the workflow`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}\S.*:\s*$/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Every `.yml` / `.yaml` under `.github/`, as [path, text]. */
function ciYaml(): Array<readonly [string, string]> {
  const walk = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory()
              ? walk(path.join(dir, e.name))
              : /\.ya?ml$/.test(e.name)
                ? [path.join(dir, e.name)]
                : [],
          )
      : [];
  return walk(path.join(process.cwd(), '.github')).map(
    (f) => [path.relative(process.cwd(), f), fs.readFileSync(f, 'utf8')] as const,
  );
}

describe('the acceptance lane is spec-scoped (MOTIR-1958)', () => {
  it('lives at the path the rename gave it, under the name it now claims', () => {
    // The check a scaffolded project's contributors actually SEE is the JOB's
    // display name, so it is asserted separately from the workflow's own `name:`.
    // Both used to read `Acceptance video` for a lane that publishes nothing
    // (MOTIR-4097, following motir-core's MOTIR-4096).
    expect(fs.existsSync(ACCEPTANCE_WORKFLOW)).toBe(true);
    expect(fs.existsSync(path.join(WORKFLOWS_DIR, 'acceptance-video.yml'))).toBe(false);
    expect(code).toMatch(/^name: Acceptance tests$/m);
    expect(job('acceptance')).toContain('name: Playwright E2E (acceptance)');
  });

  it('carries NO `continue-on-error` — a step that cannot go red is worse than none (MOTIR-2690)', () => {
    // The original card was about the publish step, which MOTIR-4097 retired:
    // `continue-on-error` rewrote its conclusion to `success` — in the checks UI,
    // in `gh pr checks`, AND in the REST API — so its exit code stopped being a
    // signal at all. Measured upstream (MOTIR-2499): from 2026-08-07 the publish
    // failed on every run while the lane reported `pass`, and two stories lost
    // their receipt silently.
    //
    // The step is gone and the assertion is KEPT, widened to the file: what it
    // was really protecting is that this lane can go red, and that is a property
    // of every step in it. A green lane whose tests did not run is the same
    // defect one step over.
    expect(code).not.toContain('continue-on-error');
  });

  it('runs on a push to the default branch, as well as on a spec-owning PR', () => {
    // Without this the lane only ever sees the PRs that edit a spec, which is
    // exactly the population that cannot break one by changing the app.
    expect(code).toMatch(/\n {2}push:\n {4}branches: \[main\]/);
    // ...and the PR trigger stays narrow. Widening it to the sources the specs
    // read is the alternative that was rejected: that set is most of the app,
    // so it would run this lane on nearly every pull request.
    expect(code).toMatch(/pull_request:\n\s*paths:\n\s*- 'tests\/e2e\/acceptance\*\.spec\.ts'/);
  });

  it('gates the fan-out on the lane actually holding a spec', () => {
    // An ungated `push:` trigger pays this lane's whole setup — pnpm, Prisma,
    // Postgres, Chromium, a dev server — on EVERY merge, to run zero tests
    // while the lane is empty, which is a template repo's permanent state.
    const gate = job('membership');
    expect(gate).toContain('run: ${{ steps.gate.outputs.run }}');
    expect(job('acceptance')).toContain('needs: membership');
  });

  it('leaves NO check on a pull request that owns no spec — the gate is push-only', () => {
    // The reason this lane is its own workflow rather than a job in ci.yml, and
    // the defect this repository is where it was FOUND (MOTIR-1958). A job whose
    // `if:` is false is still REPORTED, as a greyed `Skipped`, so the gate must
    // never be able to answer `false` for a `pull_request` event.
    // Two halves, and BOTH are load-bearing:
    //
    // 1. The gate short-circuits to `true` on `pull_request` before it looks at
    //    the count at all. A `push` event attaches its checks to the commit on
    //    the default branch and adds nothing to any open PR, so skipping there
    //    costs no pull request anything.
    expect(job('membership')).toMatch(
      /if \[ "\$\{EVENT_NAME\}" = 'pull_request' \]; then\n\s*RUN=true/,
    );
    // 2. The one PR-visible job's condition names the gate's output and NOTHING
    //    else. This is the assertion that stops a future edit from gating the
    //    lane on something a pull request can see (a label, an actor, a path)
    //    and quietly reintroducing the greyed check.
    const ifs = job('acceptance')
      .split('\n')
      .filter((l) => /^\s{4}if:/.test(l));
    expect(ifs).toEqual(["    if: needs.membership.outputs.run == 'true'"]);
  });

  it('does not let one merge cancel the previous merge`s baseline', () => {
    // Cancelling a superseded run is right for a PR (only the tip matters) and
    // wrong here: back-to-back merges would cancel each other and leave exactly
    // the "which merge broke it?" ambiguity the baseline exists to remove.
    expect(code).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });
});

// ── MOTIR-7255 (reversing MOTIR-4097's publisher retirement) ──────────────────
//
// From 2026-09-02 (MOTIR-4097) this lane RECORDED and the agent published the
// receipt over the Motir MCP surface. On 2026-10-01 CI became the publisher
// again in the repositories Motir writes — motir-core (MOTIR-7253) and every
// project generated from this template — so the vendored uploader and its
// action are back, wired PR-only over keyless OIDC. These guards pin that shape
// and keep the two properties the retirement was protecting: NO Motir token in
// any job (a template that asks for a secret asks every generated project for
// one), and publishing ONLY from a green pull-request run (publishing supersedes
// a story's receipt, MOTIR-1937).
//
// A workflow file is not type-checked or linted, so a copy-paste that passes a
// token or drops a gate would ship silently into every scaffolded project.
describe('the lane publishes on a green PR run, over OIDC only (MOTIR-7255)', () => {
  /** The `acceptance` job's steps, each as its own text. */
  const steps = (): string[] =>
    job('acceptance')
      .split(/^ {6}- /m)
      .slice(1);
  const publishStep = (): string | undefined =>
    steps().find((s) => /name:\s*Publish the acceptance receipt/.test(s));

  it('finds the CI files it is meant to police', () => {
    const files = ciYaml().map(([f]) => f);
    expect(files).toContain('.github/workflows/acceptance-tests.yml');
    expect(files).toContain('.github/actions/upload-acceptance-video/action.yml');
  });

  it('the publish step uses the LOCAL vendored action, gated on success() AND pull_request', () => {
    const step = publishStep();
    expect(step, 'no `Publish the acceptance receipt` step in the acceptance job').toBeDefined();
    expect(step).toMatch(/uses:\s*\.\/\.github\/actions\/upload-acceptance-video\s*$/m);
    expect(step).toMatch(/^\s*if:\s*success\(\) && github\.event_name == 'pull_request'\s*$/m);
    // It is the only publisher, and it reads the owned-spec list.
    expect(steps().filter((s) => /upload-acceptance-video/.test(s))).toHaveLength(1);
    expect(step).toMatch(/changed-specs:\s*\$\{\{\s*steps\.owned-specs\.outputs\.specs\s*\}\}/);
  });

  it('owns only the specs the PR changed, and nothing on a push', () => {
    const acceptance = job('acceptance');
    expect(acceptance).toContain('id: owned-specs');
    expect(acceptance).toContain(
      `git diff --name-only "\${BASE_SHA}" HEAD -- 'tests/e2e/acceptance*.spec.ts'`,
    );
    expect(acceptance).toMatch(
      /if \[ -z "\$\{BASE_SHA\}" \]; then[\s\S]*?echo "specs=" >> "\$GITHUB_OUTPUT"[\s\S]*?exit 0/,
    );
  });

  it('grants `id-token: write` on the acceptance job, and on no other job', () => {
    expect(job('acceptance')).toMatch(/^\s*id-token:\s*write\s*$/m);
    expect(job('membership')).not.toMatch(/id-token/);
    // Never at workflow level, where every job would inherit it.
    expect(code.split(/^jobs:\s*$/m)[0]).not.toMatch(/id-token/);
  });

  it('passes no token to the action, and no job is handed a Motir credential', () => {
    // OIDC only: a Motir-hosted repository is App-connected at creation. The
    // action's `token` input is for a repository with no App connection.
    expect(publishStep()).not.toMatch(/^\s*token:/m);
    const offenders = ciYaml()
      .filter(([f]) => f.startsWith('.github/workflows/'))
      .filter(([, text]) =>
        /MOTIR_UPLOAD_TOKEN|MOTIR_PUBLISH_TOKEN|secrets\.MOTIR/.test(codeOf(text)),
      )
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('the vendored copies name the motir-core commit they were synced from', () => {
    // So the next sync is a `diff`, not archaeology (MOTIR-2693).
    const sync = /SYNC POINT: motir-core (`main` )?@ [0-9a-f]{7,40}\b/;
    expect(fs.readFileSync('scripts/upload-acceptance-video.mjs', 'utf8')).toMatch(sync);
    expect(fs.readFileSync('.github/actions/upload-acceptance-video/action.yml', 'utf8')).toMatch(
      sync,
    );
    expect(fs.readFileSync('tests/acceptance-video-uploader.test.ts', 'utf8')).toMatch(sync);
  });

  it('still RECORDS, and still keeps the report the recording is read from', () => {
    expect(fs.readFileSync(ACCEPTANCE_CONFIG, 'utf8')).toMatch(/mode:\s*'on'/);
    const acceptance = job('acceptance');
    expect(acceptance).toContain('name: playwright-report-acceptance');
    expect(acceptance).toContain('path: out/playwright-report-acceptance');
    expect(acceptance).toMatch(/if:\s*always\(\)/);
  });
});
