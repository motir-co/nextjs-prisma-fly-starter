// ⚠️ VENDORED FROM `motir-core` (MOTIR-1941; restored by MOTIR-7255), alongside
// `scripts/upload-acceptance-video.mjs` — the pair is copied together precisely so
// a bad sync fails locally. Keep it in sync; fix bugs upstream and re-copy.
//
// SYNC POINT: motir-core `main` @ 9e2afeabdb (2026-10-02, PR #3333 — MOTIR-7253;
// identical to its branch head 39ee176ba9). Upstream verbatim except
// for ONE marked divergence: the `STORY_CLOSED_CODE` pin, which upstream anchors to
// a motir-core service class (`@/lib/acceptanceEvidence/errors`) this repo does not
// have. It is commented where it occurs. Record the new commit here when you
// re-copy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The client-direct upload (MOTIR-1681) is an ordinary PUT to a presigned URL
// since MOTIR-2389, so the shared `fetch` stub covers it — there is no SDK left
// to module-mock. The test asserts the mint → PUT → register orchestration.

// The BYOK uploader (Subtask MOTIR-1632; direct-to-Blob MOTIR-1681) — pure
// logic, no DB. Tests the no-op (red-run) path + the mint/upload/register flow.
import {
  STORY_CLOSED_CODE,
  assessArtifactSizes,
  assessWatchability,
  DEFAULT_MAX_ARTIFACT_BYTES,
  findRecordings,
  main,
  parseWorkItemKey,
  isOwnedRecording,
  resolveMaxArtifactBytes,
  resolveOwnedSpecs,
  resolveProducedByKey,
  resolveStoryKey,
  uploadAcceptanceVideo,
  putSignedArtifact,
} from '../scripts/upload-acceptance-video.mjs';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acc-video-'));
}

/** A presigned PUT URL of the shape `mintPrivateUploadToken` now returns. */
function signedPutUrl(key: string): string {
  return `https://s3.example/motir-private/${key}?X-Amz-Signature=sig&X-Amz-SignedHeaders=content-type%3Bhost`;
}

/** The PUT calls a fetch mock recorded — the direct-upload half of the flow. */
function putCalls(fetchMock: { mock: { calls: unknown[][] } }): Array<{
  url: string;
  contentType: string | undefined;
  body: unknown;
}> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT')
    .map(([url, init]) => {
      const i = init as { headers?: Record<string, string>; body?: unknown };
      return { url: String(url), contentType: i.headers?.['content-type'], body: i.body };
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Write one Playwright-shaped recording directory. */
function writeRecording(
  root: string,
  name: string,
  opts: {
    video?: string;
    trace?: boolean;
    chapters?: string | null;
    storyKey?: string | null;
    /** Adds `totalSeconds` to `recording-meta.json`; omit for an unpaced/legacy
     *  recording (no duration → the watchability guard abstains). */
    totalSeconds?: number;
    /** The spec that produced the recording (MOTIR-1937's ownership key).
     *  Defaults to `tests/e2e/<name>.spec.ts`; pass `null` for a LEGACY sidecar
     *  written before the field existed. */
    specFile?: string | null;
    /** Whether THIS run "changed" that spec — i.e. whether the recording is
     *  publishable (MOTIR-1937). Defaults to true so the publish cases keep
     *  asserting publishing; the ownership cases pass `false`. */
    owned?: boolean;
  } = {},
): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.webm'), opts.video ?? 'clip');
  if (opts.trace !== false) fs.writeFileSync(path.join(dir, 'trace.zip'), 'trace');
  if (opts.chapters !== null)
    fs.writeFileSync(path.join(dir, 'chapters.json'), opts.chapters ?? '[]');
  if (opts.storyKey)
    fs.writeFileSync(
      path.join(dir, 'acceptance-story.json'),
      JSON.stringify({ storyKey: opts.storyKey }),
    );
  // `recording-meta.json` now always exists: it carries `specFile` (the
  // MOTIR-1937 ownership key) as well as the optional duration. A watchability
  // verdict still abstains when `totalSeconds` is absent.
  const specFile = opts.specFile === undefined ? specFileFor(name) : opts.specFile;
  fs.writeFileSync(
    path.join(dir, 'recording-meta.json'),
    JSON.stringify({
      ...(opts.totalSeconds !== undefined ? { totalSeconds: opts.totalSeconds } : {}),
      ...(specFile ? { specFile } : {}),
    }),
  );
  // Own it by DEFAULT — the run "changed" this spec — so every pre-existing
  // publish case keeps asserting publish behaviour rather than silently
  // asserting the gate. An ownership case opts out with `owned: false`.
  if (specFile && opts.owned !== false) {
    const current = process.env['ACCEPTANCE_CHANGED_SPECS'] ?? '';
    process.env['ACCEPTANCE_CHANGED_SPECS'] = `${current} ${specFile}`.trim();
  }
  return dir;
}

/** The spec path `writeRecording` stamps a recording with, derived from its
 *  Playwright output-dir name (`<spec>-<title>-chromium` → the spec file). */
function specFileFor(recordingDirName: string): string {
  return `tests/e2e/${recordingDirName}.spec.ts`;
}

/**
 * Force a DETERMINISTIC walk order (name-sorted), so a walk-order-dependent bug
 * is reproducible rather than at the mercy of the OS's native readdir ordering.
 * Restored by the afterEach `vi.restoreAllMocks()`.
 */
function sortReaddir(): void {
  const realReaddir = fs.readdirSync;
  vi.spyOn(fs, 'readdirSync').mockImplementation(((dirPath, options) => {
    const entries = (realReaddir as (p: unknown, o: unknown) => Array<{ name: string }>)(
      dirPath,
      options,
    );
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
  }) as typeof fs.readdirSync);
}

describe('findRecordings', () => {
  it('returns [] when the output dir does not exist (nothing ran)', () => {
    expect(findRecordings(path.join(os.tmpdir(), 'does-not-exist-xyz'))).toEqual([]);
  });

  it('returns [] when there is no video (a red run recorded none)', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'trace.zip'), 'x');
    expect(findRecordings(dir)).toEqual([]);
  });

  it('returns EVERY chaptered recording, each with its own story (MOTIR-1734)', () => {
    // The lane as it actually stands: one chaptered acceptance spec per
    // user-facing story. Before the fix only the first (walk-order) recording
    // was published and the other two stories silently got no video.
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-augment-replan-chromium', {
      video: 'replan-clip',
      storyKey: 'MOTIR-811',
    });
    writeRecording(dir, 'acceptance-plan-change-chromium', {
      video: 'plan-change-clip',
      storyKey: 'MOTIR-1726',
    });
    writeRecording(dir, 'acceptance-video-dogfood-chromium', {
      video: 'dogfood-clip',
      storyKey: 'MOTIR-1627',
    });
    sortReaddir();

    const found = findRecordings(dir);
    expect(found).toHaveLength(3);
    expect(found.map((r) => r.storyKey)).toEqual(['MOTIR-811', 'MOTIR-1726', 'MOTIR-1627']);
    // Each recording carries ITS OWN clip — never a sibling's.
    expect(found.map((r) => fs.readFileSync(r.video, 'utf8'))).toEqual([
      'replan-clip',
      'plan-change-clip',
      'dogfood-clip',
    ]);
  });

  it('pins each recording video + trace + chapters to its OWN directory (MOTIR-1680, now per recording)', () => {
    const dir = tmpDir();
    // An un-chaptered sibling sorts FIRST, so a naive "first .webm across the
    // tree" would pair the chaptered story with the sibling's clip.
    const sibling = writeRecording(dir, 'aaa-another-test-chromium', {
      video: 'other-clip',
      chapters: null,
    });
    const chaptered = writeRecording(dir, 'zzz-dogfood-happy-path-chromium', {
      video: 'dogfood-clip',
      chapters: '[{"label":"Open the story"}]',
    });
    sortReaddir();

    const found = findRecordings(dir);
    // The un-chaptered sibling is NOT published when a chaptered recording
    // exists — it is a plain test clip, not an acceptance receipt.
    expect(found).toHaveLength(1);
    expect(path.dirname(found[0]!.video)).toBe(chaptered);
    expect(path.dirname(found[0]!.trace as string)).toBe(chaptered);
    expect(path.dirname(found[0]!.chapters as string)).toBe(chaptered);
    expect(fs.readFileSync(found[0]!.video, 'utf8')).toBe('dogfood-clip');
    expect(found.some((r) => r.dir === sibling)).toBe(false);
  });

  it("ignores a test's attachments/ subdir (hash-suffixed sidecar copies, no video)", () => {
    const dir = tmpDir();
    const rec = writeRecording(dir, 'story-acceptance-flow-chromium', { storyKey: 'MOTIR-1726' });
    const attachments = path.join(rec, 'attachments');
    fs.mkdirSync(attachments);
    fs.writeFileSync(path.join(attachments, 'chapters-89b3c14d.json'), '[]');
    fs.writeFileSync(path.join(attachments, 'acceptance-story-bf3b4a31.json'), '{}');

    const found = findRecordings(dir);
    expect(found).toHaveLength(1);
    expect(found[0]!.dir).toBe(rec);
    expect(found[0]!.storyKey).toBe('MOTIR-1726');
  });

  it('falls back to a SINGLE recording when no chapters.json exists (non-chaptered suite)', () => {
    const dir = tmpDir();
    writeRecording(dir, 'aaa-some-test-chromium', { chapters: null });
    writeRecording(dir, 'zzz-other-test-chromium', { chapters: null });
    sortReaddir();

    const found = findRecordings(dir);
    expect(found).toHaveLength(1);
    expect(found[0]!.video.endsWith('.webm')).toBe(true);
    expect(found[0]!.chapters).toBeNull();
  });

  it('finds the video + trace + chapters (nested), when present', () => {
    const dir = tmpDir();
    writeRecording(dir, 'story-acceptance-flow-chromium');
    const found = findRecordings(dir);
    expect(found[0]!.video.endsWith('.webm')).toBe(true);
    expect(found[0]!.trace?.endsWith('trace.zip')).toBe(true);
    expect(found[0]!.chapters?.endsWith('chapters.json')).toBe(true);
  });

  it('reads the recording self-declared story from acceptance-story.json (MOTIR-1684)', () => {
    const dir = tmpDir();
    writeRecording(dir, 'dogfood-chromium', { storyKey: 'MOTIR-1627' });
    expect(findRecordings(dir)[0]!.storyKey).toBe('MOTIR-1627');
  });

  it('storyKey is null when no acceptance-story.json sidecar exists', () => {
    const dir = tmpDir();
    writeRecording(dir, 'dogfood-chromium');
    expect(findRecordings(dir)[0]!.storyKey).toBeNull();
  });

  it('pins the story sidecar to its own recording — a sibling cannot shadow it', () => {
    const dir = tmpDir();
    writeRecording(dir, 'aaa-sibling-chromium', {
      video: 'other',
      chapters: null,
      storyKey: 'MOTIR-9999',
    });
    writeRecording(dir, 'zzz-dogfood-chromium', { video: 'dogfood', storyKey: 'MOTIR-1627' });
    sortReaddir();

    const found = findRecordings(dir);
    expect(found).toHaveLength(1);
    expect(found[0]!.storyKey).toBe('MOTIR-1627');
  });

  it('is deterministic — recordings come back in a stable order, not the filesystem’s', () => {
    const dir = tmpDir();
    writeRecording(dir, 'ccc-chromium', { storyKey: 'MOTIR-3' });
    writeRecording(dir, 'aaa-chromium', { storyKey: 'MOTIR-1' });
    writeRecording(dir, 'bbb-chromium', { storyKey: 'MOTIR-2' });
    // NOTE: no readdir sort mock — the function must sort its own output.
    expect(findRecordings(dir).map((r) => r.storyKey)).toEqual(['MOTIR-1', 'MOTIR-2', 'MOTIR-3']);
  });
});

