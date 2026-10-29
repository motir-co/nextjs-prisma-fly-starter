// The preview-image workflow (MOTIR-5771) holds a push credential, and nothing
// typechecks, lints or executes a workflow file in the unit suite, so the
// properties that keep that credential contained are asserted here over the
// PARSED workflow — what GitHub reads, not what its comments say.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

const WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/preview-image.yml');

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  'runs-on'?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  on: Record<string, { types?: string[] } | null>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

function loadWorkflow(text = fs.readFileSync(WORKFLOW_PATH, 'utf8')): Workflow {
  return parse(text) as Workflow;
}

/** The workflow's only job. */
function onlyJob(wf: Workflow): Job {
  const jobs = Object.values(wf.jobs);
  expect(jobs, 'preview-image.yml must hold exactly one job').toHaveLength(1);
  return jobs[0]!;
}

/** A `${{ … secrets.… }}` expression — the thing GitHub substitutes, not prose naming a secret. */
const SECRET_EXPRESSION = /\$\{\{[^}]*\bsecrets\./;

/** Every string value in a parsed YAML node, with the key path that holds it. */
function strings(node: unknown, at: string[] = []): Array<{ at: string[]; value: string }> {
  if (typeof node === 'string') return [{ at, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, [...at, String(i)]));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...at, k]));
  }
  return [];
}

/**
 * Every place a `secrets.*` expression is used, as a key path. The only legal
 * shape is a value directly under an `env:` map whose whole value is the one
 * expression.
 */
function secretUses(wf: Workflow): Array<{ at: string[]; value: string }> {
  return strings(wf).filter(({ value }) => SECRET_EXPRESSION.test(value));
}

function isEnvValue(at: string[]): boolean {
  return at.length >= 2 && at[at.length - 2] === 'env';
}

const TOKEN = 'secrets.MOTIR_FLY_PREVIEW_PUSH_TOKEN';

describe('the push token reaches a step only through env:', () => {
  const wf = loadWorkflow();
  const job = onlyJob(wf);

  it('is referenced, and every reference is a whole env: value', () => {
    const uses = secretUses(wf);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(isEnvValue(use.at), `secrets used outside env: at ${use.at.join('.')}`).toBe(true);
      expect(use.value).toBe(`\${{ ${TOKEN} }}`);
    }
  });

  it('no run: line names any secret, and no with: input carries one', () => {
    for (const step of job.steps) {
      expect(step.run ?? '').not.toMatch(SECRET_EXPRESSION);
      for (const { value } of strings(step.with ?? {}))
        expect(value).not.toMatch(SECRET_EXPRESSION);
    }
  });

  it('the login pipes the token to --password-stdin, never passes it as an argument', () => {
    const login = job.steps.find((s) => /docker login/.test(s.run ?? ''));
    expect(login, 'no docker login step').toBeDefined();
    expect(login!.run).toMatch(/--password-stdin/);
    expect(login!.run).not.toMatch(/(--password|-p)\s+\S/);
  });

  it('logs out of the registry even when an earlier step fails', () => {
    const logout = job.steps.find((s) => /docker logout registry\.fly\.io/.test(s.run ?? ''));
    expect(logout?.if).toBe('always()');
  });

  it('a check that would catch the token spliced into a run: line', () => {
    const leaked = loadWorkflow(
      fs
        .readFileSync(WORKFLOW_PATH, 'utf8')
        .replace(`printf '%s' "$FLY_PUSH_TOKEN"`, `printf '%s' "\${{ ${TOKEN} }}"`),
    );
    expect(secretUses(leaked).some((u) => !isEnvValue(u.at))).toBe(true);
  });
});

