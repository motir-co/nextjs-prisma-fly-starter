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
      // A Motir HOSTING push token is not a Motir credential: it is a Fly deploy
      // token scoped to the repository's own app, written into its `production`
      // (or preview) environment by Motir's enablement, and the image workflows
      // need it to push (MOTIR-10029; the preview's, MOTIR-5769 §4). Where the
      // preview token may appear is `preview-image-workflow.test.ts`'s to police.
      // Every other `secrets.MOTIR*` still fails.
      .filter(([, text]) =>
        /MOTIR_UPLOAD_TOKEN|MOTIR_PUBLISH_TOKEN|secrets\.MOTIR(?!_FLY_(?:PRODUCTION|PREVIEW)_PUSH_TOKEN\b)/.test(
          codeOf(text),
        ),
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

// ── THE ACCEPTANCE FRAME (MOTIR-11471) ──────────────────────────────────────
//
// Every receipt records at ONE size. The clip has a fixed frame (`video.size`)
// and Playwright SCALES whatever the page is into it, so a spec that resized its
// page — `page.setViewportSize(…)`, a `test.use({ viewport })`, a context opened
// at its own size — published a receipt shrunk into the frame, letterboxed, or
// changing size halfway through. Motir's own lane had six such specs before this
// guard; it holds the same two things here:
//
//   1. THE CONFIG records at the size its project's viewport is, spelled as ONE
//      expression, resolving to 1920×1080, set AFTER the device spread (so the
//      device's own viewport cannot win), with `deviceScaleFactor: 1`.
//   2. NOTHING THE LANE RUNS resizes the page: every spec the config's own
//      `testMatch` selects, and every local module under `tests/e2e` those specs
//      reach through a relative import, is read for a `setViewportSize(` call, a
//      `test.use({ … })` that sets `viewport` / `video` / `deviceScaleFactor` or
//      spreads a `devices[…]` preset, and a `newContext(` / `newPage(` that does
//      the same or names `recordVideo` — or whose options are not an object
//      literal it can read, which fails rather than passes.
//
// A plain `browser.newContext()` is fine: Playwright gives it the project's
// `use` options (so the frame) and never records it — only the `page` /
// `context` fixture records. A responsive check belongs in a main-lane spec.

const E2E_DIR = 'tests/e2e';
const FRAME = { width: 1920, height: 1080 } as const;

/** Comments blanked to spaces, every newline and string kept — so a line number
 *  read from the result is the source's, and a `//` inside a string survives. */
export function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) if (out[i] !== '\n') out[i] = ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i += 1;
        else if (c !== '`' && source[i] === '\n') break;
        i += 1;
      }
      i += 1;
    } else i += 1;
  }
  return out.join('');
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const EXPRESSION = String.raw`([A-Za-z_$][\w$]*|\{[^{}]*\})`;

function sizeOf(literal: string): { width: number; height: number } | null {
  const width = /\bwidth\s*:\s*(\d+)/.exec(literal);
  const height = /\bheight\s*:\s*(\d+)/.exec(literal);
  return width && height ? { width: Number(width[1]), height: Number(height[1]) } : null;
}

export function frameDeclarationIn(configSource: string) {
  const text = blankComments(configSource);
  const video = new RegExp(String.raw`\bvideo\s*:\s*\{[^{}]*?\bsize\s*:\s*${EXPRESSION}`).exec(
    text,
  );
  const videoSize = video?.[1] ? squash(video[1]) : null;
  const viewports = [
    ...text.matchAll(new RegExp(String.raw`\bviewport\s*:\s*${EXPRESSION}`, 'g')),
  ].map((m) => squash(m[1]!));
  let resolved: { width: number; height: number } | null = null;
  if (videoSize?.startsWith('{')) resolved = sizeOf(videoSize);
  else if (videoSize) {
    const decl = new RegExp(String.raw`\bconst\s+${videoSize}\s*=\s*(\{[^{}]*\})`).exec(text);
    resolved = decl?.[1] ? sizeOf(decl[1]) : null;
  }
  const spread = text.search(/\.\.\.\s*devices\s*\[/);
  return {
    videoSize,
    viewports,
    resolved,
    viewportAfterDeviceSpread: spread >= 0 && text.search(/\bviewport\s*:/) > spread,
    scaleFactorOne: /\bdeviceScaleFactor\s*:\s*1\b/.test(text),
  };
}

/** The config's own `testMatch`, a RegExp literal or a string glob list. */
export function laneMatcherIn(configSource: string): (relativePath: string) => boolean {
  const text = blankComments(configSource);
  const regex = /\btestMatch\s*:\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)/.exec(text);
  if (regex) {
    const pattern = new RegExp(regex[1]!, regex[2]);
    return (rel) => pattern.test(rel);
  }
  throw new Error('playwright.acceptance.config.ts: no RegExp `testMatch` this guard can read');
}