describe('parseWorkItemKey', () => {
  it('extracts the key from a subtask branch ref', () => {
    expect(parseWorkItemKey('subtask/MOTIR-1684-acceptance-publish')).toBe('MOTIR-1684');
  });

  it('extracts the key from a story-level PR title', () => {
    expect(parseWorkItemKey('feat(acceptance): story gate (MOTIR-1627)')).toBe('MOTIR-1627');
  });

  it('upper-cases a lower-case ref and takes the FIRST key', () => {
    expect(parseWorkItemKey('story/motir-1644-and-motir-9')).toBe('MOTIR-1644');
  });

  it('returns null for empty / keyless text', () => {
    expect(parseWorkItemKey('')).toBeNull();
    expect(parseWorkItemKey(undefined)).toBeNull();
    expect(parseWorkItemKey('main')).toBeNull();
  });
});

// ── producedByKey is the PR's own card key (MOTIR-7253) ──────────────────────
//
// The server's idempotency key is `commitSha` + `producedByKey`
// (`recordFromPathnames`). The lane used to send the constant MOTIR-1638, so a
// CI publish and an agent's MCP publish of the SAME commit carried different
// keys and superseded each other. The PR's own card key is what the agent sends.
describe('resolveProducedByKey (MOTIR-7253)', () => {
  it('reads the PR ref first', () => {
    expect(
      resolveProducedByKey('MOTIR-7250', {
        ACCEPTANCE_PR_REF: 'subtask/MOTIR-7253-restore-uploader',
        ACCEPTANCE_PR_TITLE: 'MOTIR-9 something else',
      }),
    ).toBe('MOTIR-7253');
  });

  it('falls back to the PR title when the ref names no key', () => {
    expect(
      resolveProducedByKey('MOTIR-7250', {
        ACCEPTANCE_PR_REF: 'motir/auto-cmuq3q7kj002ihwoia',
        ACCEPTANCE_PR_TITLE: 'MOTIR-7254 stand the agent down',
      }),
    ).toBe('MOTIR-7254');
  });

  it('falls back to the story key when the PR names none — never to a constant', () => {
    expect(
      resolveProducedByKey('MOTIR-7250', { ACCEPTANCE_PR_REF: 'main', ACCEPTANCE_PR_TITLE: '' }),
    ).toBe('MOTIR-7250');
    expect(resolveProducedByKey(null, {})).toBeNull();
  });

  it('accepts any project prefix, so a starter-generated project resolves', () => {
    expect(resolveProducedByKey('ACME-1', { ACCEPTANCE_PR_REF: 'subtask/ACME-12-export' })).toBe(
      'ACME-12',
    );
  });
});

describe('resolveStoryKey (MOTIR-1684 precedence)', () => {
  it('1. explicit ACCEPTANCE_STORY_KEY outranks everything', () => {
    const r = resolveStoryKey('MOTIR-1627', {
      ACCEPTANCE_STORY_KEY: 'MOTIR-42',
      ACCEPTANCE_PR_REF: 'subtask/MOTIR-100-x',
      ACCEPTANCE_FALLBACK_STORY_KEY: 'MOTIR-1627',
    });
    expect(r).toEqual({ storyKey: 'MOTIR-42', source: 'explicit' });
  });

  it('2. the recording self-declared story outranks the PR-derived key', () => {
    const r = resolveStoryKey('MOTIR-1627', {
      ACCEPTANCE_PR_REF: 'subtask/MOTIR-100-unrelated',
      ACCEPTANCE_FALLBACK_STORY_KEY: 'MOTIR-1627',
    });
    expect(r).toEqual({ storyKey: 'MOTIR-1627', source: 'recording' });
  });

  it('3. no self-declared story → the PR ref MOTIR-<id> (subtask → parent server-side)', () => {
    const r = resolveStoryKey(null, {
      ACCEPTANCE_PR_REF: 'subtask/MOTIR-816-importer',
      ACCEPTANCE_FALLBACK_STORY_KEY: 'MOTIR-1627',
    });
    expect(r).toEqual({ storyKey: 'MOTIR-816', source: 'pr' });
  });

  it('3b. PR title is parsed when the ref carries no key', () => {
    const r = resolveStoryKey(null, {
      ACCEPTANCE_PR_REF: 'main',
      ACCEPTANCE_PR_TITLE: 'feat: importer (MOTIR-816)',
      ACCEPTANCE_FALLBACK_STORY_KEY: 'MOTIR-1627',
    });
    expect(r).toEqual({ storyKey: 'MOTIR-816', source: 'pr' });
  });

  it('4. nothing declared and no PR id (push-to-main) → the dogfood fallback', () => {
    const r = resolveStoryKey(null, {
      ACCEPTANCE_PR_REF: '',
      ACCEPTANCE_PR_TITLE: '',
      ACCEPTANCE_FALLBACK_STORY_KEY: 'MOTIR-1627',
    });
    expect(r).toEqual({ storyKey: 'MOTIR-1627', source: 'fallback' });
  });

  it('nothing resolves → null (a misconfiguration the caller errors on)', () => {
    expect(resolveStoryKey(null, {})).toEqual({ storyKey: null, source: 'none' });
  });
});

// MOTIR-1911 — the artifact-size boundary. Measured on run 30579274284: the
// cadence recording's trace.zip was 118,924,401 B against a 104,857,600 B cap
// while its video.webm was 6,340,169 B, so MOTIR-813 lost its receipt to an
// artifact that is a debugging aid rather than the receipt.
describe('assessArtifactSizes (MOTIR-1911)', () => {
  /** Write a file of exactly `bytes` bytes. */
  function sized(dir: string, name: string, bytes: number): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.alloc(bytes));
    return file;
  }

  it('passes both artifacts when they are under the cap', () => {
    const dir = tmpDir();
    const result = assessArtifactSizes({
      video: sized(dir, 'v.webm', 10),
      trace: sized(dir, 't.zip', 20),
      maxBytes: 100,
    });
    expect(result).toMatchObject({
      videoBytes: 10,
      traceBytes: 20,
      publishable: true,
      reason: null,
      dropTrace: false,
      dropReason: null,
    });
  });

  it('DROPS an over-cap trace but keeps the recording publishable — the receipt is the video', () => {
    const dir = tmpDir();
    const result = assessArtifactSizes({
      video: sized(dir, 'v.webm', 10),
      trace: sized(dir, 't.zip', 300),
      maxBytes: 100,
    });
    expect(result.publishable).toBe(true);
    expect(result.dropTrace).toBe(true);
    expect(result.dropReason).toContain('the trace is');
  });

  it('REJECTS an over-cap video — the receipt itself cannot be dropped', () => {
    const dir = tmpDir();
    const result = assessArtifactSizes({
      video: sized(dir, 'v.webm', 300),
      trace: sized(dir, 't.zip', 10),
      maxBytes: 100,
    });
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('the video is');
    expect(result.dropTrace).toBe(false);
  });

  it('a recording with no trace measures the video alone', () => {
    const dir = tmpDir();
    const result = assessArtifactSizes({
      video: sized(dir, 'v.webm', 10),
      trace: null,
      maxBytes: 100,
    });
    expect(result).toMatchObject({ traceBytes: null, dropTrace: false, publishable: true });
  });

  it('an artifact exactly AT the cap is fine — the limit is inclusive, as Blob’s is', () => {
    const dir = tmpDir();
    const result = assessArtifactSizes({
      video: sized(dir, 'v.webm', 100),
      trace: sized(dir, 't.zip', 100),
      maxBytes: 100,
    });
    expect(result).toMatchObject({ publishable: true, dropTrace: false });
  });

  it('abstains on an unreadable file rather than guessing a size', () => {
    const result = assessArtifactSizes({
      video: path.join(os.tmpdir(), 'no-such-video-xyz.webm'),
      trace: null,
      maxBytes: 1,
    });
    expect(result).toMatchObject({ videoBytes: null, publishable: true });
  });
});

describe('resolveMaxArtifactBytes (MOTIR-1911)', () => {
  it('defaults to the cloud `scaled` tier per-file cap', () => {
    expect(resolveMaxArtifactBytes({})).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
    expect(DEFAULT_MAX_ARTIFACT_BYTES).toBe(104857600);
  });

  it('honours an explicit override — a deployment on the 10 MB baseline sets it', () => {
    expect(resolveMaxArtifactBytes({ ACCEPTANCE_MAX_ARTIFACT_BYTES: '10485760' })).toBe(10485760);
  });

  it('IGNORES a junk / non-positive override rather than disabling the gate', () => {
    for (const raw of ['', '   ', 'lots', '0', '-5', 'NaN']) {
      expect(resolveMaxArtifactBytes({ ACCEPTANCE_MAX_ARTIFACT_BYTES: raw })).toBe(
        DEFAULT_MAX_ARTIFACT_BYTES,
      );
    }
  });
});