describe('the push target is the preview image repository, never production', () => {
  const wf = loadWorkflow();
  const job = onlyJob(wf);
  const text = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const code = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('the image repository comes from vars.MOTIR_HOSTING_IMAGE_PREVIEW', () => {
    expect(job.env?.['IMAGE_REPOSITORY']).toBe('${{ vars.MOTIR_HOSTING_IMAGE_PREVIEW }}');
  });

  it('never names the production repository or its token', () => {
    expect(code).not.toMatch(/MOTIR_HOSTING_IMAGE_PRODUCTION/);
    expect(code).not.toMatch(/MOTIR_FLY_PRODUCTION_PUSH_TOKEN/);
  });

  it('pushes exactly the reference the target check resolved, for linux/amd64', () => {
    const push = job.steps.find((s) => s.uses?.startsWith('docker/build-push-action@'));
    expect(push?.with).toMatchObject({
      push: true,
      platforms: 'linux/amd64',
      file: 'Dockerfile',
      tags: '${{ steps.target.outputs.ref }}',
    });
  });

  it('builds the pull request head commit the tag names', () => {
    const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['ref']).toBe('${{ github.event.pull_request.head.sha }}');
    expect(job.env?.['HEAD_SHA']).toBe('${{ github.event.pull_request.head.sha }}');
  });
});

describe('the target check refuses anything but a Fly preview repository', () => {
  const job = onlyJob(loadWorkflow());
  const check = job.steps.find((s) => s.id === 'target');
  const SHA = 'a'.repeat(40);

  /** Run the step's own script under bash, as the runner would. */
  function runCheck(env: Record<string, string>): { status: number | null; ref: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-target-'));
    const output = path.join(dir, 'output');
    fs.writeFileSync(output, '');
    // A clean environment, so nothing from this shell can satisfy the check.
    const stepEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: process.env['PATH'] ?? '',
      GITHUB_OUTPUT: output,
      HEAD_SHA: SHA,
      ...env,
    };
    const result = spawnSync('bash', ['-c', check!.run!], {
      env: stepEnv,
      encoding: 'utf8',
    });
    const ref = /^ref=(.*)$/m.exec(fs.readFileSync(output, 'utf8'))?.[1] ?? '';
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: result.status, ref };
  }

  it('exists', () => {
    expect(check?.run).toEqual(expect.any(String));
  });

  it('resolves <preview repository>:<head sha> for a -pv repository', () => {
    const { status, ref } = runCheck({
      FLY_PUSH_TOKEN: 'token',
      IMAGE_REPOSITORY: 'registry.fly.io/mh-cmabc123-pv',
    });
    expect(status).toBe(0);
    expect(ref).toBe(`registry.fly.io/mh-cmabc123-pv:${SHA}`);
  });

  it.each([
    ['the production repository', 'registry.fly.io/mh-cmabc123'],
    ['another registry', 'ghcr.io/acme/mh-cmabc123-pv'],
    ['an unset variable', ''],
    ['a reference that smuggles a tag', 'registry.fly.io/mh-cmabc123-pv:latest'],
  ])('refuses %s', (_label, repository) => {
    const { status, ref } = runCheck({ FLY_PUSH_TOKEN: 'token', IMAGE_REPOSITORY: repository });
    expect(status).toBe(1);
    expect(ref).toBe('');
  });

  it('refuses a missing token', () => {
    const { status } = runCheck({ IMAGE_REPOSITORY: 'registry.fly.io/mh-cmabc123-pv' });
    expect(status).toBe(1);
  });
});

describe('the workflow is scoped to one pull request, with least privilege', () => {
  const wf = loadWorkflow();
  const job = onlyJob(wf);

  it('runs on pull_request opened, synchronize and reopened only', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on['pull_request']?.types).toEqual(['opened', 'synchronize', 'reopened']);
  });

  it('cancels the previous build of the same pull request', () => {
    expect(wf.concurrency.group).toMatch(/\$\{\{ github\.event\.pull_request\.number \}\}/);
    expect(wf.concurrency['cancel-in-progress']).toBe(true);
  });

  it('can only read the repository', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('picks its runner through MOTIR_RUNNER, like every other workflow', () => {
    expect(job['runs-on']).toBe("${{ vars.MOTIR_RUNNER || 'ubuntu-latest' }}");
  });
});
