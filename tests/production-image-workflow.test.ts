// The production-image workflow (MOTIR-10029) holds a push credential for a
// repository's production app, and nothing typechecks, lints or executes a
// workflow file in the unit suite, so the properties that keep it contained are
// asserted here over the PARSED workflow — what GitHub reads, not what its
// comments say (MOTIR-10039).
//
// Each property is a guard that returns its violations, so the last block can
// break a copy of the workflow in memory and show that exactly the guard written
// for that regression fails — none of them passes vacuously.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github/workflows');
const WORKFLOW_PATH = path.join(WORKFLOWS_DIR, 'production-image.yml');
const CI_PATH = path.join(WORKFLOWS_DIR, 'ci.yml');
const DOCKERFILE_PATH = path.join(process.cwd(), 'Dockerfile');

/**
 * The names Motir writes when it switches production on — copied from
 * motir-core's `lib/hosting/productionEnablementNames.ts` (the hosting ADR,
 * MOTIR-5769 §4 and §11). The starter cannot import across repositories, so a
 * rename on either side must be made here too, or this suite fails.
 */
export const PRODUCTION_NAMES = {
  environment: 'production',
  secret: 'MOTIR_FLY_PRODUCTION_PUSH_TOKEN',
  imageVariable: 'MOTIR_HOSTING_IMAGE_PRODUCTION',
  targetVariable: 'MOTIR_HOSTING_TARGET',
  buildGate: 'MOTIR_HOSTING_BUILD',
} as const;
/** The one other variable a workflow here may read: the runner selector. */
const RUNNER_VARIABLE = 'MOTIR_RUNNER';
/** The preview names this workflow must never touch (MOTIR-5769 §11). */
const PREVIEW_NAMES = ['MOTIR_FLY_PREVIEW_PUSH_TOKEN', 'MOTIR_HOSTING_IMAGE_PREVIEW'];

const GATE = "vars.MOTIR_HOSTING_BUILD == 'on' && vars.MOTIR_HOSTING_TARGET != ''";
const RUNNER = "${{ vars.MOTIR_RUNNER || 'ubuntu-latest' }}";
const IMAGE_REF = '${{ vars.MOTIR_HOSTING_IMAGE_PRODUCTION }}:${{ github.sha }}';
const TOKEN_ENV = 'FLY_API_TOKEN';

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
  environment?: string | { name: string };
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

function loadWorkflow(file = WORKFLOW_PATH): Workflow {
  return parse(fs.readFileSync(file, 'utf8')) as Workflow;
}

/** Every string value in a parsed node, with the key path that holds it. */
function strings(node: unknown, at: string[] = []): Array<{ at: string[]; value: string }> {
  if (typeof node === 'string') return [{ at, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, [...at, String(i)]));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...at, k]));
  }
  return [];
}