// MOTIR-3313 — a RETRYABLE refusal must not cost a story its receipt.
//
// The incident: on motir-core PR #2237 the store answered one artifact's PUT with
// `503 <Code>SlowDown</Code>` — twice, deterministically, on the same recording.
// Every test in the lane had passed; the publish went red, and Story MOTIR-3232
// was left holding ONE of its two receipts while `CI complete` stayed green.
//
// ⚠️ THESE TESTS DO NOT ASSERT A CAUSE, because none is established: the refused
// trace was 45.9 MB and an 89.3 MB trace published seconds later in the same job,
// so it is neither size nor the MOTIR-1911 cap, and the same recording's video
// had just uploaded fine. (Those two figures were 37.0 / 65.8 MB here until
// MOTIR-3408 read them off the incident's own retained CI artifact rather than a
// local regeneration; the conclusion is unchanged and the gap is wider.) What they pin is the narrower thing that is defensible
// without a mechanism — one transient refusal is not the end of the upload — and,
// just as importantly, that a refusal the store means PERMANENTLY still fails at
// once, so a signature bug cannot hide behind four attempts.
describe('putSignedArtifact — a retryable refusal is retried (MOTIR-3313)', () => {
  /** Injected in place of the backoff, so the retry is asserted without
   *  wall-clock. The delays it is handed are asserted too — a retry that does not
   *  actually back off is a burst with extra steps. */
  function recordingSleep() {
    const slept: number[] = [];
    return { slept, sleep: async (ms: number) => void slept.push(ms) };
  }

  function target() {
    return {
      token: signedPutUrl('acceptance/w/s/uuid-trace.zip'),
      contentType: 'application/zip',
      pathname: 'acceptance/w/s/uuid-trace.zip',
    };
  }

  function traceFile(): string {
    const file = path.join(tmpDir(), 't.zip');
    fs.writeFileSync(file, 'trace-bytes');
    return file;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('a 503 that clears on the next attempt PUBLISHES, and backs off in between', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 503, text: async () => '<Code>SlowDown</Code>' }
        : { ok: true, status: 200, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { slept, sleep } = recordingSleep();

    await expect(
      putSignedArtifact('trace', traceFile(), target(), { baseDelayMs: 100, sleep }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // One wait, and it is at least the base step (the jitter only ever adds).
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(100);
  });

  it('sends the SAME bytes on the retry — the file is read once, not per attempt', async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: { body: unknown }) => {
      bodies.push(init.body);
      calls += 1;
      return calls === 1
        ? { ok: false, status: 429, text: async () => 'slow down' }
        : { ok: true, status: 200, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { sleep } = recordingSleep();

    await putSignedArtifact('trace', traceFile(), target(), { baseDelayMs: 1, sleep });

    expect(bodies).toHaveLength(2);
    expect(Buffer.from(bodies[1] as Uint8Array).toString()).toBe('trace-bytes');
    // The identical Buffer instance, not a second read of the same path.
    expect(bodies[1]).toBe(bodies[0]);
  });

  it('gives up after the last attempt, and the error names the store’s own reason', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => '<Code>SlowDown</Code><Message>Please reduce your request rate.</Message>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { slept, sleep } = recordingSleep();

    await expect(
      putSignedArtifact('trace', traceFile(), target(), { attempts: 3, baseDelayMs: 1, sleep }),
    ).rejects.toThrow(/Acceptance trace upload failed: 503 .*SlowDown/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Three attempts, TWO waits — it never sleeps after the last one.
    expect(slept).toHaveLength(2);
  });

  it('does NOT retry a refusal the store means permanently', async () => {
    // ⚠️ THE HALF THAT KEEPS THE RETRY HONEST. A presigned PUT's 403 is a
    // SIGNATURE failure (`content-type` unbound or mismatched — see the header on
    // `putSignedArtifact`), and MOTIR-2499's lesson is that a wire-contract break
    // must fail LOUDLY and immediately. Retrying it would send the same doomed
    // bytes four times and delay the one message that names the real problem.
    for (const status of [400, 403, 404]) {
      const fetchMock = vi.fn(async () => ({ ok: false, status, text: async () => 'nope' }));
      vi.stubGlobal('fetch', fetchMock);
      const { slept, sleep } = recordingSleep();

      await expect(
        putSignedArtifact('video', traceFile(), target(), { baseDelayMs: 1, sleep }),
      ).rejects.toThrow(new RegExp(`Acceptance video upload failed: ${status}`));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(slept).toHaveLength(0);
    }
  });

  it('the whole publish survives a 503 on the TRACE — the incident, end to end', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    const trace = path.join(dir, 't.zip');
    fs.writeFileSync(video, 'video-bytes');
    fs.writeFileSync(trace, 'trace-bytes');

    let tracePuts = 0;
    const fetchMock = vi.fn(async (url: string, init: { method?: string }) => {
      if (url.endsWith('/upload-token')) {
        return {
          ok: true,
          json: async () => ({
            video: {
              pathname: 'acceptance/w/s/v.webm',
              token: signedPutUrl('acceptance/w/s/v.webm'),
              contentType: 'video/webm',
            },
            trace: {
              pathname: 'acceptance/w/s/t.zip',
              token: signedPutUrl('acceptance/w/s/t.zip'),
              contentType: 'application/zip',
            },
          }),
        };
      }
      if (init?.method === 'PUT') {
        if (!url.includes('t.zip')) return { ok: true, status: 200, text: async () => '' };
        tracePuts += 1;
        // Refused once, exactly as PR #2237 saw it — then it goes through.
        return tracePuts === 1
          ? { ok: false, status: 503, text: async () => '<Code>SlowDown</Code>' }
          : { ok: true, status: 200, text: async () => '' };
      }
      return { ok: true, json: async () => ({ evidence: { id: 'ev-retry' } }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 'motir_pat_abc',
        storyKey: 'MOTIR-3232',
        artifacts: { video, trace, chapters: null },
        retry: { baseDelayMs: 1, sleep: async () => {} },
      }),
    ).resolves.toEqual({ evidence: { id: 'ev-retry' } });

    // Two PUTs to the trace URL — the refusal and the one that landed.
    expect(tracePuts).toBe(2);

    // …and the receipt is REGISTERED WITH ITS TRACE, which is the thing the
    // incident actually lost. `/upload-token` is a POST too, so the register call
    // is found by its own address, not by its method.
    const register = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/acceptance-evidence'),
    );
    expect(register).toBeTruthy();
    const body = JSON.parse((register![1] as { body: string }).body) as {
      tracePathname: string | null;
    };
    expect(body.tracePathname).toBe('acceptance/w/s/t.zip');
  });
});

// MOTIR-3565 — the store's `x-amz-request-id`, on EVERY attempt.
//
// MOTIR-3313 has no established cause and every remaining route to one runs
// through the store, which cannot look anything up without ids. The two ids the
// incident holds came out of the error XML body, so they name exactly one thing:
// the write that FAILED. What a store-side lookup needs is the CONTRAST — the
// refusal set against its accepted neighbours, which is the whole shape of the
// incident (a 45.9 MB refusal between a 2.1 MB and an 89.3 MB success). A
// 190-PUT probe against Tigris established that EVERY response carries the
// header, successes included; the uploader was reading nothing off the response
// at all.
//
// ⚠️ THESE TESTS ASSERT NO CAUSE, exactly as the block above does not. An id in
// a log claims nothing about rate limits, key prefixes or shards — it only makes
// the next occurrence answerable. The retry policy is untouched, and the block
// below pins that.
describe('putSignedArtifact — the store’s request id is logged on every attempt (MOTIR-3565)', () => {
  function target() {
    return {
      token: signedPutUrl('acceptance/w/s/uuid-trace.zip'),
      contentType: 'application/zip',
      pathname: 'acceptance/w/s/uuid-trace.zip',
    };
  }

  function traceFile(): string {
    const file = path.join(tmpDir(), 't.zip');
    fs.writeFileSync(file, 'trace-bytes');
    return file;
  }

  /** A response whose `headers.get` answers like a real `fetch` Headers does. */
  function withRequestId(id: string | null, rest: Record<string, unknown>) {
    return {
      headers: { get: (name: string) => (name === 'x-amz-request-id' ? id : null) },
      ...rest,
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('an ACCEPTED PUT logs its id — the neighbour half the incident is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => withRequestId('1787275315546191428', { ok: true, status: 200 })),
    );
    // Held by reference rather than asserted through `console.log` by name —
    // naming it is what trips the no-console lint rule (same as the blocks below).
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(putSignedArtifact('video', traceFile(), target())).resolves.toBeUndefined();

    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('1787275315546191428');
    // Which artifact it belongs to, so two ids in one job are tellable apart.
    expect(out).toContain('Acceptance video upload accepted');
  });

  it('a REFUSED PUT carries its id into the retry line AND the thrown message', async () => {
    // Two DIFFERENT ids, because the point is one id PER ATTEMPT: a store that
    // refuses twice issues two writes, and collapsing them to one loses the
    // second. The retry announcement carries the first; the throw carries the
    // last, which is the one a lookup starts from.
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return withRequestId(`req-attempt-${calls}`, {
          ok: false,
          status: 503,
          text: async () => '<Code>SlowDown</Code>',
        });
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      putSignedArtifact('trace', traceFile(), target(), {
        attempts: 2,
        baseDelayMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/request id req-attempt-2/);

    expect(warnSpy.mock.calls.flat().join('\n')).toContain('req-attempt-1');
  });

  it('an ABSENT header does not throw — a placeholder is logged, and the publish completes', async () => {
    // ⚠️ THE POINT: a store is free to stop sending the header, and the publish
    // is not free to die when it does. Both terminal outcomes are exercised,
    // because a reader that only ever ran on the accepted path would still take
    // the whole lane down on the refused one.
    for (const res of [
      withRequestId(null, { ok: true, status: 200 }),
      // No `headers` key AT ALL — the shape most of this suite's stubs use, and
      // the one a naive `res.headers.get(…)` dies on.
      { ok: true, status: 200, text: async () => '' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => res),
      );
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(putSignedArtifact('video', traceFile(), target())).resolves.toBeUndefined();

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('(no x-amz-request-id)');
      // The failure this guards is a placeholder that reads as an uploader bug.
      expect(out).not.toContain('undefined');
      logSpy.mockRestore();
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' })),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      putSignedArtifact('trace', traceFile(), target(), {
        attempts: 2,
        baseDelayMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/\(no x-amz-request-id\)/);
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('(no x-amz-request-id)');
  });

  it('NO part of the presigned grant reaches the log — not the signature, not the URL', async () => {
    // ⚠️ `target.token` is a live presigned signature and `moooon-B-V/motir-core`
    // is a public repository with public job logs. A grep over the source proves
    // no `console.*` NAMES the token; this proves none of it is EMITTED, which
    // survives a future line that reaches the URL by another route.
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? withRequestId('req-refused', {
              ok: false,
              status: 503,
              text: async () => '<Code>SlowDown</Code>',
            })
          : withRequestId('req-accepted', { ok: true, status: 200 });
      }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const t = target();
    await putSignedArtifact('trace', traceFile(), t, { baseDelayMs: 1, sleep: async () => {} });

    const emitted = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join('\n');
    // Both attempts were logged — so the assertions below are about a log that
    // actually ran, not a silent one.
    expect(emitted).toContain('req-refused');
    expect(emitted).toContain('req-accepted');
    expect(emitted).not.toContain(t.token);
    expect(emitted).not.toContain('X-Amz-Signature');
    expect(emitted).not.toContain('s3.example');
  });

  // ⚠️ MOTIR-3313 SETTLED THE RETRY POLICY, and this card changes none of it —
  // it adds observability to the existing control flow. Read off the FILE rather
  // than off a moving branch, so a later edit to the constants fails here.
  it('leaves the retry policy exactly as MOTIR-3313 left it', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/upload-acceptance-video.mjs'),
      'utf8',
    );
    expect(src).toContain(
      'const RETRYABLE_PUT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);',
    );
    expect(src).toContain('const PUT_ATTEMPTS = 4;');
    expect(src).toContain('const PUT_BASE_DELAY_MS = 500;');
    // The line MOTIR-3313 declared untouchable — it counts RECORDINGS, and it is
    // what told the truth during the incident. ⚠️ It is CONCATENATED in the
    // source (`… owned acceptance ` + `recording(s) …`), so a grep for the whole
    // phrase matches zero times against a file that plainly contains it — assert
    // the fragment that is really there. What it READS at runtime is pinned by
    // the `Published N of M` assertions in the exit-verdict block below.
    expect(src).toContain('owned acceptance ');
    // And the id is read off the RESPONSE, not parsed back out of the error XML.
    expect(src).toContain("res.headers.get('x-amz-request-id')");
  });
});