export interface FrameViolation {
  file: string;
  line: number;
  what: string;
}

const CONTEXT_KEYS = ['viewport', 'recordVideo', 'deviceScaleFactor'];
const USE_KEYS = ['viewport', 'video', 'deviceScaleFactor'];
const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

function objectAt(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function framingKeysIn(literal: string, keys: readonly string[]): string[] {
  const found = keys.filter((key) =>
    new RegExp(String.raw`(?:^|[{,\s])${key}\s*(?::|,|\})`).test(literal),
  );
  if (/\.\.\.\s*devices\s*\[/.test(literal)) found.push('...devices[…]');
  return found;
}

export function frameViolationsIn(file: string, source: string): FrameViolation[] {
  const text = blankComments(source);
  const out: FrameViolation[] = [];
  for (const m of text.matchAll(/\bsetViewportSize\s*\(/g)) {
    out.push({
      file,
      line: lineAt(text, m.index),
      what: 'calls setViewportSize — the clip is scaled into the frame from that moment on',
    });
  }
  for (const m of text.matchAll(/(?:(\b[\w$]+)\s*\.\s*)?\b(newContext|newPage|use)\s*\(/g)) {
    const receiver = m[1] ?? '';
    const call = m[2]!;
    if (call === 'use' && receiver !== 'test') continue;
    if (call !== 'use' && /request/i.test(receiver)) continue; // an APIRequestContext
    const argStart = m.index + m[0].length;
    const lead = /^\s*/.exec(text.slice(argStart))![0].length;
    const next = text[argStart + lead];
    const line = lineAt(text, m.index);
    const label = receiver ? `${receiver}.${call}` : call;
    if (next === ')') continue;
    if (next !== '{') {
      out.push({
        file,
        line,
        what: `${label}(…) takes options this guard cannot read — pass an object literal`,
      });
      continue;
    }
    const literal = objectAt(text, argStart + lead);
    const keys =
      literal === null
        ? ['(unclosed)']
        : framingKeysIn(literal, call === 'use' ? USE_KEYS : CONTEXT_KEYS);
    if (keys.length > 0) {
      out.push({ file, line, what: `${label}({ ${keys.join(', ')} }) sets its own frame` });
    }
  }
  return out;
}

function e2eFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), rel))) {
      const child = path.posix.join(rel, entry);
      if (fs.statSync(path.join(process.cwd(), child)).isDirectory()) walk(child);
      else if (child.endsWith('.ts')) out.push(child);
    }
  };
  walk(E2E_DIR);
  return out;
}

/** The lane's specs, plus every module under `tests/e2e` they reach by a relative import. */
export function laneModules(
  files: readonly string[],
  read: (file: string) => string,
  inLane: (relativePath: string) => boolean,
): { specs: string[]; reached: string[] } {
  const known = new Set(files);
  const specs = files.filter((f) => inLane(f.slice(E2E_DIR.length + 1)));
  const reached = new Set<string>(specs);
  const queue = [...specs];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const text = blankComments(read(file));
    for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]!));
      const target = [base, `${base}.ts`, `${base}/index.ts`].find((c) => known.has(c));
      if (target && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return { specs, reached: [...reached].sort() };
}

const describeViolation = (v: FrameViolation) => `${v.file}:${v.line} — ${v.what}`;

describe('the acceptance lane records at ONE fixed frame (MOTIR-11471)', () => {
  const configSource = fs.readFileSync(ACCEPTANCE_CONFIG, 'utf8');
  const frame = frameDeclarationIn(configSource);
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

  it('the config records at exactly its viewport, spelled once, at 1920×1080', () => {
    expect(frame.videoSize, 'video.size is set').not.toBeNull();
    expect(frame.viewports.length, 'the project sets a viewport').toBeGreaterThan(0);
    for (const viewport of frame.viewports) {
      expect(viewport, 'every viewport is the expression video.size is').toBe(frame.videoSize);
    }
    expect(frame.resolved, `${frame.videoSize} resolves to the frame`).toEqual(FRAME);
  });

  it('the viewport wins over the device preset, at one CSS pixel per video pixel', () => {
    expect(frame.viewportAfterDeviceSpread).toBe(true);
    expect(frame.scaleFactorOne).toBe(true);
  });

  it('nothing the lane runs resizes the page or opens its own frame', () => {
    const { reached } = laneModules(e2eFiles(), read, laneMatcherIn(configSource));
    expect(
      reached.flatMap((f) => frameViolationsIn(f, read(f))).map(describeViolation),
      'An acceptance receipt records at the lane’s one fixed frame (1920×1080) from the first ' +
        'frame to the last. Remove the resize; a responsive check belongs in a main-lane spec.',
    ).toEqual([]);
  });
});