/** Every `secrets.*` reference and the key path it sits under. */
function collectSecretRefs(wf: Workflow): Array<{ at: string[]; name: string }> {
  return strings(wf).flatMap(({ at, value }) =>
    [...value.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map((m) => ({ at, name: m[1]! })),
  );
}

function namesOf(wf: Workflow, context: 'vars' | 'secrets'): Set<string> {
  const re = new RegExp(`\\b${context}\\.([A-Za-z0-9_]+)`, 'g');
  return new Set(strings(wf).flatMap(({ value }) => [...value.matchAll(re)].map((m) => m[1]!)));
}

/** A `${{ … }}` wrapper is accepted around an `if:`. */
function unwrap(expr: string | undefined): string | undefined {
  return expr
    ?.trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1')
    .replace(/\s+/g, ' ');
}

function steps(wf: Workflow): Step[] {
  return Object.values(wf.jobs).flatMap((job) => job.steps ?? []);
}

function buildStep(wf: Workflow): Step | undefined {
  return steps(wf).find((s) => s.uses?.startsWith('docker/build-push-action@'));
}

// ── The guards ──────────────────────────────────────────────────────────────

function triggerViolations(wf: Workflow): string[] {
  const out: string[] = [];
  const events = Object.keys(wf.on ?? {});
  if (events.length !== 1 || events[0] !== 'push') out.push(`triggers: ${events.join(', ')}`);
  const push = (wf.on?.push ?? {}) as { branches?: unknown; tags?: unknown };
  if (JSON.stringify(push.branches) !== JSON.stringify(['main'])) {
    out.push(`push branches: ${JSON.stringify(push.branches)}`);
  }
  if (push.tags !== undefined) out.push('push has a tags filter');
  return out;
}

function gateViolations(wf: Workflow): string[] {
  return Object.entries(wf.jobs)
    .filter(([, job]) => unwrap(job.if) !== GATE)
    .map(([id, job]) => `job ${id} if: ${job.if ?? '(none)'}`);
}

function runnerViolations(wf: Workflow, ci: Workflow): string[] {
  const ciRunners = new Set(Object.values(ci.jobs).map((j) => j['runs-on']));
  return Object.entries(wf.jobs)
    .filter(([, job]) => job['runs-on'] !== RUNNER || !ciRunners.has(job['runs-on']))
    .map(([id, job]) => `job ${id} runs-on: ${job['runs-on']}`);
}

function environmentViolations(wf: Workflow): string[] {
  return Object.entries(wf.jobs)
    .filter(([, job]) => {
      const env = typeof job.environment === 'string' ? job.environment : job.environment?.name;
      return env !== PRODUCTION_NAMES.environment;
    })
    .map(([id]) => `job ${id} is not bound to the production environment`);
}

function secretViolations(wf: Workflow): string[] {
  const out: string[] = [];
  for (const { at, name } of collectSecretRefs(wf)) {
    if (name !== PRODUCTION_NAMES.secret) out.push(`secret ${name} referenced`);
    const key = at[at.length - 1];
    if (at[at.length - 2] !== 'env' || key !== TOKEN_ENV) {
      out.push(`secrets.${name} sits under ${at.join('.')}`);
    }
  }
  return out;
}

function tokenUseViolations(wf: Workflow): string[] {
  const out: string[] = [];
  for (const step of steps(wf)) {
    const label = step.name ?? step.uses ?? '(unnamed)';
    for (const { value } of strings(step.with ?? {})) {
      if (/FLY_API_TOKEN/.test(value)) out.push(`with: of ${label} carries the token`);
    }
    // A `secrets.*` expression anywhere but an env: value is the secret guard's.
    const run = step.run ?? '';
    if (!run) continue;
    if (/\bset\s+-[a-z]*x/.test(run)) out.push(`run of ${label} traces commands`);
    for (const line of run.split('\n')) {
      if (!/\$\{?FLY_API_TOKEN\b/.test(line)) continue;
      if (/\b(echo|printf|cat)\b/.test(line)) out.push(`run of ${label} prints the token`);
      if (/GITHUB_OUTPUT|GITHUB_STEP_SUMMARY|GITHUB_ENV/.test(line)) {
        out.push(`run of ${label} writes the token to a GitHub file`);
      }
      const login = /docker login\b.*--password-stdin\s*<<<\s*"\$FLY_API_TOKEN"\s*$/.test(line);
      const check = /\[\s*-z\s+"\$\{FLY_API_TOKEN:-\}"\s*\]/.test(line);
      if (!login && !check) out.push(`run of ${label} passes the token as an argument: ${line}`);
    }
    if (/--password(?!-stdin)\b|\s-p\s/.test(run)) {
      out.push(`run of ${label} passes a command-line password`);
    }
  }
  return out;
}

function imageViolations(wf: Workflow): string[] {
  const build = buildStep(wf);
  if (!build) return ['no build-push step'];
  const out: string[] = [];
  const tags = String(build.with?.tags ?? '').trim();
  if (tags !== IMAGE_REF) out.push(`tags: ${tags}`);
  if (/:latest\b/.test(tags)) out.push('pushes a latest tag');
  if (build.with?.push !== true) out.push('the build step does not push');
  const text = JSON.stringify(wf);
  for (const name of PREVIEW_NAMES) if (text.includes(name)) out.push(`references ${name}`);
  return out;
}

function buildViolations(wf: Workflow): string[] {
  const build = buildStep(wf);
  if (!build) return ['no build-push step'];
  const out: string[] = [];
  const w = build.with ?? {};
  if (w.context !== '.') out.push(`context: ${String(w.context)}`);
  if (w.file !== undefined && w.file !== 'Dockerfile') out.push(`file: ${String(w.file)}`);
  if (w.target !== undefined) out.push(`target: ${String(w.target)}`);
  for (const key of ['build-args', 'secrets', 'secret-files', 'secret-envs']) {
    if (w[key] !== undefined) out.push(`${key} passed to the build`);
  }
  return out;
}

function permissionViolations(wf: Workflow): string[] {
  const out: string[] = [];
  const readOnly = JSON.stringify({ contents: 'read' });
  if (JSON.stringify(wf.permissions) !== readOnly) {
    out.push(`workflow permissions: ${JSON.stringify(wf.permissions)}`);
  }
  for (const [id, job] of Object.entries(wf.jobs)) {
    if (job.permissions && JSON.stringify(job.permissions) !== readOnly) {
      out.push(`job ${id} permissions: ${JSON.stringify(job.permissions)}`);
    }
  }
  const group = wf.concurrency?.group ?? '';
  if (!/github\.workflow/.test(group) || !/github\.ref/.test(group)) {
    out.push(`concurrency group: ${group || '(none)'}`);
  }
  if (wf.concurrency?.['cancel-in-progress'] === true) out.push('cancel-in-progress is on');
  return out;
}

function reportViolations(wf: Workflow): string[] {
  const out: string[] = [];
  for (const [id, job] of Object.entries(wf.jobs)) {
    const outputs = Object.values(job.outputs ?? {}).join(' ');
    if (!/steps\.\w+\.outputs\.image/.test(outputs)) out.push(`job ${id} has no image output`);
    if (!/steps\.build\.outputs\.digest/.test(outputs)) out.push(`job ${id} has no digest output`);
    const summary = job.steps.find((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? ''));
    const summaryEnv = Object.values(summary?.env ?? {}).join(' ');
    if (!summary || !summaryEnv.includes(IMAGE_REF) || !/outputs\.digest/.test(summaryEnv)) {
      out.push(`job ${id} does not summarise the image and its digest`);
    }
  }
  return out;
}

function deployViolations(wf: Workflow): string[] {
  return steps(wf)
    .filter(
      (s) =>
        /\b(fly|flyctl)\s+(deploy|releases?|machine)\b/.test(s.run ?? '') ||
        /superfly\/fly-actions|flyctl-actions/.test(s.uses ?? ''),
    )
    .map((s) => `step ${s.name ?? s.uses} deploys`);
}

function nameViolations(wf: Workflow): string[] {
  const allowed = new Set<string>([
    PRODUCTION_NAMES.imageVariable,
    PRODUCTION_NAMES.targetVariable,
    PRODUCTION_NAMES.buildGate,
    RUNNER_VARIABLE,
  ]);
  const vars = namesOf(wf, 'vars');
  const secrets = namesOf(wf, 'secrets');
  const out = [...vars].filter((n) => !allowed.has(n)).map((n) => `unknown variable ${n}`);
  out.push(...[...secrets].filter((n) => n !== PRODUCTION_NAMES.secret).map((n) => `secret ${n}`));
  for (const needed of [
    PRODUCTION_NAMES.imageVariable,
    PRODUCTION_NAMES.targetVariable,
    PRODUCTION_NAMES.buildGate,
  ]) {
    if (!vars.has(needed)) out.push(`variable ${needed} unused`);
  }
  if (!secrets.has(PRODUCTION_NAMES.secret)) out.push(`secret ${PRODUCTION_NAMES.secret} unused`);
  return out;
}

const GUARDS = {
  trigger: triggerViolations,
  gate: gateViolations,
  secret: secretViolations,
  tokenUse: tokenUseViolations,
  image: imageViolations,
} as const;

// ── The merged workflow ─────────────────────────────────────────────────────

const workflow = loadWorkflow();
const ci = loadWorkflow(CI_PATH);

describe('production-image.yml', () => {
  it('triggers only on a push to main', () => {
    expect(triggerViolations(workflow)).toEqual([]);
  });

  it('runs every job only when Motir has switched production on', () => {
    expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
    expect(gateViolations(workflow)).toEqual([]);
    expect(environmentViolations(workflow)).toEqual([]);
  });

  it('runs on the same runner expression as ci.yml', () => {
    expect(runnerViolations(workflow, ci)).toEqual([]);
  });

  it('references only the production push token, and only as an env: value', () => {
    expect(collectSecretRefs(workflow).map((r) => r.name)).toEqual([PRODUCTION_NAMES.secret]);
    expect(secretViolations(workflow)).toEqual([]);
  });

  it('never prints the token or passes it on a command line', () => {
    expect(tokenUseViolations(workflow)).toEqual([]);
  });

  it('pushes the production image under the full commit sha', () => {
    expect(imageViolations(workflow)).toEqual([]);
  });

  it("builds the repository's root Dockerfile, whose runtime copies the standalone output", () => {
    expect(buildViolations(workflow)).toEqual([]);
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const stages = dockerfile.split(/^FROM\s/m);
    const runtime = stages[stages.length - 1]!;
    expect(runtime).toMatch(/COPY --from=build\b.*\/app\/\.next\/standalone\s/);
  });

  it('grants only contents: read and never cancels a production build', () => {
    expect(permissionViolations(workflow)).toEqual([]);
  });

  it('reports the pushed reference and digest', () => {
    expect(reportViolations(workflow)).toEqual([]);
  });

  it('never deploys, and names no preview credential or image', () => {
    expect(deployViolations(workflow)).toEqual([]);
    const text = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    for (const name of PREVIEW_NAMES) expect(text).not.toContain(name);
  });

  it("uses exactly the names Motir's production enablement writes", () => {
    expect(nameViolations(workflow)).toEqual([]);
  });
});

// ── The guards catch the regression they are written for ──────────────────

describe('each guard fails on a broken copy', () => {
  const clone = (): Workflow => structuredClone(workflow);
  const job = (wf: Workflow): Job => Object.values(wf.jobs)[0]!;

  const mutations: Array<[string, keyof typeof GUARDS, (wf: Workflow) => void]> = [
    [
      'a pull_request trigger',
      'trigger',
      (wf) => {
        wf.on.pull_request = null;
      },
    ],
    [
      'the gate removed',
      'gate',
      (wf) => {
        delete job(wf).if;
      },
    ],
    [
      'the token in a run: line',
      'secret',
      (wf) => {
        job(wf).steps.push({
          name: 'Leak',
          run: 'docker login registry.fly.io -u x --password-stdin <<< "${{ secrets.MOTIR_FLY_PRODUCTION_PUSH_TOKEN }}"',
        });
      },
    ],
    [
      'the token echoed',
      'tokenUse',
      (wf) => {
        job(wf).steps.push({ name: 'Leak', run: 'echo "$FLY_API_TOKEN"' });
      },
    ],
    [
      'a latest tag',
      'image',
      (wf) => {
        buildStep(wf)!.with!.tags = '${{ vars.MOTIR_HOSTING_IMAGE_PRODUCTION }}:latest';
      },
    ],
  ];

  for (const [what, guard, mutate] of mutations) {
    it(`${what} trips the ${guard} guard, and only it`, () => {
      const broken = clone();
      mutate(broken);
      const failing = Object.entries(GUARDS)
        .filter(([, check]) => check(broken).length > 0)
        .map(([name]) => name);
      expect(failing).toEqual([guard]);
    });
  }

  it('the other guards each catch their own regression', () => {
    const noEnv = clone();
    delete job(noEnv).environment;
    expect(environmentViolations(noEnv)).not.toEqual([]);

    const hosted = clone();
    job(hosted)['runs-on'] = 'ubuntu-latest';
    expect(runnerViolations(hosted, ci)).not.toEqual([]);

    const withTarget = clone();
    buildStep(withTarget)!.with!.target = 'build';
    expect(buildViolations(withTarget)).not.toEqual([]);

    const writes = clone();
    writes.permissions = { contents: 'write' };
    expect(permissionViolations(writes)).not.toEqual([]);

    const cancels = clone();
    cancels.concurrency!['cancel-in-progress'] = true;
    expect(permissionViolations(cancels)).not.toEqual([]);

    const silent = clone();
    delete job(silent).outputs;
    expect(reportViolations(silent)).not.toEqual([]);

    const deploys = clone();
    job(deploys).steps.push({ name: 'Deploy', run: 'flyctl deploy --image x' });
    expect(deployViolations(deploys)).not.toEqual([]);

    const renamed = clone();
    job(renamed).env!.IMAGE_REPOSITORY = '${{ vars.MOTIR_HOSTING_IMAGE_PREVIEW }}';
    expect(nameViolations(renamed)).not.toEqual([]);
    expect(imageViolations(renamed)).not.toEqual([]);
  });
});