// MOTIR-3409 — when the retry is EXHAUSTED, which artifact was it?
//
// The block above pins that a transient refusal is retried. This one pins what
// happens when retrying does not work, and the answer differs by artifact —
// which is MOTIR-1911's rule, applied to the axis it was never written for
// (`docs/decisions/acceptance-video.md` § Amendment 2026-08-23):
//
//   trace refused terminally → DROPPED; the receipt still lands; a warning
//   video refused terminally → FATAL; there is nothing to fall back to
//
// The point of the first is MOTIR-3313's actual cost: the throw used to escape
// past the register POST, so a video that had already uploaded was orphaned and
// the story lost a receipt to a debugging aid.
describe('an EXHAUSTED refusal — the trace drops, the video is fatal (MOTIR-3409)', () => {
  function fixture() {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    const trace = path.join(dir, 't.zip');
    fs.writeFileSync(video, 'video-bytes');
    fs.writeFileSync(trace, 'trace-bytes');
    return { video, trace };
  }

  /** Mints both targets, then defers every PUT to `onPut` and answers the
   *  register call with a fixed evidence id. */
  function stubStore(onPut: (url: string) => { ok: boolean; status?: number }) {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).endsWith('/upload-token')) {
        return {
          ok: true,
          json: async () => ({
            video: {
              pathname: 'acceptance/w/s/v.webm',
              token: signedPutUrl('acceptance/w/s/v.webm'),
              contentType: 'video/webm',
            },
            trace: {
              pathname: 'acceptance/w/s/t.zip',
              token: signedPutUrl('acceptance/w/s/t.zip'),
              contentType: 'application/zip',
            },
          }),
        };
      }
      if (init?.method === 'PUT') {
        const verdict = onPut(String(url));
        return verdict.ok
          ? { ok: true, status: 200, text: async () => '' }
          : {
              ok: false,
              status: verdict.status ?? 503,
              text: async () => '<Code>SlowDown</Code>',
            };
      }
      return { ok: true, json: async () => ({ evidence: { id: 'ev-dropped' } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('a TRACE refused on every attempt is DROPPED — the receipt is registered without it', async () => {
    const { video, trace } = fixture();
    let tracePuts = 0;
    const fetchMock = stubStore((url) => {
      if (!url.includes('t.zip')) return { ok: true };
      tracePuts += 1;
      return { ok: false, status: 503 };
    });

    const result = await uploadAcceptanceVideo({
      baseUrl: 'https://app.motir.co',
      token: 'motir_pat_abc',
      storyKey: 'MOTIR-3232',
      artifacts: { video, trace, chapters: null },
      retry: { baseDelayMs: 1, sleep: async () => {} },
    });

    // It did not give up early: every attempt was spent before dropping.
    expect(tracePuts).toBe(4);

    // THE THING THE INCIDENT LOST — the evidence row exists, and it names the
    // video. Before this card the throw escaped before this call was ever made.
    const register = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/acceptance-evidence'),
    );
    expect(register).toBeTruthy();
    const body = JSON.parse((register![1] as { body: string }).body) as {
      videoPathname: string | null;
      tracePathname: string | null;
    };
    expect(body.videoPathname).toBe('acceptance/w/s/v.webm');
    // NOT the pathname of a blob that was never written — the row must not point
    // at nothing (the same invariant the over-cap drop keeps).
    expect(body.tracePathname).toBeNull();

    // And the caller is TOLD, so it can warn rather than publish in silence.
    expect(result).toMatchObject({ evidence: { id: 'ev-dropped' } });
    expect((result as { traceDropped?: string }).traceDropped).toContain('503');
  });

  it('a VIDEO refused on every attempt still THROWS — the receipt has no fallback', async () => {
    const { video, trace } = fixture();
    const fetchMock = stubStore((url) => (url.includes('v.webm') ? { ok: false } : { ok: true }));

    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 'motir_pat_abc',
        storyKey: 'MOTIR-3232',
        artifacts: { video, trace, chapters: null },
        retry: { baseDelayMs: 1, sleep: async () => {} },
      }),
    ).rejects.toThrow(/Acceptance video upload failed/);

    // Nothing was registered — a story with no clip has no receipt to write.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/acceptance-evidence')),
    ).toHaveLength(0);
  });
});

describe('uploadAcceptanceVideo', () => {
  interface FetchInit {
    method?: string;
    headers: Record<string, string>;
    body: string;
  }

  /** A fetch mock that answers the mint-token call, the presigned PUT(s), then
   *  the register call. */
  function stubPublishFetch(evidenceId = 'ev1', tokens?: unknown) {
    const fetchMock = vi.fn(async (url: string, init: FetchInit) => {
      if (url.endsWith('/upload-token')) {
        return {
          ok: true,
          json: async () =>
            tokens ?? {
              video: {
                pathname: 'acceptance/w/s/uuid-acceptance.webm',
                token: signedPutUrl('acceptance/w/s/uuid-acceptance.webm'),
                contentType: 'video/webm',
              },
              trace: null,
            },
        };
      }
      if (init?.method === 'PUT') return { ok: true, status: 200, text: async () => '' };
      return { ok: true, json: async () => ({ evidence: { id: evidenceId } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('mints a token, PUTs the video direct to Blob, then registers the pathname as JSON', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, 'bytes');
    const fetchMock = stubPublishFetch('ev1');

    const result = await uploadAcceptanceVideo({
      baseUrl: 'https://app.motir.co/',
      token: 'motir_pat_abc',
      storyKey: 'MOTIR-1627',
      artifacts: { video, trace: null, chapters: null },
      provenance: { commitSha: 'abc', ciRunUrl: null, producedByKey: 'MOTIR-1638' },
    });

    expect(result).toEqual({ evidence: { id: 'ev1' } });

    // 1. Mint-token call.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe(
      'https://app.motir.co/api/work-items/MOTIR-1627/acceptance-evidence/upload-token',
    );
    expect(tokenInit.headers.authorization).toBe('Bearer motir_pat_abc');
    expect(JSON.parse(tokenInit.body)).toEqual({ hasTrace: false });

    // 2. Direct PUT to the presigned URL — NOT through the API. The
    //    `content-type` header is REQUIRED and must equal the type the server
    //    bound at signing time: it is inside X-Amz-SignedHeaders, so a missing
    //    or mismatched one is a signature failure (MOTIR-2389).
    const puts = putCalls(fetchMock);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe(signedPutUrl('acceptance/w/s/uuid-acceptance.webm'));
    expect(puts[0]!.contentType).toBe('video/webm');

    // 3. Register call — JSON pathnames, never the bytes.
    const [registerUrl, registerInit] = fetchMock.mock.calls[2]!;
    expect(registerUrl).toBe('https://app.motir.co/api/work-items/MOTIR-1627/acceptance-evidence');
    expect(registerInit.headers['content-type']).toBe('application/json');
    expect(JSON.parse(registerInit.body)).toMatchObject({
      videoPathname: 'acceptance/w/s/uuid-acceptance.webm',
      tracePathname: null,
      commitSha: 'abc',
      producedByKey: 'MOTIR-1638',
    });
  });

  it('uses keyless OIDC headers (marker + OIDC bearer) on both calls', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, 'bytes');
    const fetchMock = stubPublishFetch('ev2');

    await uploadAcceptanceVideo({
      baseUrl: 'https://app.motir.co',
      oidcToken: 'oidc.jwt.token',
      storyKey: 'MOTIR-1627',
      artifacts: { video, trace: null, chapters: null },
    });

    // The two API calls carry the auth headers. The presigned PUT deliberately
    // does NOT — its authorization IS the signature, and sending a bearer to the
    // object store would leak the credential to a third party.
    const apiCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/'));
    expect(apiCalls).toHaveLength(2);
    for (const [, init] of apiCalls) {
      expect(init.headers.authorization).toBe('Bearer oidc.jwt.token');
      expect(init.headers['x-motir-auth']).toBe('github-oidc');
    }
    expect(putCalls(fetchMock)[0]!.contentType).toBe('video/webm');
  });

  it('uploads the trace too and registers both pathnames when a trace is present', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    const trace = path.join(dir, 't.zip');
    fs.writeFileSync(video, 'bytes');
    fs.writeFileSync(trace, 'trace-bytes');
    const fetchMock = stubPublishFetch('ev3', {
      video: {
        pathname: 'acceptance/w/s/uuid-acceptance.webm',
        token: signedPutUrl('acceptance/w/s/uuid-acceptance.webm'),
        contentType: 'video/webm',
      },
      trace: {
        pathname: 'acceptance/w/s/uuid-trace.zip',
        token: signedPutUrl('acceptance/w/s/uuid-trace.zip'),
        contentType: 'application/zip',
      },
    });

    await uploadAcceptanceVideo({
      baseUrl: 'https://app.motir.co',
      token: 't',
      storyKey: 'MOTIR-1627',
      artifacts: { video, trace, chapters: null },
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ hasTrace: true });
    // Each artifact PUTs with ITS OWN bound content type — the trace must not
    // inherit the video's, or it lands as the wrong thing (the bound-at-signing
    // hazard this seam exists to make impossible).
    expect(putCalls(fetchMock).map((c) => c.contentType)).toEqual([
      'video/webm',
      'application/zip',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toMatchObject({
      videoPathname: 'acceptance/w/s/uuid-acceptance.webm',
      tracePathname: 'acceptance/w/s/uuid-trace.zip',
    });
  });

  it('throws when the register call returns a non-2xx response', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, 'bytes');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (url.endsWith('/upload-token')) {
          return {
            ok: true,
            json: async () => ({
              video: {
                pathname: 'acceptance/w/s/v.webm',
                token: signedPutUrl('acceptance/w/s/v.webm'),
                contentType: 'video/webm',
              },
              trace: null,
            }),
          };
        }
        if (init?.method === 'PUT') return { ok: true, status: 200, text: async () => '' };
        return { ok: false, status: 400, text: async () => 'ACCEPTANCE_EVIDENCE_BLOB_MISSING' };
      }),
    );
    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 't',
        storyKey: 'MOTIR-1627',
        artifacts: { video, trace: null, chapters: null },
      }),
    ).rejects.toThrow(/400/);
  });

  // MOTIR-1911 — the mint reports the cap it bound into the grant, so an over-cap
  // artifact fails by NAME here. Since MOTIR-2389 the presigned PUT has no size
  // ceiling of its own, so this up-front check is what stops a doomed upload from
  // being sent in full only to be refused by the register step.
  it('refuses an artifact over the MINTED cap, by name, before it is uploaded', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, Buffer.alloc(50));
    const fetchMock = stubPublishFetch('ev-cap', {
      video: {
        pathname: 'acceptance/v.webm',
        token: signedPutUrl('acceptance/v.webm'),
        contentType: 'video/webm',
        maxBytes: 10,
      },
      trace: null,
    });

    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 'motir_pat_abc',
        storyKey: 'MOTIR-813',
        artifacts: { video, trace: null, chapters: null },
      }),
    ).rejects.toThrow(/the video is .* over the publish target's .* per-file limit/);
    expect(putCalls(fetchMock)).toHaveLength(0);
  });

  it('abstains when the mint reports no cap (an older server) — the flow is unchanged', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, Buffer.alloc(50));
    const fetchMock = stubPublishFetch('ev-nocap'); // the default stub carries no `maxBytes`

    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 'motir_pat_abc',
        storyKey: 'MOTIR-813',
        artifacts: { video, trace: null, chapters: null },
      }),
    ).resolves.toEqual({ evidence: { id: 'ev-nocap' } });
    expect(putCalls(fetchMock)).toHaveLength(1);
  });

  it('throws when the token mint returns a non-2xx response (before any upload)', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'v.webm');
    fs.writeFileSync(video, 'bytes');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'no_plan' }),
    );
    await expect(
      uploadAcceptanceVideo({
        baseUrl: 'https://app.motir.co',
        token: 't',
        storyKey: 'MOTIR-1627',
        artifacts: { video, trace: null, chapters: null },
      }),
    ).rejects.toThrow(/402/);
  });
});