describe('the frame guard fires on every framing shape — demonstrated, not assumed', () => {
  const at = (source: string) => frameViolationsIn('tests/e2e/acceptance-x.spec.ts', source);

  it('RED: setViewportSize, with the line it is on', () => {
    const v = at(
      ['test("x", async ({ page }) => {', '  await page.setViewportSize(WIDE);', '});'].join('\n'),
    );
    expect(v).toHaveLength(1);
    expect(describeViolation(v[0]!)).toMatch(/^tests\/e2e\/acceptance-x\.spec\.ts:2 — /);
  });

  it('RED: a context or page at its own size, a second recorder, a preset, unreadable options', () => {
    expect(at('await browser.newContext({ viewport: { width: 390, height: 844 } });')).toHaveLength(
      1,
    );
    expect(at('const viewport = WIDE; await browser.newContext({ viewport });')).toHaveLength(1);
    expect(at("await browser.newContext({ recordVideo: { dir: 'out' } });")).toHaveLength(1);
    expect(at("await browser.newPage({ ...devices['iPhone 13'] });")).toHaveLength(1);
    expect(at('await browser.newContext(options);')[0]?.what).toMatch(/cannot read/);
  });

  it('RED: a test.use that sets the viewport, the video or a preset', () => {
    expect(at('test.use({ viewport: { width: 390, height: 844 } });')).toHaveLength(1);
    expect(at("test.use({ video: 'off' });")).toHaveLength(1);
    expect(at("test.use({ ...devices['Pixel 7'] });")).toHaveLength(1);
  });

  it('GREEN: the lane’s own frame, options that frame nothing, API contexts and prose', () => {
    expect(at('await browser.newContext();')).toEqual([]);
    expect(at('const tab = await context.newPage();')).toEqual([]);
    expect(at("await browser.newContext({ locale: 'zh', baseURL });")).toEqual([]);
    expect(at("test.use({ permissions: ['clipboard-read'] });")).toEqual([]);
    expect(at('await browser.newContext({ viewportLabel: 1 });')).toEqual([]);
    expect(at('const api = await request.newContext(opts);')).toEqual([]);
    expect(at('// never call page.setViewportSize() in this lane')).toEqual([]);
    expect(at("const url = 'https://example.test/x'; // page.setViewportSize()")).toEqual([]);
  });

  it('the config arm: one expression, resolved, after the spread, scale 1', () => {
    const good = [
      'const FRAME = { width: 1920, height: 1080 } as const;',
      "export default defineConfig({ use: { video: { mode: 'on', size: FRAME } },",
      "  projects: [{ name: 'c', use: { ...devices['Desktop Chrome'], viewport: FRAME, deviceScaleFactor: 1 } }] });",
    ].join('\n');
    expect(frameDeclarationIn(good)).toEqual({
      videoSize: 'FRAME',
      viewports: ['FRAME'],
      resolved: FRAME,
      viewportAfterDeviceSpread: true,
      scaleFactorOne: true,
    });
    const before = [
      "export default defineConfig({ use: { video: { mode: 'on', size: { width: 1280, height: 720 } } },",
      "  projects: [{ name: 'c', use: { ...devices['Desktop Chrome'] } }] });",
    ].join('\n');
    const read = frameDeclarationIn(before);
    expect(read.viewports).toEqual([]);
    expect(read.resolved).toEqual({ width: 1280, height: 720 });
    expect(read.viewportAfterDeviceSpread).toBe(false);
    const twice = good.replace('viewport: FRAME', 'viewport: { width: 1920, height: 1080 }');
    expect(frameDeclarationIn(twice).viewports).toEqual(['{ width: 1920, height: 1080 }']);
  });

  it('the walk follows relative imports, and the config’s RegExp decides the specs', () => {
    const inLane = laneMatcherIn('export default { testMatch: /acceptance.*\\.spec\\.ts/ };');
    const tree: Record<string, string> = {
      'tests/e2e/acceptance-a.spec.ts': "import { seed } from './_helpers/seed';",
      'tests/e2e/_helpers/seed.ts': "import { deep } from './deep';\nimport x from '@/lib/x';",
      'tests/e2e/_helpers/deep.ts': 'export const deep = 1;',
      'tests/e2e/widget.spec.ts': "import { unused } from './_helpers/unused';",
      'tests/e2e/_helpers/unused.ts': 'export const unused = 1;',
    };
    const result = laneModules(Object.keys(tree), (f) => tree[f]!, inLane);
    expect(result.specs).toEqual(['tests/e2e/acceptance-a.spec.ts']);
    expect(result.reached).toEqual([
      'tests/e2e/_helpers/deep.ts',
      'tests/e2e/_helpers/seed.ts',
      'tests/e2e/acceptance-a.spec.ts',
    ]);
  });
});