// The ORCHESTRATION — the layer the MOTIR-1734 bug actually lived in. Both its
// parts were covered and correct; the loop between them published one story and
// dropped the rest, so nothing failed. These drive `main()` end to end over a
// fixture output dir, with the network + Blob mocked.
describe('main — one publish per recording (MOTIR-1734)', () => {
  const ENV_KEYS = [
    'ACCEPTANCE_OUTPUT_DIR',
    'MOTIR_PUBLISH_TOKEN',
    'MOTIR_BASE_URL',
    'ACCEPTANCE_STORY_KEY',
    'ACCEPTANCE_PR_REF',
    'ACCEPTANCE_PR_TITLE',
    'ACCEPTANCE_FALLBACK_STORY_KEY',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    // MOTIR-1905 — the two CI reporting channels. Cleared per test so the
    // annotation assertion is explicit about turning them ON, and so a real
    // `GITHUB_STEP_SUMMARY` (this suite DOES run under Actions) is never
    // appended to by the tests.
    'GITHUB_ACTIONS',
    'GITHUB_STEP_SUMMARY',
    // MOTIR-1937 — the spec-ownership gate. In ENV_KEYS so each test starts from
    // a known owned-set rather than inheriting the ambient one.
    'ACCEPTANCE_CHANGED_SPECS',
    // MOTIR-1911 — the per-file cap. The size cases set a tiny one so a fixture
    // is "over the limit" at a handful of bytes rather than 100 MB on disk.
    'ACCEPTANCE_MAX_ARTIFACT_BYTES',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // PAT auth (no OIDC vars → keyless path is skipped).
    process.env['MOTIR_PUBLISH_TOKEN'] = 'motir_pat_test';
    process.env['MOTIR_BASE_URL'] = 'https://app.motir.co';
    // Start owning NOTHING; `writeRecording` adds each fixture's spec as it is
    // created (MOTIR-1937), so a publish case owns exactly what it recorded and
    // an ownership case opts out per recording with `owned: false`.
    process.env['ACCEPTANCE_CHANGED_SPECS'] = '';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** The story key each register call targeted, in call order. */
  function publishedStories(fetchMock: { mock: { calls: unknown[][] } }): string[] {
    return (
      fetchMock.mock.calls
        .map(([url]) => String(url))
        // The presigned PUTs go to the object store, not the API — only the
        // register calls (the API URL, without the mint suffix) count.
        .filter((url) => url.includes('/acceptance-evidence') && !url.endsWith('/upload-token'))
        .map((url) => /work-items\/([^/]+)\/acceptance-evidence/.exec(url)?.[1] ?? '')
    );
  }

  /** The JSON body of the FIRST register call (the mint calls carry a different
   *  shape) — how a test inspects what was actually registered. */
  function registeredBody(fetchMock: {
    mock: { calls: Array<[string, { body?: string }?]> };
  }): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(
      ([url]) => url.includes('/acceptance-evidence') && !url.endsWith('/upload-token'),
    );
    return JSON.parse(call?.[1]?.body ?? '{}') as Record<string, unknown>;
  }

  function stubFetch(
    onRegister?: (storyKey: string) => { ok: boolean; status?: number; body?: string },
  ) {
    const fetchMock = vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
      if (init?.method === 'PUT') return { ok: true, status: 200, text: async () => '' };
      if (url.endsWith('/upload-token')) {
        return {
          ok: true,
          json: async () => ({
            video: {
              pathname: 'acceptance/v.webm',
              token: signedPutUrl('acceptance/v.webm'),
              contentType: 'video/webm',
            },
            trace: {
              pathname: 'acceptance/t.zip',
              token: signedPutUrl('acceptance/t.zip'),
              contentType: 'application/zip',
            },
          }),
        };
      }
      const storyKey = /work-items\/([^/]+)\//.exec(url)?.[1] ?? '';
      const verdict = onRegister?.(storyKey) ?? { ok: true };
      if (!verdict.ok) {
        return {
          ok: false,
          status: verdict.status ?? 500,
          text: async () => verdict.body ?? 'boom',
        };
      }
      return { ok: true, json: async () => ({ evidence: { id: `ev-${storyKey}` } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('REFUSES to publish an unwatchable recording — nothing uploads, the step fails', async () => {
    // The MOTIR-1772 gate end to end: the guard must bite in `main`, BEFORE any
    // auth or upload, so a raced recording can never land as a story's receipt.
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-raced-chromium', {
      storyKey: 'MOTIR-813',
      chapters: JSON.stringify([
        { label: 'one', tSeconds: 1.7 },
        { label: 'two', tSeconds: 2.5 },
        { label: 'three', tSeconds: 3.1 },
      ]),
      totalSeconds: 5,
    });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    const fetchMock = stubFetch();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    await expect(main()).rejects.toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
    // NOTHING was published — not even a token mint.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // MOTIR-1905 — the blast radius of ONE unwatchable clip.
  //
  // The gate used to `process.exit(1)` before publishing anything, so a single
  // unpaced spec suppressed EVERY story's receipt in the lane. That is exactly
  // what shipped: `acceptance-augment-replan` recorded ~9.5s and, from the day
  // the floor landed, no story got a video on `main` or on any PR — while the
  // step read green behind `continue-on-error`.
  it('an UNWATCHABLE recording costs only its OWN story — the others still publish (MOTIR-1905)', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-good-a-chromium', { storyKey: 'MOTIR-1863' });
    writeRecording(dir, 'acceptance-raced-chromium', {
      storyKey: 'MOTIR-811',
      chapters: JSON.stringify([
        { label: 'one', tSeconds: 0.5 },
        { label: 'two', tSeconds: 3.0 },
      ]),
      totalSeconds: 9.5, // the real regression's duration
    });
    writeRecording(dir, 'acceptance-good-b-chromium', { storyKey: 'MOTIR-1627' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const fetchMock = stubFetch();

    await main();

    // The two watchable recordings published; the raced one did NOT.
    expect(publishedStories(fetchMock)).toEqual(['MOTIR-1863', 'MOTIR-1627']);
    expect(publishedStories(fetchMock)).not.toContain('MOTIR-811');
    // …and the step still fails, so a partial publish is never silently green.
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MOTIR-811'));
  });

  it('emits a CI annotation for an unwatchable clip, so continue-on-error cannot hide it (MOTIR-1905)', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-good-chromium', { storyKey: 'MOTIR-1863' });
    writeRecording(dir, 'acceptance-raced-chromium', {
      storyKey: 'MOTIR-811',
      chapters: JSON.stringify([{ label: 'one', tSeconds: 0.5 }]),
      totalSeconds: 9.5,
    });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['GITHUB_ACTIONS'] = 'true';
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    // Re-spy and hold the reference, rather than asserting on `console.log`
    // directly — naming it is what trips the no-console lint rule.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stubFetch();

    await main();

    // The `::error::` workflow command is the channel `continue-on-error` does
    // NOT rewrite — the step's own conclusion is reported as `success`.
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^::error::.*MOTIR-811/));
  });

  // ── The artifact-size gate, end to end (MOTIR-1911) ────────────────────────
  //
  // The reproduction: MOTIR-813's recording carried a 113 MB trace beside a 6 MB
  // video, and the whole publish died inside `put` — so the story with a
  // perfectly good clip was the one story of eight with no receipt.

  it('DROPS an over-limit trace and still publishes the video — MOTIR-813’s case', async () => {
    const dir = tmpDir();
    const recording = writeRecording(dir, 'acceptance-cadence-chromium', {
      storyKey: 'MOTIR-813',
      totalSeconds: 96,
    });
    // A trace over the cap; the video (5 bytes of 'clip') stays well under it.
    fs.writeFileSync(path.join(recording, 'trace.zip'), Buffer.alloc(40));
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_MAX_ARTIFACT_BYTES'] = '20';
    process.env['GITHUB_ACTIONS'] = 'true';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const fetchMock = stubFetch();

    await main();

    // The receipt published, and the register call carries NO trace pathname.
    expect(publishedStories(fetchMock)).toEqual(['MOTIR-813']);
    expect(registeredBody(fetchMock).tracePathname).toBeNull();
    // Only the VIDEO reached the object store — the trace was never uploaded.
    expect(putCalls(fetchMock)).toHaveLength(1);
    // Reported as a WARNING, not a failure: the receipt is there, so the run is
    // not broken.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DROPPED'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^::warning::.*MOTIR-813/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('the trace is NOT dropped when the mint reports no cap and the file fits', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    const fetchMock = stubFetch();

    await main();

    expect(putCalls(fetchMock)).toHaveLength(2); // video + trace
    expect(registeredBody(fetchMock).tracePathname).toBe('acceptance/t.zip');
  });

  it('REFUSES an over-limit VIDEO up front — annotated, never uploaded, siblings unaffected', async () => {
    const dir = tmpDir();
    const fat = writeRecording(dir, 'acceptance-fat-chromium', { storyKey: 'MOTIR-811' });
    fs.writeFileSync(path.join(fat, 'video.webm'), Buffer.alloc(40));
    writeRecording(dir, 'acceptance-good-chromium', { storyKey: 'MOTIR-1627' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_MAX_ARTIFACT_BYTES'] = '20';
    process.env['GITHUB_ACTIONS'] = 'true';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const fetchMock = stubFetch();

    await main();

    // The over-limit recording never reached a token mint; its sibling published.
    expect(publishedStories(fetchMock)).toEqual(['MOTIR-1627']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^::error::.*MOTIR-811/));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('TOO LARGE'));
    // Same shape as the watchability verdict: reported, and the step fails.
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('still publishes a legacy recording with no meta sidecar (the guard abstains)', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-legacy-chromium', { storyKey: 'MOTIR-1627' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    const fetchMock = stubFetch();

    await main();

    expect(publishedStories(fetchMock)).toEqual(['MOTIR-1627']);
  });

  it('publishes ALL THREE chaptered recordings, each to its own declared story', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-augment-replan-chromium', { storyKey: 'MOTIR-811' });
    writeRecording(dir, 'acceptance-plan-change-chromium', { storyKey: 'MOTIR-1726' });
    writeRecording(dir, 'acceptance-video-dogfood-chromium', { storyKey: 'MOTIR-1627' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    // A PR ref that would resolve a DIFFERENT story — each recording's own
    // sidecar must win, exactly as it does for a single publish.
    process.env['ACCEPTANCE_PR_REF'] = 'subtask/MOTIR-1733-acceptance-e2e';
    const fetchMock = stubFetch();

    await main();

    expect(publishedStories(fetchMock)).toEqual(['MOTIR-811', 'MOTIR-1726', 'MOTIR-1627']);
    // Video + trace per recording — the exact bug's blast radius was that only
    // one clip ever reached the object store.
    expect(putCalls(fetchMock)).toHaveLength(6);
  });

  it('a failing publish does not cost the other recordings theirs — and the run exits non-zero', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'aaa-chromium', { storyKey: 'MOTIR-811' });
    writeRecording(dir, 'bbb-chromium', { storyKey: 'MOTIR-1726' });
    writeRecording(dir, 'ccc-chromium', { storyKey: 'MOTIR-1627' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const fetchMock = stubFetch((storyKey) =>
      storyKey === 'MOTIR-1726' ? { ok: false, status: 500 } : { ok: true },
    );

    await main();

    // All three were ATTEMPTED; the middle one failed.
    expect(publishedStories(fetchMock)).toEqual(['MOTIR-811', 'MOTIR-1726', 'MOTIR-1627']);
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MOTIR-1726'));
  });

  it('publishes nothing when the run recorded no video (a red run)', async () => {
    process.env['ACCEPTANCE_OUTPUT_DIR'] = tmpDir();
    const fetchMock = stubFetch();
    await main();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an un-chaptered suite still publishes one recording, via the PR-derived story', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'plain-test-chromium', { chapters: null });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_PR_REF'] = 'subtask/MOTIR-816-importer';
    const fetchMock = stubFetch();

    await main();

    expect(publishedStories(fetchMock)).toEqual(['MOTIR-816']);
  });

  it('with neither OIDC nor a PAT (a fork PR) it publishes nothing, exits 0 and says why', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-1726' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    delete process.env['MOTIR_PUBLISH_TOKEN'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = stubFetch();

    await main();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join('\n');
    // The reason is NAMED: a silent no-op reads exactly like a publish that worked.
    expect(out).toContain('Not publishing: no GitHub OIDC token');
    expect(out).toContain('fork');
  });

  // ── producedByKey on the wire (MOTIR-7253) ──────────────────────────────────
  it('registers the PR ref’s card key as producedByKey', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-7250' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_PR_REF'] = 'subtask/MOTIR-7253-restore';
    process.env['ACCEPTANCE_PR_TITLE'] = 'MOTIR-1 unrelated';
    const fetchMock = stubFetch();

    await main();

    expect(registeredBody(fetchMock as never)['producedByKey']).toBe('MOTIR-7253');
  });

  it('registers the PR title’s card key when the ref carries none', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-7250' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_PR_REF'] = 'motir/auto-cmuq3q7kj002ihwoia';
    process.env['ACCEPTANCE_PR_TITLE'] = 'MOTIR-7254 stand the agent down';
    const fetchMock = stubFetch();

    await main();

    expect(registeredBody(fetchMock as never)['producedByKey']).toBe('MOTIR-7254');
  });

  it('registers the story key when the PR names no card', async () => {
    const dir = tmpDir();
    writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-7250' });
    process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
    process.env['ACCEPTANCE_PR_REF'] = 'fix-things';
    const fetchMock = stubFetch();

    await main();

    expect(registeredBody(fetchMock as never)['producedByKey']).toBe('MOTIR-7250');
  });

  // ── A run publishes only the specs it OWNS (MOTIR-1937) ──────────────────
  //
  // The bug: publishing supersedes, and each recording targets its OWN declared
  // story, so any code PR replaced the receipts of every story with a chaptered
  // spec. The gate is OWNERSHIP, not the branch — the acceptance panel's approve
  // edge is `in_review → done` and `in_review` is the PR-OPEN state, so a story's
  // receipt has to be published FROM its own PR or the reviewer can never
  // watch-then-approve.

  describe('the ownership gate', () => {
    it('publishes NOTHING for a PR that changed no acceptance spec — the seven-story case', async () => {
      const dir = tmpDir();
      // Exactly the MOTIR-1781 shape: a backend PR whose lane still recorded
      // three specs, none of which it touched.
      writeRecording(dir, 'acceptance-augment-replan-chromium', {
        storyKey: 'MOTIR-811',
        owned: false,
      });
      writeRecording(dir, 'acceptance-plan-change-chromium', {
        storyKey: 'MOTIR-1726',
        owned: false,
      });
      writeRecording(dir, 'acceptance-video-dogfood-chromium', {
        storyKey: 'MOTIR-1627',
        owned: false,
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['ACCEPTANCE_PR_REF'] = 'subtask/MOTIR-1781-repo-creation-primitive';
      const fetchMock = stubFetch();

      await main();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('publishes ONLY the story whose spec this PR changed, not its siblings', async () => {
      // The story acceptance-E2E PR: it owns one spec, and the other two
      // recordings in the lane must be left exactly as they are.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
      writeRecording(dir, 'acceptance-plan-change-chromium', {
        storyKey: 'MOTIR-1726',
        owned: false,
      });
      writeRecording(dir, 'acceptance-video-dogfood-chromium', {
        storyKey: 'MOTIR-1627',
        owned: false,
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const fetchMock = stubFetch();

      await main();

      expect(publishedStories(fetchMock)).toEqual(['MOTIR-813']);
    });

    it('FAILS CLOSED — an unset owned-set publishes nothing', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-1627', owned: false });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      delete process.env['ACCEPTANCE_CHANGED_SPECS'];
      const fetchMock = stubFetch();

      await main();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does NOT own a recording whose sidecar predates the specFile field', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-legacy-chromium', {
        storyKey: 'MOTIR-1627',
        specFile: null,
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['ACCEPTANCE_CHANGED_SPECS'] = 'tests/e2e/acceptance-legacy-chromium.spec.ts';
      const fetchMock = stubFetch();

      await main();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still RESOLVES and REPORTS an un-owned recording — the checks a PR pays for', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-a-chromium', { storyKey: 'MOTIR-811', owned: false });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubFetch();

      await main();

      const logged = logSpy.mock.calls.flat().join('\n');
      expect(logged).toContain('MOTIR-811');
      expect(logged).toContain('rehearsed');
    });

    it('REPORTS an unwatchable clip it does not own, and does NOT fail on it (MOTIR-2499)', async () => {
      // The verdict MOTIR-1905 got right and MOTIR-2499 had to re-scope. Failing
      // on ANY unwatchable clip cost nothing while the step ran under
      // `continue-on-error` and could not go red whatever it returned. Now that
      // it can, the same rule would red-light every acceptance PR over a spec it
      // never touched — MOTIR-2268's 14.5s clip sat in the lane's recordings for
      // days. A run answers for the specs it CHANGED; the rest it rehearses.
      //
      // Still assessed, still annotated, still counted — just not fatal here.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-raced-chromium', {
        storyKey: 'MOTIR-811',
        owned: false,
        chapters: JSON.stringify([
          { label: 'one', tSeconds: 0.5 },
          { label: 'two', tSeconds: 3.0 },
        ]),
        totalSeconds: 9.5,
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['GITHUB_ACTIONS'] = 'true';
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fetchMock = stubFetch();

      await main();

      expect(exit).not.toHaveBeenCalled();
      // A `warning`, not an `error`: the annotation's level now tracks whether
      // the run fails on it, so an `::error::` beside a green step cannot recur.
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('::warning::Unwatchable acceptance video for MOTIR-811'),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('FAILS on an unwatchable clip it DOES own — its own story lost its receipt', async () => {
      // The other arm of the same rule: this PR changed the spec, so this PR's
      // author is the one who can pace it, and this PR's lane is where it bites.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-raced-chromium', {
        storyKey: 'MOTIR-811',
        chapters: JSON.stringify([{ label: 'one', tSeconds: 0.5 }]),
        totalSeconds: 9.5,
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['GITHUB_ACTIONS'] = 'true';
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubFetch();

      await main();

      expect(exit).toHaveBeenCalledWith(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('::error::Unwatchable acceptance video for MOTIR-811'),
      );
    });

    it('counts a rehearsed unpublishable recording SEPARATELY from a failure (MOTIR-2499)', async () => {
      // "2 publish failure(s) and 1 unpublishable recording(s)" pooled the two
      // verdicts into one number, so the log could not say whose defect either
      // was. They are now counted apart, and the rehearsed count is stated as
      // not fatal.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-mine-chromium', { storyKey: 'MOTIR-2258' });
      writeRecording(dir, 'acceptance-theirs-chromium', {
        storyKey: 'MOTIR-2268',
        owned: false,
        totalSeconds: 14.5, // the real clip, under the 15s floor
      });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fetchMock = stubFetch();

      await main();

      expect(publishedStories(fetchMock)).toEqual(['MOTIR-2258']);
      expect(exit).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        '1 unpublishable recording(s) belong to specs this run does not own',
      );
    });

    it('needs no credential when it owns nothing', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-chromium', { storyKey: 'MOTIR-1627', owned: false });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      delete process.env['MOTIR_PUBLISH_TOKEN'];
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      await main();

      expect(exit).not.toHaveBeenCalled();
    });
  });

  // ── EVERY RECEIPT STILL PUBLISHES, EXACTLY ONCE, ACROSS SHARDS (MOTIR-2600) ─
  //
  // The lane stopped being one serial job: `.github/workflows/acceptance-tests.yml`
  // now runs `--shard=i/4` on four legs, each with its OWN
  // `out/playwright-output-acceptance` and its OWN publish step. Sharding reads
  // like a config change and is not — the receipts are this lane's product, and
  // the publish step has already been the source of two separate defects
  // (MOTIR-1734: one clip per run; MOTIR-1937: every PR republishing unrelated
  // stories). Splitting the job N ways means each leg holds a DIFFERENT subset of
  // the videos, so the invariant has to hold ACROSS legs and not merely within
  // one.
  //
  // It is asserted here, against the uploader, rather than by reading a run:
  // there is nothing to eyeball until a multi-story PR happens to be sharded the
  // wrong way, which is exactly how MOTIR-1734 stayed invisible.
  //
  // Each leg is one `main()` over its own output dir, sharing ONE
  // `ACCEPTANCE_CHANGED_SPECS` (the diff is the same on every leg — it is the
  // recordings that differ).
  describe('across shards', () => {
    /** Run the publish step for one leg, over `dir`, and return the stories it
     *  registered. The env is the same on every leg by construction — only the
     *  output dir changes, which is the whole point. */
    async function publishLeg(dir: string): Promise<string[]> {
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const fetchMock = stubFetch();
      await main();
      const stories = publishedStories(fetchMock);
      vi.unstubAllGlobals();
      return stories;
    }

    it('two legs each recording one owned spec publish one receipt each — never both, never twice', async () => {
      // The card's own case: "including the case where two shards each record
      // one". A PR changing two acceptance specs, and `--shard` putting them on
      // different legs.
      const shard1 = tmpDir();
      const shard2 = tmpDir();
      writeRecording(shard1, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
      writeRecording(shard2, 'acceptance-plan-change-chromium', { storyKey: 'MOTIR-1726' });

      const first = await publishLeg(shard1);
      const second = await publishLeg(shard2);

      expect(first).toEqual(['MOTIR-813']);
      expect(second).toEqual(['MOTIR-1726']);
      // The union is the whole set, and no story appears twice — the property
      // the pre-shard lane got for free from running everything in one job.
      const all = [...first, ...second];
      expect(all.sort()).toEqual(['MOTIR-1726', 'MOTIR-813']);
      expect(new Set(all).size).toBe(all.length);
    });

    it('a leg that recorded NONE of the changed specs publishes nothing and does not fail', async () => {
      // THE hazard sharding introduces. Ownership is a property of the RUN's
      // diff, so every leg is told the same owned set — but only the leg that
      // actually ran a spec holds its recording. If "I own a spec I did not
      // record" were fatal, three legs out of four would red-light the lane on a
      // single-spec PR, which is the ordinary case.
      const owning = tmpDir();
      const other = tmpDir();
      writeRecording(owning, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
      // This leg ran a DIFFERENT spec, which this PR did not change.
      writeRecording(other, 'acceptance-video-dogfood-chromium', {
        storyKey: 'MOTIR-1627',
        owned: false,
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      const otherStories = await publishLeg(other);
      const owningStories = await publishLeg(owning);

      expect(otherStories).toEqual([]);
      expect(owningStories).toEqual(['MOTIR-813']);
      expect(exit).not.toHaveBeenCalled();
    });

    it('an EMPTY leg (its shard recorded nothing at all) is a no-op, not a failure', async () => {
      // A leg can legitimately produce no video: every test on it may be a
      // non-chaptered assertion spec. Before sharding this state only occurred on
      // a red run, where the publish step never ran at all (`if: success()`).
      const empty = tmpDir();
      const recording = tmpDir();
      writeRecording(recording, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      expect(await publishLeg(empty)).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
      // …and the leg that DID record it still publishes, so the empty leg's
      // silence cost the story nothing.
      expect(await publishLeg(recording)).toEqual(['MOTIR-813']);
    });

    it('a story whose spec was NOT changed is left alone on every leg', async () => {
      // MOTIR-1937 across shards: the gate must not weaken just because the
      // recordings are spread out. Each leg sees fewer recordings than before, so
      // a per-RUN ("did this run publish anything?") reading of ownership would
      // now be wrong four times over.
      const shard1 = tmpDir();
      const shard2 = tmpDir();
      writeRecording(shard1, 'acceptance-cadence-chromium', { storyKey: 'MOTIR-813' });
      writeRecording(shard1, 'acceptance-augment-replan-chromium', {
        storyKey: 'MOTIR-811',
        owned: false,
      });
      writeRecording(shard2, 'acceptance-video-dogfood-chromium', {
        storyKey: 'MOTIR-1627',
        owned: false,
      });

      const first = await publishLeg(shard1);
      const second = await publishLeg(shard2);

      expect([...first, ...second]).toEqual(['MOTIR-813']);
    });
  });

  // ── THE STEP CANNOT GO GREEN ON A LOST RECEIPT (MOTIR-2499) ────────────────
  //
  // The fail-open this card exists to close had two halves. The workflow half is
  // asserted in `tests/ci-acceptance-lane.test.ts` (the step no longer runs under
  // `continue-on-error`); this is the script half — the exit code that is now
  // the signal.

  describe('the exit verdict', () => {
    it('THE GUARD CAN ACTUALLY FAIL — one owned recording that fails to publish exits non-zero', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubFetch(() => ({ ok: false, status: 500 }));

      await main();

      expect(exit).toHaveBeenCalledWith(1);
      // The exact line the broken lane printed under a `pass` check.
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        'Published 0 of 1 owned acceptance recording(s)',
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('1 publish failure(s) and 0 unpublishable owned recording(s)'),
      );
    });

    // MOTIR-3409 — the drop must reach the EXIT VERDICT, not just the register
    // call. A refusal-drop loses no RECORDING, so the tally it must not touch is
    // `failed`, and the line MOTIR-3313 insists on keeping must read M of M.
    //
    // A 400 is used rather than a 503 so `putSignedArtifact` breaks on the first
    // attempt: `main` takes the shipped retry defaults (real 500 ms backoff, no
    // injection point), and the behaviour under test is the DROP, which every
    // terminal refusal reaches by the same path.
    it('a trace the store REFUSES does not redden the step — exit 0, and M of M', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['GITHUB_ACTIONS'] = 'true'; // so ciAnnotate actually emits
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const fetchMock = vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
        if (init?.method === 'PUT') {
          return String(url).includes('t.zip')
            ? { ok: false, status: 400, text: async () => 'refused' }
            : { ok: true, status: 200, text: async () => '' };
        }
        if (String(url).endsWith('/upload-token')) {
          return {
            ok: true,
            json: async () => ({
              video: {
                pathname: 'acceptance/v.webm',
                token: signedPutUrl('acceptance/v.webm'),
                contentType: 'video/webm',
              },
              trace: {
                pathname: 'acceptance/t.zip',
                token: signedPutUrl('acceptance/t.zip'),
                contentType: 'application/zip',
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ evidence: { id: 'ev-2258' } }) };
      });
      vi.stubGlobal('fetch', fetchMock);

      await main();

      // The whole point: a debugging aid the store refused is not a failed run.
      expect(exit).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();

      const out = logSpy.mock.calls.flat().join('\n');
      // The line MOTIR-3313 requires to survive — counting RECORDINGS, and none
      // was lost, so it is honest at 1 of 1.
      expect(out).toContain('Published 1 of 1 owned acceptance recording(s)');
      // Loud enough to find, on the channel `continue-on-error` cannot swallow.
      expect(out).toContain('::warning::');
      expect(out).toContain('Acceptance trace refused for MOTIR-2258');
      // Distinguishable in the log from the over-cap drop, which names a size.
      expect(warnSpy.mock.calls.flat().join('\n')).toContain('the store REFUSED it');

      // The receipt landed, without a pathname for a blob that was never written.
      expect(registeredBody(fetchMock)['videoPathname']).toBe('acceptance/v.webm');
      expect(registeredBody(fetchMock)['tracePathname']).toBeNull();
    });

    it('…and the SAME run exits ZERO when every owned recording publishes', async () => {
      // The control arm: the assertion above is only evidence if the guard is
      // capable of passing on the good case.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      stubFetch();

      await main();

      expect(exit).not.toHaveBeenCalled();
    });

    // ── THE CLOSED-STORY SKIP (MOTIR-2768, re-keyed by MOTIR-7253) ──────────
    //
    // The service REFUSES a publish onto a closed story — MOTIR-5872's
    // `ACCEPTANCE_EVIDENCE_STORY_CLOSED`, which replaced MOTIR-2764's
    // approved-receipt code. That refusal arrives here as a non-2xx, and
    // without this branch the leg would go red on a story whose only fault is
    // being finished — a fix that turned a silent data loss into a noisy false
    // failure would have moved the problem rather than solved it.

    const approvedBody = JSON.stringify({
      code: STORY_CLOSED_CODE,
      error: 'MOTIR-2258 is done, so it takes no new acceptance receipt.',
    });

    it('a CLOSED story (409 STORY_CLOSED) is SKIPPED — exit 0, counted apart, and said out loud', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      process.env['GITHUB_ACTIONS'] = 'true'; // so ciAnnotate actually emits
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubFetch(() => ({ ok: false, status: 409, body: approvedBody }));

      await main();

      // Not a failure: the leg stays green.
      expect(exit).not.toHaveBeenCalled();
      const out = logSpy.mock.calls.flat().join('\n');
      // Counted as neither a publish nor a failure — the third tally.
      expect(out).toContain('Published 0 of 1 owned acceptance recording(s)');
      expect(out).toContain('1 skipped — the story is closed and takes no new receipt');
      // Legible to a person reading the run, naming the story and the reason.
      expect(out).toContain('::notice::');
      expect(out).toContain('MOTIR-2258 is closed');
      expect(console.error).not.toHaveBeenCalled();
    });

    it('the counts distinguish published / skipped / failed in ONE run', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-a-chromium', { storyKey: 'MOTIR-1' });
      writeRecording(dir, 'acceptance-b-chromium', { storyKey: 'MOTIR-2' });
      writeRecording(dir, 'acceptance-c-chromium', { storyKey: 'MOTIR-3' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      // `writeRecording` owns each spec by default, so this run owns all three —
      // which is what puts all three outcomes through the same summary line.
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubFetch((storyKey) => {
        if (storyKey === 'MOTIR-2') return { ok: false, status: 409, body: approvedBody };
        if (storyKey === 'MOTIR-3') return { ok: false, status: 500 };
        return { ok: true };
      });

      await main();

      const out = logSpy.mock.calls.flat().join('\n');
      // One published, one skipped, one failed — and the skip inflates neither.
      expect(out).toContain('Published 1 of 3 owned acceptance recording(s)');
      expect(out).toContain('1 skipped');
      // The real failure still fails the run.
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('1 publish failure(s)'));
    });

    it('recognises the refusal by CODE — the same 409 with another code still FAILS', async () => {
      // The status number is shared with unrelated conflicts, so branching on it
      // would silently swallow them. This is the arm that proves it does not.
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      stubFetch(() => ({
        ok: false,
        status: 409,
        body: JSON.stringify({ code: 'SOMETHING_ELSE_ENTIRELY', error: 'nope' }),
      }));

      await main();

      expect(exit).toHaveBeenCalledWith(1);
    });

    it('a non-JSON body at the same status is NOT a skip either', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      stubFetch(() => ({ ok: false, status: 409, body: '<html>gateway</html>' }));

      await main();

      expect(exit).toHaveBeenCalledWith(1);
    });

    it('the recognised code is PINNED to the service error — the two cannot drift', () => {
      // A `.mjs` run by CI cannot import the TS class, so the constant is
      // duplicated by necessity. This is what stops the duplicate from rotting:
      // rename the error's `code` and this fails, naming both sides.
      // ⚠️ VENDORED-COPY DIVERGENCE (MOTIR-2693). Upstream pins this against
      // motir-core's `AcceptanceEvidenceStoryClosedError` class, which this repo
      // does not have. The literal IS the wire contract; upstream's pin keeps the
      // server and the script agreeing, and this one keeps the copy agreeing with
      // upstream.
      expect(STORY_CLOSED_CODE).toBe('ACCEPTANCE_EVIDENCE_STORY_CLOSED');
    });

    // ── The mint CONTRACT check (MOTIR-2499) ────────────────────────────────
    //
    // The actual breakage of 2026-08-07: MOTIR-2389 moved `/upload-token`'s
    // `token` from a client upload token to an S3 presigned PUT URL, and the CI
    // script — which always calls the DEPLOYED production endpoint — shipped
    // ahead of the deployment. `fetch(token)` then failed with "Failed to parse
    // URL from vercel_blob_client_…", which names neither side.
    it('names the DEPLOYMENT when the mint returns the pre-MOTIR-2389 token shape', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const legacyToken = `vercel_blob_client_Wv5V9fWWFsXURacA_${'x'.repeat(600)}`;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: { method?: string }) => {
          if (init?.method === 'PUT') return { ok: true, status: 200, text: async () => '' };
          if (url.endsWith('/upload-token')) {
            return {
              ok: true,
              json: async () => ({
                video: {
                  pathname: 'acceptance/v.webm',
                  token: legacyToken,
                  contentType: 'video/webm',
                },
                trace: {
                  pathname: 'acceptance/t.zip',
                  token: legacyToken,
                  contentType: 'application/zip',
                },
              }),
            };
          }
          return { ok: true, json: async () => ({ evidence: { id: 'ev' } }) };
        }),
      );

      await main();

      expect(exit).toHaveBeenCalledWith(1);
      const reported = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .flat()
        .join('\n');
      expect(reported).toContain('is not a presigned URL');
      expect(reported).toContain('https://app.motir.co');
      expect(reported).toContain('OLDER than this script');
      // The credential is DESCRIBED, never echoed — the old failure printed all
      // ~700 characters of a live upload grant into a public job log, twice.
      expect(reported).not.toContain(legacyToken);
      expect(reported).toMatch(/\d+-character string starting "vercel_blob_client_W…"/);
    });

    it('says so when the mint returns no target at all, instead of PUTting to `undefined`', async () => {
      const dir = tmpDir();
      writeRecording(dir, 'acceptance-permission-gated-ui-chromium', { storyKey: 'MOTIR-2258' });
      process.env['ACCEPTANCE_OUTPUT_DIR'] = dir;
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: { method?: string }) => {
          if (init?.method === 'PUT') return { ok: true, status: 200, text: async () => '' };
          if (url.endsWith('/upload-token')) return { ok: true, json: async () => ({}) };
          return { ok: true, json: async () => ({ evidence: { id: 'ev' } }) };
        }),
      );

      await main();

      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('the video upload target minted by https://app.motir.co'),
      );
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('got nothing'));
    });
  });
});

// ── The spec-OWNERSHIP gate (MOTIR-1937) ────────────────────────────────────

describe('resolveOwnedSpecs', () => {
  it('parses the `git diff --name-only` output shape verbatim', () => {
    expect(
      resolveOwnedSpecs({
        ACCEPTANCE_CHANGED_SPECS:
          'tests/e2e/acceptance-a.spec.ts\ntests/e2e/acceptance-b.spec.ts\n',
      }),
    ).toEqual(new Set(['tests/e2e/acceptance-a.spec.ts', 'tests/e2e/acceptance-b.spec.ts']));
  });

  it('accepts space- and comma-separated lists, and strips a leading ./', () => {
    expect(
      resolveOwnedSpecs({ ACCEPTANCE_CHANGED_SPECS: './a.spec.ts, b.spec.ts  c.spec.ts' }),
    ).toEqual(new Set(['a.spec.ts', 'b.spec.ts', 'c.spec.ts']));
  });

  it.each([
    ['unset', {}],
    ['empty', { ACCEPTANCE_CHANGED_SPECS: '' }],
    ['whitespace only', { ACCEPTANCE_CHANGED_SPECS: '  \n ' }],
  ])('owns NOTHING for %s — the gate fails closed', (_label, env) => {
    expect(resolveOwnedSpecs(env)).toEqual(new Set());
  });
});

describe('isOwnedRecording', () => {
  const owned = new Set(['tests/e2e/acceptance-cadence.spec.ts']);

  it('owns a recording whose spec this run changed', () => {
    expect(isOwnedRecording({ specFile: 'tests/e2e/acceptance-cadence.spec.ts' }, owned)).toBe(
      true,
    );
  });

  it('normalises a leading ./ on the recording side too', () => {
    expect(isOwnedRecording({ specFile: './tests/e2e/acceptance-cadence.spec.ts' }, owned)).toBe(
      true,
    );
  });

  it('does NOT own a sibling spec the run did not touch', () => {
    expect(isOwnedRecording({ specFile: 'tests/e2e/acceptance-cli-connect.spec.ts' }, owned)).toBe(
      false,
    );
  });

  it.each([
    ['a legacy sidecar with no specFile', {}],
    ['a null specFile', { specFile: null }],
    ['an empty specFile', { specFile: '' }],
    ['no meta at all', null],
  ])('does NOT own %s — an unidentifiable recording is never published', (_label, meta) => {
    expect(isOwnedRecording(meta as { specFile?: string | null }, owned)).toBe(false);
  });
});

// ── The watchability guard (MOTIR-1772) ──────────────────────────────────────

/** Chapter markers `n` seconds apart, the shape `chapter()` writes. */
function chaptersEvery(gapSeconds: number, count: number, start = 1) {
  return Array.from({ length: count }, (_, i) => ({
    label: `phase ${i + 1}`,
    tSeconds: start + i * gapSeconds,
  }));
}

describe('assessWatchability (MOTIR-1772)', () => {
  it('passes a paced recording — the MOTIR-921 clip AFTER it was paced', () => {
    const verdict = assessWatchability({
      chapters: [
        { label: 'Turn on auto-planning', tSeconds: 1.8 },
        { label: 'Approve the proposed sprints', tSeconds: 30.6 },
        { label: 'Cadence fires on its own', tSeconds: 51.3 },
        { label: 'Auto-plan pauses for review', tSeconds: 59.7 },
        { label: 'Decide, and cadence resumes', tSeconds: 64.1 },
      ],
      meta: { totalSeconds: 78 },
    });
    expect(verdict.watchable).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('FAILS the exact MOTIR-921 regression — five chapters inside four seconds', () => {
    const verdict = assessWatchability({
      chapters: [
        { label: 'Turn on auto-planning', tSeconds: 1.78 },
        { label: 'Approve the proposed sprints', tSeconds: 2.53 },
        { label: 'Cadence fires on its own', tSeconds: 3.07 },
        { label: 'Auto-plan pauses for review', tSeconds: 3.4 },
        { label: 'Decide, and cadence resumes', tSeconds: 3.73 },
      ],
      meta: { totalSeconds: 5 },
    });
    expect(verdict.watchable).toBe(false);
    // The clip is short AND bunched; the floor is the first thing it trips.
    expect(verdict.reason).toContain('watchable floor');
  });

  it('FAILS a long-enough clip whose chapters are BUNCHED (a paced tail cannot rescue a raced opening)', () => {
    const verdict = assessWatchability({
      chapters: chaptersEvery(0.5, 6),
      meta: { totalSeconds: 40 },
    });
    expect(verdict.watchable).toBe(false);
    expect(verdict.reason).toContain('bunched');
  });

  it('ABSTAINS when there is no recording-meta sidecar (legacy / non-chaptered run)', () => {
    // Absence of evidence is not evidence of a bad clip — this guard must not
    // red-light runs it was never meant to police.
    expect(assessWatchability({ chapters: [], meta: null }).watchable).toBe(true);
    expect(assessWatchability({}).watchable).toBe(true);
  });

  it('passes a single-chapter recording that is simply long — no gaps to judge', () => {
    const verdict = assessWatchability({
      chapters: [{ label: 'only phase', tSeconds: 1 }],
      meta: { totalSeconds: 45 },
    });
    expect(verdict.watchable).toBe(true);
    expect(verdict.medianGapSeconds).toBeNull();
  });

  it('applies a FLOOR and never a ceiling — the ADR withdrew the duration cap', () => {
    const verdict = assessWatchability({
      chapters: chaptersEvery(30, 8),
      meta: { totalSeconds: 600 },
    });
    expect(verdict.watchable).toBe(true);
  });
});

// ── The composite action's MANIFEST (MOTIR-2937) ────────────────────────────
//
// GitHub evaluates template expressions inside an action manifest's own
// `description` scalars, at manifest-conversion time, where the `github`
// context does not exist. A description that DOCUMENTS an input by showing the
// expression a caller should pass therefore stops the action from LOADING —
// `Unrecognized named-value: 'github'`, a `TemplateValidationException`, and a
// step that fails before running any of its own logic.
//
// This is asserted here, in the file that travels with the manifest, for a
// specific reason: NEITHER repo's CI can catch it. motir-core's own lane runs
// `node scripts/upload-acceptance-video.mjs` directly and never `uses:` the
// action, so this manifest is dead code here and is never parsed; the vendored
// copy in `nextjs-prisma-vercel-starter` IS loaded, but that repo owns no
// acceptance spec, so its `paths:`-filtered lane has never fired on a pull
// request. The file passed review twice and was re-synced once under the
// upstream-verbatim contract without a runner ever reading it (MOTIR-2937).
//
// Scoped to every manifest under `.github/actions/`, not just this one: the
// defect is a property of the FILE FORMAT, and the vendored copy carries this
// test into a repo whose action set is its own.

describe('the action manifests carry no template expressions in their descriptions', () => {
  const ACTIONS_DIR = '.github/actions';

  /** An Actions expression opener, built so this file never contains one. */
  const EXPRESSION_OPENER = '$' + '{{';

  function manifestPaths(): string[] {
    const root = path.join(process.cwd(), ACTIONS_DIR);
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name, 'action.yml'))
      .filter((p) => fs.existsSync(p));
  }

  /**
   * Every line that is part of a `description:` value — the key's own line plus
   * the more-indented continuation lines of its block scalar.
   *
   * Deliberately textual rather than YAML-parsed: the manifest is a VENDORED
   * file (docs/acceptance-video.md), and a copy that drags a parser dependency
   * into whichever repo it lands in is a copy that stops being re-copyable.
   */
  function descriptionLines(manifest: string): Array<{ line: number; text: string }> {
    const out: Array<{ line: number; text: string }> = [];
    let openIndent: number | null = null;
    manifest.split('\n').forEach((raw, i) => {
      const opener = /^(\s*)description:(.*)$/.exec(raw);
      if (opener) {
        openIndent = opener[1]!.length;
        out.push({ line: i + 1, text: opener[2]! });
        return;
      }
      if (openIndent === null) return;
      if (raw.trim() === '') return; // a blank line does not close a block scalar
      const indent = raw.length - raw.trimStart().length;
      if (indent > openIndent) {
        out.push({ line: i + 1, text: raw });
        return;
      }
      openIndent = null;
    });
    return out;
  }

  it('finds the manifests it is meant to police', () => {
    // A guard that silently scans nothing reads exactly like a guard that
    // passes. `.github/actions` holds at least this action in either repo.
    expect(manifestPaths().length).toBeGreaterThan(0);
  });

  it.each(manifestPaths().map((p) => [path.relative(process.cwd(), p), p]))(
    '%s: no description scalar opens a template expression',
    (rel, absolute) => {
      const offenders = descriptionLines(fs.readFileSync(absolute, 'utf8')).filter((l) =>
        l.text.includes(EXPRESSION_OPENER),
      );
      expect(
        offenders.map((o) => `${rel}:${o.line}:${o.text.trim()}`),
        'GitHub evaluates expressions in a manifest description — the action then fails ' +
          'template validation and never loads (MOTIR-2937). Name the context value in prose.',
      ).toEqual([]);
    },
  );

  it('still tells a caller WHAT to pass for the two PR inputs', () => {
    // The fix must not have been "delete the guidance". The descriptions name
    // the same two context values, without the delimiters that break the load.
    const manifest = fs.readFileSync(
      path.join(process.cwd(), ACTIONS_DIR, 'upload-acceptance-video/action.yml'),
      'utf8',
    );
    const described = descriptionLines(manifest)
      .map((l) => l.text)
      .join('\n');
    expect(described).toContain('github.head_ref');
    expect(described).toContain('github.event.pull_request.title');
  });

  it('reads a block scalar as part of its description, and stops at the next key', () => {
    // The extractor is the load-bearing half — a version that only looked at
    // the `description:` LINE would have passed the file this card was filed
    // about, where both expressions sit on a continuation line.
    const sample = [
      'inputs:',
      '  a:',
      '    description: >',
      '      first continuation',
      '',
      '      second continuation',
      '    required: false',
      '    default: not-a-description',
      '  b:',
      '    description: inline value',
      'runs:',
      '  using: composite',
    ].join('\n');
    expect(descriptionLines(sample).map((l) => l.text.trim())).toEqual([
      '>',
      'first continuation',
      'second continuation',
      'inline value',
    ]);
  });
});
