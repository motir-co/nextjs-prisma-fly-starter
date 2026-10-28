// ⚠️ VENDORED FROM `motir-core` (MOTIR-1941; restored by MOTIR-7255, Story MOTIR-7250).
// This file is a COPY of motir-core's `scripts/upload-acceptance-video.mjs`. It is
// not a fork: keep it in sync, and fix bugs upstream and re-copy rather than
// patching here. `tests/acceptance-video-uploader.test.ts` is vendored with it so a
// bad sync fails locally.
//
// WHAT IT IS FOR: publishing THIS project's acceptance receipts from its own CI —
// the `Acceptance tests` lane runs it, through `.github/actions/upload-acceptance-video`,
// on a green pull-request run, over keyless GitHub OIDC (a Motir-hosted repository
// is App-connected at creation, so no secret is needed). The record that owns the
// mechanism is motir-core's `docs/decisions/acceptance-video.md`, its 2026-10-01
// amendment ("CI publishes again where the repository's lane carries the
// uploader"); if that amendment is ever reversed, this copy is no longer wanted.
// It was retired here on 2026-09-02 (MOTIR-4097) and restored on 2026-10-01.
//
// SYNC POINT: motir-core `main` @ 9e2afeabdb (2026-10-02, PR #3333, Story MOTIR-7250 —
// the publisher restore MOTIR-7253; byte-identical to its branch head 39ee176ba9,
// which this copy was first taken from), carrying MOTIR-7253's
// `ACCEPTANCE_EVIDENCE_STORY_CLOSED` skip and the PR's card key as `producedByKey`.
// The BODY BELOW IS UPSTREAM VERBATIM — this header is the only local edit,
// deliberately, so the next sync is `diff` and not archaeology (MOTIR-2693).
// Record the new commit here when you re-copy.
//
// Acceptance-video uploader (Story MOTIR-1627 · Subtask MOTIR-1632; keyless auth
// MOTIR-1650) — the BYOK delivery path. After a GREEN acceptance E2E, CI runs
// this to POST the recorded video + trace + chapters to the publish endpoint
// (MOTIR-1631). Auth is KEYLESS GitHub OIDC first (a repo connected via the
// Motir GitHub App needs NO secret — the job's `id-token: write` OIDC identity
// resolves the workspace), falling back to a `MOTIR_PUBLISH_TOKEN` PAT
// (`integration` scope) for an unconnected repo. A FAILING run leaves no video,
// so this is a no-op — a red acceptance E2E publishes nothing.
//
// EVERY chaptered recording in the lane is published, each to its OWN declared
// story (MOTIR-1734). The lane holds one chaptered acceptance spec per
// user-facing story (the planner rule MOTIR-1644 / the per-story support
// MOTIR-1700), so publishing "the" recording used to drop all but one story's
// receipt — silently, on a green run. See `findRecordings`.
//
// Target STORY resolution (MOTIR-1684) — the publish is NO LONGER pinned to the
// MOTIR-1627 dogfood constant. `resolveStoryKey` picks the target in precedence
// order: (1) an explicit ACCEPTANCE_STORY_KEY (library / manual override); (2)
// the RECORDING's self-declared story — the `acceptance-story.json` sidecar the
// acceptance harness writes (authoritative for what the clip DEPICTS, so the
// self-test dogfood is never mis-attributed to an unrelated PR's story); (3) the
// PR's `MOTIR-<id>` parsed from ACCEPTANCE_PR_REF / ACCEPTANCE_PR_TITLE (the
// status-sync convention) — the publish endpoint resolves a subtask key UP to
// its parent story server-side; (4) ACCEPTANCE_FALLBACK_STORY_KEY (the MOTIR-1627
// dogfood, retained as the first instance / fallback).
//
// Env: auth is EITHER a GitHub OIDC token (auto via `id-token: write` —
//      `ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN`) OR MOTIR_PUBLISH_TOKEN (the PAT
//      fallback for a repo with no App connection) — neither present → a named
//      no-op that exits 0;
//      story target: ACCEPTANCE_STORY_KEY (override) / ACCEPTANCE_PR_REF +
//      ACCEPTANCE_PR_TITLE (PR-derived) / ACCEPTANCE_FALLBACK_STORY_KEY;
//      MOTIR_OIDC_AUDIENCE (default motir-acceptance-video),
//      MOTIR_BASE_URL (default https://app.motir.co),
//      ACCEPTANCE_MAX_ARTIFACT_BYTES (the publish target's per-file cap the
//      up-front size gate measures against — default 100 MB, MOTIR-1911),
//      ACCEPTANCE_OUTPUT_DIR (default out/playwright-output-acceptance),
//      plus GitHub's GITHUB_SHA / GITHUB_RUN_ID / … for provenance
//      (`producedByKey` is the PR's own card key — resolveProducedByKey).
//      Also usable as a library: import { findRecordings,
//      parseWorkItemKey, resolveStoryKey, resolveProducedByKey, requestGithubOidcToken,
//      uploadAcceptanceVideo }.

/* eslint-disable no-console -- this is a CLI script; stdout is its interface. */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://app.motir.co';
const DEFAULT_OUTPUT_DIR = 'out/playwright-output-acceptance';
const DEFAULT_OIDC_AUDIENCE = 'motir-acceptance-video';

/**
 * The acceptance SPECS this run is allowed to publish for — the repo-relative
 * paths of the `acceptance*.spec.ts` files the PR actually changed (MOTIR-1937).
 *
 * WHY OWNERSHIP IS THE GATE. Publishing is `supersede`-on-create: a new row for
 * a story retires the prior current one and unlinks its video so the orphan-GC
 * reclaims it (`acceptanceEvidenceService`). And the target story comes from the
 * RECORDING's own sidecar, which outranks the PR ref ({@link resolveStoryKey}) —
 * so every recording resolves to ITS OWN story no matter whose branch ran the
 * lane. With a CI lane gated only on a branch-name prefix, any ordinary code PR
 * therefore replaced the receipts of every story that has a chaptered spec:
 * measured on the MOTIR-1781 PR (run 30651989797), which republished seven
 * already-accepted stories with clips nobody watched.
 *
 * WHY NOT JUST GATE ON `main`. Because that breaks the feature. The acceptance
 * panel's approve edge is `in_review → done` (`acceptanceEvidenceService.decide`,
 * which the workflow rejects for a story that is not `in_review`), and
 * `in_review` is the PR-OPEN state — the status sync flips the card to `done` on
 * MERGE. So the receipt has to be published FROM the PR, while the story is in
 * review, or the reviewer never gets to watch-then-approve and the gate is dead.
 * MOTIR-1627 says exactly this: "when MOTIR-1627 is in_review, its acceptance
 * panel shows the video … and the story is accepted by watching its own video".
 *
 * So the right key is not the branch but OWNERSHIP: a run publishes the receipts
 * for the specs it changed, and nothing else. The story's acceptance-E2E PR
 * publishes its own story (during `in_review`, as designed); an unrelated PR
 * changes no acceptance spec, matches no recording, and writes nothing.
 *
 * FAIL-CLOSED. An unset / empty variable yields an EMPTY set, which publishes
 * nothing. A workflow that forgets to pass it rehearses rather than silently
 * superseding production evidence, and a local run can never touch a real story.
 *
 * Accepts newline-, comma- or whitespace-separated paths (`git diff --name-only`
 * output drops in unchanged) and normalises a leading `./`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Set<string>}
 */
export function resolveOwnedSpecs(env = process.env) {
  const raw = env['ACCEPTANCE_CHANGED_SPECS'] ?? '';
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^\.\//, ''))
      .filter(Boolean),
  );
}

/**
 * Whether `recording` was produced by one of the specs this run owns.
 *
 * A recording with NO `specFile` (a legacy sidecar written before MOTIR-1937, or
 * a non-chaptered suite) is NOT owned — the same fail-closed posture: an
 * unidentifiable recording is exactly the case where guessing would resurrect
 * the bug.
 *
 * @param {{ specFile?: string | null }} meta
 * @param {Set<string>} ownedSpecs
 */
export function isOwnedRecording(meta, ownedSpecs) {
  const specFile = meta?.specFile;
  if (typeof specFile !== 'string' || specFile.length === 0) return false;
  return ownedSpecs.has(specFile.replace(/^\.\//, ''));
}

/**
 * Walk a Playwright output dir and locate EVERY recording it produced.
 *
 * One RECORDING is one test's output directory: its `video.webm` plus whatever
 * sidecars sit beside it (`trace.zip`, `chapters.json`, `acceptance-story.json`).
 * Grouping BY DIRECTORY is what makes a video inseparable from its own sidecars
 * — the MOTIR-1680 invariant — and it now holds for N recordings instead of one.
 * (A test's `attachments/` subdir holds hash-suffixed copies and no video, so it
 * never forms a recording of its own.)
 *
 * Which recordings are published:
 *
 *  - If ANY recording carries a `chapters.json`, **every** chaptered recording is
 *    returned, each with its own sidecars. This is the MOTIR-1734 fix: the lane's
 *    `testMatch` is `acceptance*.spec.ts` and the planner rule (MOTIR-1644 /
 *    MOTIR-1700) creates a chaptered acceptance spec per user-facing story, so
 *    "the chaptered one" stopped being singular. Taking only the first —
 *    whichever `fs.readdirSync` happened to yield — published one story's clip
 *    and SILENTLY DROPPED every other, on a green run with no warning. (Observed
 *    on PR #1620: three chaptered specs, MOTIR-811 published, MOTIR-1726's clip
 *    discarded.)
 *  - If NONE carries chapters, a single un-chaptered recording is returned, which
 *    preserves the prior fallback behaviour for a non-chaptered suite (the story
 *    then resolves from the PR ref / the configured fallback).
 *
 * Returns `[]` when the dir is absent or nothing recorded (a red / aborted run) —
 * the caller then publishes nothing.
 */
export function findRecordings(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

  /** @type {Map<string, {dir: string, video: string|null, trace: string|null, chapters: string|null, storyMeta: string|null, recordingMeta: string|null}>} */
  const byDir = new Map();
  for (const file of walk(outputDir)) {
    const dir = path.dirname(file);
    let entry = byDir.get(dir);
    if (!entry) {
      entry = {
        dir,
        video: null,
        trace: null,
        chapters: null,
        storyMeta: null,
        recordingMeta: null,
      };
      byDir.set(dir, entry);
    }
    // First match wins per slot — a directory holds one of each by construction.
    if (file.endsWith('.webm')) entry.video ??= file;
    else if (file.endsWith('trace.zip')) entry.trace ??= file;
    else if (file.endsWith('chapters.json')) entry.chapters ??= file;
    else if (file.endsWith('recording-meta.json')) entry.recordingMeta ??= file;
    else if (file.endsWith('acceptance-story.json')) entry.storyMeta ??= file;
  }

  /** @type {Array<{dir: string, video: string, trace: string|null, chapters: string|null, recordingMeta: string|null, storyKey: string|null}>} */
  const recordings = [];
  // `fs.readdirSync` does not sort, and publish ORDER must not depend on the
  // filesystem — the bug this function exists to fix was a walk-order race.
  for (const entry of [...byDir.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
    // A directory with no video is not a recording (a test's `attachments/`
    // subdir, or the run's own metadata). The local binding also narrows the
    // type, so a recording's `video` is non-nullable to every consumer.
    const video = entry.video;
    if (video === null) continue;
    recordings.push({
      dir: entry.dir,
      video,
      trace: entry.trace,
      chapters: entry.chapters,
      recordingMeta: entry.recordingMeta,
      // The recording's self-declared story (MOTIR-1684). Null when the spec did
      // not declare one (→ the PR-derived / fallback story).
      storyKey: readStoryKey(entry.storyMeta),
    });
  }

  const chaptered = recordings.filter((r) => r.chapters !== null);
  return chaptered.length > 0 ? chaptered : recordings.slice(0, 1);
}

/** Parse the story key from an `acceptance-story.json` sidecar; null if absent
 *  or malformed. */
function readStoryKey(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed.storyKey === 'string' && parsed.storyKey.trim()
      ? parsed.storyKey.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Parse the FIRST `<PREFIX>-<number>` work-item key from a string (a branch ref
 * or PR title — the PR-title status-sync convention, mirroring
 * githubWebhookService.resolveWorkItem's `headRef + title` parse). Null when the
 * text carries no key. Case-insensitive; the key is upper-cased.
 */
export function parseWorkItemKey(text) {
  if (!text) return null;
  const m = /\b[A-Za-z][A-Za-z0-9]*-\d+\b/.exec(String(text));
  return m ? m[0].toUpperCase() : null;
}

/**
 * Resolve the target STORY key for the publish (MOTIR-1684), in precedence:
 *   1. explicit ACCEPTANCE_STORY_KEY (override / library use);
 *   2. `declaredKey` — the recording's self-declared story (the sidecar);
 *   3. the PR's `MOTIR-<id>` (ACCEPTANCE_PR_REF, then ACCEPTANCE_PR_TITLE) — the
 *      endpoint resolves a subtask key to its parent story server-side;
 *   4. ACCEPTANCE_FALLBACK_STORY_KEY (the MOTIR-1627 dogfood fallback).
 * Returns `{ storyKey, source }`; `storyKey` is null when nothing resolves.
 *
 * @param {string | null} [declaredKey]
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ storyKey: string | null, source: string }}
 */
export function resolveStoryKey(declaredKey = null, env = process.env) {
  const explicit = (env['ACCEPTANCE_STORY_KEY'] ?? '').trim();
  if (explicit) return { storyKey: explicit, source: 'explicit' };
  if (declaredKey && String(declaredKey).trim())
    return { storyKey: String(declaredKey).trim(), source: 'recording' };
  const prKey =
    parseWorkItemKey(env['ACCEPTANCE_PR_REF']) ?? parseWorkItemKey(env['ACCEPTANCE_PR_TITLE']);
  if (prKey) return { storyKey: prKey, source: 'pr' };
  const fallback = (env['ACCEPTANCE_FALLBACK_STORY_KEY'] ?? '').trim();
  if (fallback) return { storyKey: fallback, source: 'fallback' };
  return { storyKey: null, source: 'none' };
}

/**
 * The card that PRODUCED a recording — sent as `producedByKey` (MOTIR-7253).
 * It is the PR's own card key (ACCEPTANCE_PR_REF, then ACCEPTANCE_PR_TITLE),
 * falling back to the recording's resolved story key when the PR names none —
 * never a constant. The server treats `commitSha` + `producedByKey` as the
 * publish's idempotency key (`recordFromPathnames`), so an agent that still
 * publishes the same commit over MCP under its card key and this lane collapse
 * to ONE receipt instead of superseding each other. `parseWorkItemKey` accepts
 * any project prefix, so a project generated from the starter resolves too.
 *
 * @param {string | null} storyKey
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function resolveProducedByKey(storyKey, env = process.env) {
  return (
    parseWorkItemKey(env['ACCEPTANCE_PR_REF']) ??
    parseWorkItemKey(env['ACCEPTANCE_PR_TITLE']) ??
    (storyKey ? String(storyKey).trim() || null : null)
  );
}

/**
 * Request a GitHub Actions OIDC token for the keyless publish (MOTIR-1650).
 * GitHub injects `ACTIONS_ID_TOKEN_REQUEST_URL` / `_TOKEN` into a step whose job
 * has `permissions: id-token: write`; we exchange them for a JWT scoped to the
 * Motir audience. Returns null when NOT running under id-token: write (e.g. a
 * fork PR, which GitHub denies OIDC) — the caller then falls back to the PAT.
 */
export async function requestGithubOidcToken(audience = DEFAULT_OIDC_AUDIENCE) {
  const url = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!url || !requestToken) return null;
  const res = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { authorization: `Bearer ${requestToken}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && typeof body.value === 'string' ? body.value : null;
}

/** The auth headers for the publish (keyless OIDC marker + bearer, else PAT). */
function authHeadersFor(oidcToken, token) {
  return oidcToken
    ? { authorization: `Bearer ${oidcToken}`, 'x-motir-auth': 'github-oidc' }
    : { authorization: `Bearer ${token}` };
}

/** Parse the chapters sidecar into an array; a malformed file → no markers. */
function readChapters(file) {
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse the recording-meta sidecar; null when absent or malformed. */
export function readRecordingMeta(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Return the whole sidecar whenever it is an object. It used to be dropped
    // unless it carried a numeric `totalSeconds`, which was fine while duration
    // was its only field — but MOTIR-1937 added `specFile`, and discarding a
    // meta with no duration would make an un-timed recording unownable and so
    // silently unpublishable. `assessWatchability` applies its OWN
    // `typeof meta?.totalSeconds === 'number'` guard and abstains when absent,
    // so the watchability contract is unchanged.
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A clip shorter than this is not a receipt a person can watch. */
export const MIN_WATCHABLE_SECONDS = 15;
/** Chapters closer together than this on the median are "bunched" — the
 *  MOTIR-921 signature was five markers inside four seconds. */
export const MIN_MEDIAN_CHAPTER_GAP_SECONDS = 2;

/**
 * Is this recording WATCHABLE by a human? (MOTIR-1772)
 *
 * A reviewer accepts a Story by watching the clip (Principle #18), so a
 * recording driven at machine speed is a broken acceptance gate, not a cosmetic
 * problem — MOTIR-921 passed while producing a ~5s clip with all five chapters
 * inside the first four seconds. `chapter()` now paces every recording by
 * default, but that still degrades silently if a spec bypasses it, so this is
 * the machine-checked backstop.
 *
 * Two independent ways to fail, because they catch different mistakes: a clip
 * that is simply too SHORT, and one that is long enough overall but whose phases
 * are BUNCHED (a paced tail after an unwatchable opening).
 *
 * Deliberately a FLOOR and never a ceiling — the ADR's duration cap was
 * withdrawn on 2026-07-28. A clip that is getting long means the STORY is too
 * big, which is the planner's call, not a reason to speed up the recording.
 *
 * A recording with no meta sidecar (an older spec, or a non-chaptered one) is
 * NOT failed: absence of evidence is not evidence of a bad clip, and failing it
 * would red-light runs this guard was never meant to police.
 *
 * @param {{ chapters?: Array<{ label?: string, tSeconds?: number }>, meta?: { totalSeconds?: number } | null }} [args]
 * @returns {{ watchable: boolean, reason: string|null, totalSeconds: number|null, medianGapSeconds: number|null }}
 */
export function assessWatchability(args = {}) {
  const { chapters = [], meta = null } = args;
  const totalSeconds = typeof meta?.totalSeconds === 'number' ? meta.totalSeconds : null;

  const offsets = chapters
    .map((c) => (typeof c?.tSeconds === 'number' ? c.tSeconds : null))
    .filter((n) => n !== null)
    .sort((a, b) => a - b);
  const gaps = offsets.slice(1).map((t, i) => t - offsets[i]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGapSeconds =
    sortedGaps.length === 0
      ? null
      : sortedGaps.length % 2 === 1
        ? sortedGaps[(sortedGaps.length - 1) / 2]
        : (sortedGaps[sortedGaps.length / 2 - 1] + sortedGaps[sortedGaps.length / 2]) / 2;

  if (totalSeconds === null) {
    return { watchable: true, reason: null, totalSeconds, medianGapSeconds };
  }
  if (totalSeconds < MIN_WATCHABLE_SECONDS) {
    return {
      watchable: false,
      reason: `the clip is ${totalSeconds.toFixed(1)}s, under the ${MIN_WATCHABLE_SECONDS}s watchable floor`,
      totalSeconds,
      medianGapSeconds,
    };
  }
  if (medianGapSeconds !== null && medianGapSeconds < MIN_MEDIAN_CHAPTER_GAP_SECONDS) {
    return {
      watchable: false,
      reason: `its ${chapters.length} chapters are bunched (median gap ${medianGapSeconds.toFixed(1)}s, under ${MIN_MEDIAN_CHAPTER_GAP_SECONDS}s)`,
      totalSeconds,
      medianGapSeconds,
    };
  }
  return { watchable: true, reason: null, totalSeconds, medianGapSeconds };
}

// ── THE ARTIFACT-SIZE BOUNDARY (MOTIR-1911) ──────────────────────────────────
//
// The publish target caps every uploaded file. That cap is NOT a Vercel Blob
// platform ceiling, as it first looked: it is Motir's OWN per-file entitlement
// (`entitlementsService.resolvePerFileLimitBytes` — 10 MB baseline, 100 MB on a
// cloud `scaled` org), minted into the client upload token as
// `maxBytes`. Before MOTIR-2389 the client SDK rejected an over-size `put`
// itself with an opaque "File is too large…"; the S3 presigned PUT that
// replaced it has no size ceiling at all, so the ceiling is now enforced
// SERVER-side when the register step re-reads the object's real size
// (`recordFromPathnames` → `FileTooLargeError`). Either way the failure lands
// after the story resolved, after the watchability verdict, after the mint.
//
// Measured on run 30579274284 (see the PR body): the CADENCE recording's video
// is a few MB and its TRACE is well over the cap, so MOTIR-813 was the one story
// of eight that lost its receipt — to an artifact that is a debugging aid, not
// the receipt. Hence the policy below, and hence measuring UP FRONT: an
// artifact's size is knowable from `fs.statSync` before any auth, so it belongs
// beside the watchability verdict, reported through the same annotation +
// summary channels `continue-on-error` cannot swallow (MOTIR-1905).

/** The publish target's per-file ceiling, assumed when nothing says otherwise:
 *  the cloud `scaled` tier's `maxUploadBytes` (`lib/services/entitlementsService`),
 *  which is what app.motir.co mints for the moooon workspace. A deployment on a
 *  different tier (the 10 MB baseline off-cloud / on `free`) sets
 *  ACCEPTANCE_MAX_ARTIFACT_BYTES so the up-front gate matches its real cap. */
export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

/** The per-file cap this run measures against. A non-numeric / non-positive
 *  override is IGNORED rather than obeyed — a typo'd env var must not silently
 *  disable the gate or reject every artifact.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolveMaxArtifactBytes(env = process.env) {
  const raw = env['ACCEPTANCE_MAX_ARTIFACT_BYTES'];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_MAX_ARTIFACT_BYTES;
  }
  const parsed = Number(String(raw).trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_ARTIFACT_BYTES;
}

/** Bytes on disk, or null when the file is absent / unreadable (an absent file
 *  is the upload's problem to report, not the size gate's to guess at). */
export function fileSizeBytes(file) {
  if (!file) return null;
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/** Human-readable MB, for annotations a person reads on a run page. */
export function formatBytes(bytes) {
  return bytes === null ? 'unknown' : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Measure a recording's artifacts against the per-file cap (MOTIR-1911).
 *
 * The two artifacts are NOT equal, so they do not fail the same way:
 *
 *  - The VIDEO **is** the receipt (Principle #18 — a Story is accepted by
 *    watching it). An over-cap video is unpublishable, and the recording is
 *    rejected exactly like an unwatchable one: reported, annotated, never
 *    uploaded, and the step exits non-zero.
 *  - The TRACE is a debugging aid. Failing the whole publish over it costs the
 *    story its evidence to save an attachment nobody accepts a story on — which
 *    is precisely what happened to MOTIR-813. So an over-cap trace is DROPPED:
 *    the video publishes, and the drop is reported as a warning.
 *
 * @param {{ video: string, trace?: string|null, maxBytes?: number }} args
 * @returns {{ maxBytes: number, videoBytes: number|null, traceBytes: number|null,
 *             publishable: boolean, reason: string|null, dropTrace: boolean,
 *             dropReason: string|null }}
 */
export function assessArtifactSizes(args) {
  const { video, trace = null, maxBytes = DEFAULT_MAX_ARTIFACT_BYTES } = args;
  const videoBytes = fileSizeBytes(video);
  const traceBytes = fileSizeBytes(trace);

  const videoOver = videoBytes !== null && videoBytes > maxBytes;
  const traceOver = traceBytes !== null && traceBytes > maxBytes;

  return {
    maxBytes,
    videoBytes,
    traceBytes,
    publishable: !videoOver,
    reason: videoOver
      ? `the video is ${formatBytes(videoBytes)}, over the ${formatBytes(maxBytes)} per-file limit`
      : null,
    dropTrace: traceOver,
    dropReason: traceOver
      ? `the trace is ${formatBytes(traceBytes)}, over the ${formatBytes(maxBytes)} per-file limit`
      : null,
  };
}

/** Fail an over-cap artifact by NAME before `put` sees it, so the error says
 *  which file, how big, and against what limit (MOTIR-1911). No-ops when the
 *  mint response carries no `maxBytes`. */
function assertWithinMintedCap(label, file, target) {
  const maxBytes = typeof target?.maxBytes === 'number' ? target.maxBytes : null;
  if (maxBytes === null) return;
  const bytes = fileSizeBytes(file);
  if (bytes === null || bytes <= maxBytes) return;
  throw new Error(
    `the ${label} is ${formatBytes(bytes)}, over the publish target's ${formatBytes(maxBytes)} ` +
      `per-file limit — set ACCEPTANCE_MAX_ARTIFACT_BYTES=${maxBytes} so the size gate catches ` +
      'this before the upload',
  );
}

/**
 * Describe a minted credential WITHOUT echoing it (MOTIR-2499).
 *
 * The job log of a public repo is a public document, and the diagnosis below
 * only needs the token's SHAPE. The failure this replaces printed all ~700
 * characters of a live upload grant into the log, twice per recording.
 */
function describeToken(value) {
  if (typeof value !== 'string') return value === undefined ? 'nothing' : `a ${typeof value}`;
  if (value === '') return 'an empty string';
  return `a ${value.length}-character string starting "${value.slice(0, 20)}…"`;
}

/**
 * Fail a mint response that does not speak this uploader's contract (MOTIR-2499).
 *
 * ⚠️ THIS SCRIPT AND THE SERVER IT CALLS ARE DEPLOYED SEPARATELY. The uploader
 * ships with the PR (CI runs it from the branch); the endpoint it mints against
 * is whatever is deployed at `MOTIR_BASE_URL` — production. So a change to the
 * `/upload-token` wire shape is live on one side before the other, and
 * MOTIR-2389 made exactly such a change: `token` went from a client upload token
 * (handed to an SDK) to an S3 presigned PUT URL (fetched directly).
 *
 * Against a deployment that predates it, `fetch(target.token)` fails with
 * `Failed to parse URL from <the whole credential>` — which reads as a malformed
 * string, names neither side, and hid a three-day production-deploy outage
 * behind a green lane. Checking the shape at the boundary turns it into the
 * sentence a reader can act on.
 */
function assertPresignedTarget(label, target, baseUrl) {
  const token = target?.token;
  if (typeof token === 'string' && /^https?:\/\//i.test(token)) return;
  throw new Error(
    `the ${label} upload target minted by ${baseUrl} is not a presigned URL — got ` +
      `${describeToken(token)}. This uploader PUTs each artifact straight to the URL the mint ` +
      'returns (the S3 presigned-PUT contract, MOTIR-2389); a non-URL token is what the PREVIOUS ' +
      `contract returned, so the deployment at ${baseUrl} is OLDER than this script. Deploy ` +
      'motir-core there — re-running the lane against a stale deployment cannot succeed.',
  );
}

/**
 * The statuses a PUT is RETRIED on (MOTIR-3313).
 *
 * Each one is the store saying *"not now"* rather than *"not ever"*: 408 and 429
 * are explicit back-pressure, and 5xx is the server declining to answer. A
 * signature failure (403), a bad request (400) and a missing grant (404) are
 * NOT here on purpose — retrying those just sends the same doomed bytes again.
 */
const RETRYABLE_PUT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Attempts, and the first backoff step. 4 attempts at 500ms doubling spends at
 *  most 3.5s of a run that already costs six minutes of browser time. */
const PUT_ATTEMPTS = 4;
const PUT_BASE_DELAY_MS = 500;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What is logged in place of the store's request id when the response did not
 * carry one (MOTIR-3565). A LITERAL, so a log line stays parseable either way —
 * `undefined` in the middle of a sentence reads as a bug in the uploader rather
 * than as a header the store chose not to send.
 */
const NO_REQUEST_ID = '(no x-amz-request-id)';

/**
 * The store's own correlation id for ONE PUT, off the RESPONSE (MOTIR-3565).
 *
 * ⚠️ WHY THIS EXISTS, and why it is read on the ACCEPTED path too. MOTIR-3313 is
 * an unexplained 503 on one artifact's PUT, and every route to a cause now runs
 * through the store, which cannot look anything up without ids. This function
 * used not to exist: `putSignedArtifact` returned the instant `res.ok` was true
 * and, on a refusal, kept only `res.status` and the body — so the id was
 * discarded on every attempt, accepted and refused alike.
 *
 * The two ids the incident does hold came out of the error XML (`<RequestId>`),
 * which the uploader logs wholesale as `detail`. That yields exactly one thing:
 * the id of the write that FAILED. What a store-side lookup needs is the
 * CONTRAST — the refused write set against its accepted neighbours, which is the
 * whole shape of this incident (a 45.9 MB refusal between a 2.1 MB and an
 * 89.3 MB success). A 190-PUT probe against Tigris confirmed the header is on
 * EVERY response, successes included; we simply never looked.
 *
 * ⚠️ This asserts NOTHING about why the store refused. It is observability, not
 * a hypothesis — the retry policy above stays exactly as MOTIR-3313 left it.
 *
 * ⚠️ TOTAL BY CONSTRUCTION. A store is free to stop sending the header, and a
 * response object in a test is free to be a bare `{ ok, status }` literal with
 * no `headers` at all — the publish is not free to die on either. Hence the
 * guard clause: `headers` may be absent, and `get` may not be a function, and
 * this must never be the line that takes the lane down.
 *
 * @param {{ headers?: { get?: (name: string) => string | null } }} res
 * @returns {string} the id, or `NO_REQUEST_ID` — never `undefined`.
 */
function putRequestId(res) {
  if (typeof res?.headers?.get !== 'function') return NO_REQUEST_ID;
  return res.headers.get('x-amz-request-id') || NO_REQUEST_ID;
}

/**
 * PUT one artifact to the presigned URL the mint returned (MOTIR-2389), RETRYING
 * a retryable status (MOTIR-3313).
 *
 * ⚠️ `content-type` MUST be sent, and MUST equal the type the server bound at
 * signing time. The grant is an S3 presigned PUT with `content-type` inside
 * `X-Amz-SignedHeaders` (`lib/blob/uploader.ts` → `mintPrivateUploadToken`),
 * deliberately: a presigned PUT carries only the metadata the SIGNER bound, so
 * an unbound type would let an artifact land as `application/octet-stream` and
 * be served as a download instead of a video. The flip side is that a mismatched
 * or missing header is a SIGNATURE failure — hence sending exactly
 * `target.contentType`, never a guess from the filename.
 *
 * ⚠️ WHY THE RETRY EXISTS, and what it is NOT a theory about (MOTIR-3313). This
 * used to be a single PUT whose first non-2xx was fatal, and on motir-core
 * PR #2237 the store answered one artifact's PUT with
 * `503 <Code>SlowDown</Code>` — twice, deterministically, on the same recording.
 * The tests had all passed; the lane went red in the publish, and Story
 * MOTIR-3232 was left holding ONE of its two receipts.
 *
 * The store's reason is NOT established, and this retry deliberately does not
 * claim to know it. What was MEASURED is that the usual suspects are not it: the
 * refused trace was 37.0 MB while a 65.8 MB trace published seconds later in the
 * same job, so it is neither size nor the MOTIR-1911 per-file cap; the publish
 * loop is sequential and the refused recording's own VIDEO had just uploaded
 * fine, so it is not a cold first write. What is defensible without a mechanism
 * is narrower and enough: **503 is by definition retryable, and sending a 37 MB
 * body over the public internet exactly once is not a reliable operation.**
 *
 * A retry cannot fix a store that refuses every attempt — and it should not. What
 * happens then depends on WHICH artifact, and is the caller's decision rather than
 * this function's: it throws either way, and `uploadAcceptanceVideo` catches the
 * TRACE (dropping it, so the receipt still lands — MOTIR-3409) while letting the
 * VIDEO propagate. `Published N of M` counts RECORDINGS and still tells the truth
 * under both.
 *
 * ⚠️ EVERY attempt logs the store's `x-amz-request-id` (MOTIR-3565) — the
 * accepted one as well as the refused, which is the half a store-side lookup
 * needs and the half we were throwing away. See `putRequestId` for why, and for
 * the one thing that must never join it in the log: `target.token` is a live
 * presigned signature and this repository's job logs are public.
 *
 * @param {'video' | 'trace'} label
 * @param {string} filePath
 * @param {{ token: string, contentType: string, pathname: string }} target
 * @param {{ attempts?: number, baseDelayMs?: number, sleep?: (ms: number) => Promise<void> }} [retry]
 *   The knobs exist so the retry is TESTABLE without wall-clock — a test injects
 *   `sleep`. Nothing in the shipped path passes them.
 */
export async function putSignedArtifact(label, filePath, target, retry = {}) {
  const attempts = retry.attempts ?? PUT_ATTEMPTS;
  const baseDelayMs = retry.baseDelayMs ?? PUT_BASE_DELAY_MS;
  const sleep = retry.sleep ?? realSleep;
  // Read ONCE, outside the loop: a retry must send the same bytes, and re-reading
  // a large file per attempt would triple the memory this already spends.
  const body = fs.readFileSync(filePath);

  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(target.token, {
      method: 'PUT',
      headers: { 'content-type': target.contentType },
      body,
    });
    // Read on EVERY attempt, BEFORE branching on `res.ok` — the accepted write's
    // id is the half the incident is missing (MOTIR-3565).
    const requestId = putRequestId(res);
    if (res.ok) {
      // The neighbour ids. Cheap, one line per artifact, and the only reason the
      // next refusal is answerable rather than another round of guessing.
      // ⚠️ NEVER `target.token` — it is a presigned URL carrying a live
      // signature, and this repository's job logs are public. The id and the
      // label are the whole payload.
      console.log(
        `Acceptance ${label} upload accepted — request id ${requestId} ` +
          `(attempt ${attempt} of ${attempts}) — MOTIR-3313.`,
      );
      return;
    }

    const detail = await res.text().catch(() => '');
    last =
      `Acceptance ${label} upload failed: ${res.status} [request id ${requestId}] ${detail}`.trim();
    if (!RETRYABLE_PUT_STATUSES.has(res.status) || attempt === attempts) break;

    // Exponential, with jitter so two artifacts in one job never line their
    // retries up. Announced, because a silent retry turns a store that is
    // struggling into a run that is merely slow — and the next person reading
    // this log should see how hard it was to get the bytes in.
    const delay = baseDelayMs * 2 ** (attempt - 1);
    console.warn(
      `Acceptance ${label} upload got ${res.status} (request id ${requestId}); ` +
        `retrying in ${delay}ms (attempt ${attempt} of ${attempts}) — MOTIR-3313.`,
    );
    await sleep(delay + Math.floor(Math.random() * baseDelayMs));
  }
  throw new Error(last ?? `Acceptance ${label} upload failed`);
}

/**
 * Publish the artifacts DIRECT-TO-BLOB (MOTIR-1681), so a large video never
 * streams through the ~4.5MB serverless request-body cap the old multipart POST
 * hit. Three steps: (1) mint scoped client upload tokens from the endpoint;
 * (2) `put` the video (+ trace) STRAIGHT to the private Blob store with them;
 * (3) POST only the pathnames + chapters as JSON to register the evidence.
 * Throws on any non-2xx. Auth is keyless GitHub OIDC when `oidcToken` is given
 * (the `X-Motir-Auth: github-oidc` marker + the OIDC bearer), else the
 * `integration` PAT `token`.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string | null} [opts.token] - the `integration` PAT (fallback auth)
 * @param {string | null} [opts.oidcToken] - a GitHub OIDC token (keyless auth)
 * @param {string} opts.storyKey
 * @param {{ video: string, trace: string | null, chapters: string | null }} opts.artifacts
 * @param {{ commitSha?: string | null, ciRunUrl?: string | null, producedByKey?: string | null }} [opts.provenance]
 * @param {{ attempts?: number, baseDelayMs?: number, sleep?: (ms: number) => Promise<void> }} [opts.retry]
 *   Forwarded to every artifact PUT. Exists so the retry is testable without
 *   wall-clock; the shipped path passes nothing and takes the defaults.
 */
export async function uploadAcceptanceVideo({
  baseUrl,
  token = null,
  oidcToken = null,
  storyKey,
  artifacts,
  provenance = {},
  retry = {},
}) {
  const base = baseUrl.replace(/\/$/, '');
  const headers = authHeadersFor(oidcToken, token);
  const evidenceUrl = `${base}/api/work-items/${encodeURIComponent(storyKey)}/acceptance-evidence`;

  // 1. Mint scoped client upload tokens (one per artifact).
  const tokenRes = await fetch(`${evidenceUrl}/upload-token`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ hasTrace: Boolean(artifacts.trace) }),
  });
  if (!tokenRes.ok) {
    throw new Error(
      `Acceptance-video token mint failed: ${tokenRes.status} ${await tokenRes.text()}`,
    );
  }
  const targets = await tokenRes.json();

  // The CONTRACT check, before anything is read off the mint (MOTIR-2499): every
  // target this run is about to PUT to must be a presigned URL. A deployment
  // older than this script mints the previous shape, and the failure is far
  // easier to read here than inside `fetch`.
  assertPresignedTarget('video', targets?.video, base);
  if (artifacts.trace && targets?.trace) {
    assertPresignedTarget('trace', targets.trace, base);
  }

  // The AUTHORITATIVE per-file cap, straight from the mint (MOTIR-1911). The
  // gate in `main` measures against a CONFIGURED expectation, because sizes are
  // knowable before auth and that is where the run reports them; this is the
  // server's real number, which is tier-derived and can be lower (10 MB off-cloud
  // / on `free`). Checked here so an over-cap artifact fails with a message that
  // names it, its size and the cap, instead of the register step rejecting the
  // artifact AFTER it has been uploaded in full. `maxBytes` is optional — an
  // older server omits it and the check simply abstains.
  assertWithinMintedCap('video', artifacts.video, targets.video);
  if (artifacts.trace && targets.trace) {
    assertWithinMintedCap('trace', artifacts.trace, targets.trace);
  }

  // 2. Upload the artifacts DIRECTLY to the private bucket with the grants,
  //    retrying a retryable refusal (MOTIR-3313 — see `putSignedArtifact`).
  //
  // The VIDEO is unconditional: it IS the receipt, so a refusal that survives the
  // retry throws and the recording fails. There is nothing to fall back to.
  await putSignedArtifact('video', artifacts.video, targets.video, retry);

  // ⚠️ THE TRACE IS DROPPED ON A TERMINAL REFUSAL, NOT FATAL (MOTIR-3409).
  //
  // MOTIR-1911 already decided this for a trace that is too BIG: it is dropped,
  // the video publishes without it, and the drop is a warning. That rule was
  // written on the SIZE axis and stopped there — on the REFUSAL axis the throw
  // from `putSignedArtifact` propagated past the register POST below, so no
  // evidence row was written at all and a video that had uploaded seconds
  // earlier was orphaned in the store. One artifact, two failure modes, opposite
  // outcomes; MOTIR-3313 is what that cost (a story left holding one of its two
  // receipts). This is the same rule on the axis it was never applied to, per
  // `docs/decisions/acceptance-video.md` § Amendment 2026-08-23.
  //
  // What is NOT softened: a lost RECORDING still fails the step, and the
  // `Published N of M` line still counts RECORDINGS. Under this branch nothing
  // is lost — the receipt lands — so there is nothing for it to report short.
  let traceDropped = null;
  if (artifacts.trace && targets.trace) {
    try {
      await putSignedArtifact('trace', artifacts.trace, targets.trace, retry);
    } catch (err) {
      traceDropped = err?.message ?? String(err);
    }
  }
  const tracePublished = Boolean(artifacts.trace && targets.trace) && traceDropped === null;

  // 3. Register the pathnames (small JSON — the bytes are already in Blob).
  const res = await fetch(evidenceUrl, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      videoPathname: targets.video.pathname,
      // Register the trace pathname only when a trace was actually UPLOADED to
      // it. A pathname registered for a blob that was never put would make the
      // evidence row point at nothing — `artifacts.trace` is null whenever the
      // caller dropped an over-cap trace (MOTIR-1911), and `traceDropped` covers
      // the one the store refused (MOTIR-3409). `tracePublished` is exactly the
      // condition under which the `put` above actually succeeded.
      tracePathname: tracePublished ? targets.trace.pathname : null,
      chapters: readChapters(artifacts.chapters),
      commitSha: provenance.commitSha ?? null,
      ciRunUrl: provenance.ciRunUrl ?? null,
      producedByKey: provenance.producedByKey ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // THE CLOSED-STORY SKIP (MOTIR-2768, re-keyed by MOTIR-7253). The service
    // refuses a publish onto a CLOSED story — done, or standing on an approved
    // receipt while its pull request is open (MOTIR-5872's
    // `ACCEPTANCE_EVIDENCE_STORY_CLOSED`) — and there is nothing left for this
    // run to write. That is an ORDINARY
    // OUTCOME, not a failure: once the backlog of accepted stories is larger than
    // the handful in flight it is the commonest response this loop sees, and
    // reddening the lane for it would train everyone to ignore its red — the same
    // trust erosion MOTIR-2499 spent a card removing from the other direction.
    //
    // Branch on the `code`, never on the status number or a message substring: a
    // 409 is shared with unrelated conflicts and a message is not a contract.
    // `tests/acceptance-video-uploader.test.ts` pins this constant against
    // `lib/acceptanceEvidence/errors.ts`, so the two cannot drift.
    //
    // ⚠️ The uploader does NOT decide this. It never reads the story's status and
    // never skips pre-emptively: that would put the freeze rule in a second place
    // where it can drift, and it would still race an approval landing mid-run.
    // The service is asked; the service decides; this branch handles the answer.
    if (parseErrorCode(body) === STORY_CLOSED_CODE) {
      return { skipped: true, reason: 'the story is closed and takes no new receipt' };
    }
    throw new Error(`Acceptance-video publish failed: ${res.status} ${body}`);
  }
  const payload = await res.json();
  // Surface the drop to the caller so `main` can report it through the same
  // warning channels the over-cap drop uses. Returned rather than logged here:
  // this function does not know the story key, and reporting lives where the
  // per-recording context is (MOTIR-3409).
  return traceDropped === null ? payload : { ...payload, traceDropped };
}

/** The typed refusal this client recognises — pinned to
 *  `lib/acceptanceEvidence/errors.ts`'s `AcceptanceEvidenceStoryClosedError`
 *  by a drift test, because a `.mjs` run by CI cannot import the TS class.
 *  MOTIR-5872 replaced the older approved-receipt code with this one: the
 *  service now refuses a story that is CLOSED (done, or standing on an approved
 *  receipt while its pull request is open), not every story ever approved. */
export const STORY_CLOSED_CODE = 'ACCEPTANCE_EVIDENCE_STORY_CLOSED';

/** The `code` out of an error envelope, or null when the body is not one. Never
 *  throws and never returns the body — a response body can carry detail we do
 *  not want in a public log. */
function parseErrorCode(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

function ciRunUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : null;
}

// ── CI VISIBILITY (MOTIR-1905) ───────────────────────────────────────────────
//
// The publish step runs under `continue-on-error: true` so a side-effect can
// never gate a merge — the right call, with one consequence nobody priced in:
// GitHub rewrites the step's `conclusion` to `success`, so `gh pr checks`, the
// checks UI, AND the REST API all report green even on exit 1. The raw job log
// was the only witness, which is how a completely broken acceptance gate went
// unnoticed from the day the watchability floor shipped.
//
// So the script reports through the two channels `continue-on-error` does NOT
// swallow: a workflow ANNOTATION (surfaced on the run and the PR's Files tab)
// and the job SUMMARY (rendered on the run page). Both are no-ops off CI.

/** Emit a GitHub workflow annotation. Newlines are escaped — a raw one would
 *  truncate the command and swallow the rest of the message. */
function ciAnnotate(level, message) {
  if (!process.env['GITHUB_ACTIONS']) return;
  const escaped = String(message).replace(/\r?\n/g, '%0A');
  console.log(`::${level}::${escaped}`);
}

/** Append one Markdown line to the job summary (best-effort — a summary that
 *  cannot be written must never be the reason a publish run fails). */
function ciSummary(line) {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (!file) return;
  try {
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // Ignore: reporting is not the job.
  }
}

/**
 * Discover every recording, resolve each one's story, and publish them all.
 *
 * Exported so the ORCHESTRATION is unit-testable, not just its parts: the
 * MOTIR-1734 bug lived precisely here — `findArtifacts` and
 * `uploadAcceptanceVideo` were both well covered and both correct, while the
 * single-publish loop between them dropped every story but one.
 */
export async function main() {
  const baseUrl = process.env['MOTIR_BASE_URL'] ?? DEFAULT_BASE_URL;
  const outputDir = process.env['ACCEPTANCE_OUTPUT_DIR'] ?? DEFAULT_OUTPUT_DIR;
  const audience = process.env['MOTIR_OIDC_AUDIENCE'] ?? DEFAULT_OIDC_AUDIENCE;

  // Find the recordings FIRST (a red run / recording-off publishes nothing) —
  // each may self-declare its story, which outranks the PR-derived target.
  const recordings = findRecordings(outputDir);
  if (recordings.length === 0) {
    console.log(
      `No acceptance video under ${outputDir} — red run or recording off; nothing to publish.`,
    );
    return;
  }

  // Resolve EVERY target before authenticating, so a misconfigured run fails
  // loudly and up front instead of half-publishing (MOTIR-1684 precedence, per
  // recording: sidecar → PR `MOTIR-<id>` → fallback; explicit env outranks all).
  const targets = recordings.map((recording) => ({
    recording,
    ...resolveStoryKey(recording.storyKey),
  }));
  const unresolved = targets.filter((t) => !t.storyKey);
  if (unresolved.length > 0) {
    console.error(
      `No target story resolved for ${unresolved.length} recording(s) (${unresolved
        .map((t) => path.basename(t.recording.dir))
        .join(
          ', ',
        )}) — set ACCEPTANCE_STORY_KEY, a self-declared recording story, ACCEPTANCE_PR_REF/ACCEPTANCE_PR_TITLE, or ACCEPTANCE_FALLBACK_STORY_KEY.`,
    );
    process.exit(1);
  }

  // WATCHABILITY + ARTIFACT-SIZE GATES (MOTIR-1772 / MOTIR-1911) — both assessed
  // before any auth or upload, so an unwatchable receipt never lands a clip
  // nobody can review, and an over-cap artifact is a REPORTED verdict rather
  // than an exception thrown from inside `put` after the token was minted.
  //
  // PER-RECORDING, NOT ALL-OR-NOTHING (MOTIR-1905). This gate used to
  // `process.exit(1)` on the FIRST unwatchable clip, before publishing anything —
  // so one unpaced spec suppressed EVERY story's receipt in the lane. That is what
  // happened: `acceptance-augment-replan` recorded ~9.5s, and from the day the
  // floor shipped no story got a video, on `main` or on any PR, while the step
  // reported success behind `continue-on-error`.
  //
  // The blast radius is now one story, which is the ONLY story whose evidence is
  // actually in question — and it matches the policy the publish loop below has
  // always used for a failed upload: report it, keep going for the others, and
  // exit non-zero at the end so the run is never silently green. The gate is not
  // weakened: an unwatchable clip is still never published, and the step still
  // fails.
  ciSummary('### Acceptance videos\n');
  const maxArtifactBytes = resolveMaxArtifactBytes();
  // OWNERSHIP (MOTIR-1937) is resolved HERE, ahead of the verdicts, because
  // MOTIR-2499 made it decide more than what gets WRITTEN — it now decides what
  // this run FAILS on. See the exit verdict at the bottom of this function.
  const ownedSpecs = resolveOwnedSpecs();
  const assessed = targets.map((t) => {
    // Read the meta ONCE — the watchability verdict and the MOTIR-1937 ownership
    // gate both key off it (`totalSeconds` and `specFile` respectively).
    const meta = readRecordingMeta(t.recording.recordingMeta);
    return {
      ...t,
      meta,
      owned: isOwnedRecording(meta, ownedSpecs),
      verdict: assessWatchability({ chapters: readChapters(t.recording.chapters), meta }),
      sizes: assessArtifactSizes({
        video: t.recording.video,
        trace: t.recording.trace,
        maxBytes: maxArtifactBytes,
      }),
    };
  });
  // Two independent ways to be REJECTED, reported separately because they tell
  // the author to do different things — but pooled here, because the downstream
  // handling is identical: not published and annotated.
  const rejected = assessed.filter((t) => !t.verdict.watchable || !t.sizes.publishable);
  const publishable = assessed.filter((t) => t.verdict.watchable && t.sizes.publishable);
  // ── WHOSE DEFECT IS IT? (MOTIR-2499) ──────────────────────────────────────
  //
  // An UNPUBLISHABLE recording is a different verdict from a publish FAILURE,
  // and since MOTIR-2499 the two are counted apart and exit apart.
  //
  // MOTIR-1905 failed the run on ANY unwatchable clip, owned or not, reasoning
  // that pacing is a defect whoever is looking at the run can fix. That was
  // free advice while the step ran under `continue-on-error` and could not go
  // red whatever it returned. Now that it CAN (the step's `continue-on-error`
  // was removed with this change, so a lost receipt is finally visible), the
  // same rule would red-light every acceptance PR for a defect in a spec it
  // never touched — measured: MOTIR-2268's 14.5s clip sat in the lane's
  // recordings for days, so every owner of any other spec would have inherited
  // it. A run is answerable for the specs it CHANGED; the rest it rehearses.
  //
  // So: an unpublishable OWNED recording is fatal (this PR's own story just lost
  // its receipt, and this PR's author can fix it), an unpublishable REHEARSED
  // one is reported, annotated as a warning, and counted separately.
  const rejectedOwned = rejected.filter((t) => t.owned);
  const rejectedRehearsed = rejected.filter((t) => !t.owned);

  for (const { storyKey, recording, verdict, sizes, owned: isOwned } of rejected) {
    const consequence = isOwned
      ? 'This run OWNS its spec, so the step fails.'
      : 'This run does not own its spec — it is reported here and counted separately, and the ' +
        'PR that changes that spec is the one it fails.';
    const message = !verdict.watchable
      ? `Acceptance video for ${storyKey} (${path.basename(recording.dir)}) is NOT watchable: ${verdict.reason}. ` +
        `It was NOT published; the other recordings in this run were unaffected. ${consequence} ` +
        'Pace the recorded happy path: wrap each phase in `chapter(...)` (which paces itself) and ' +
        '`await beat()` after each user-visible action, both in tests/e2e/_helpers/acceptance-video.ts. ' +
        'Do NOT fix this by lowering the floor.'
      : `Acceptance video for ${storyKey} (${path.basename(recording.dir)}) is TOO LARGE to publish: ${sizes.reason}. ` +
        `It was NOT published; the other recordings in this run were unaffected. ${consequence} ` +
        'The VIDEO is the receipt, so it cannot simply be dropped: record this lane at a lower ' +
        'resolution or bitrate (playwright.acceptance.config.ts `video.size`), or split the story. ' +
        'Do NOT fix this by shortening the clip below the watchability floor.';
    console.error(message);
    // A CI ANNOTATION, so the verdict is visible on the run without opening the
    // raw job log (MOTIR-1905). Its LEVEL now tracks the consequence: `error`
    // for a defect this run fails on, `warning` for one it is only reporting —
    // an `::error::` beside a green step is the ambiguity MOTIR-2499 removes.
    ciAnnotate(
      isOwned ? 'error' : 'warning',
      !verdict.watchable
        ? `Unwatchable acceptance video for ${storyKey}: ${verdict.reason}`
        : `Over-limit acceptance video for ${storyKey}: ${sizes.reason}`,
    );
    ciSummary(
      `- ${isOwned ? '❌' : '⚠️'} **${storyKey}** — not published: ` +
        `${!verdict.watchable ? verdict.reason : sizes.reason}`,
    );
  }

  if (publishable.length === 0) {
    console.error('No publishable acceptance recording in this run — nothing to publish.');
    // Only the OWNED ones are this run's to answer for (see above); a lane whose
    // single unpublishable clip belongs to another PR's spec stays green.
    if (rejectedOwned.length > 0) process.exit(1);
    return;
  }

  console.log(`Acceptance publish targets (${publishable.length}):`);
  for (const { recording, storyKey, source } of publishable) {
    console.log(`  ${path.basename(recording.dir)} → ${storyKey} (resolved via ${source}).`);
  }
  // Two recordings CAN legitimately target the same story (two chaptered tests in
  // one spec, or an explicit ACCEPTANCE_STORY_KEY override). Both are published —
  // evidence is append-only, and silently dropping one is the very bug MOTIR-1734
  // fixed — but say so, because a duplicate receipt on a story is surprising.
  const perStory = new Map();
  for (const { storyKey } of publishable) perStory.set(storyKey, (perStory.get(storyKey) ?? 0) + 1);
  for (const [storyKey, count] of perStory) {
    if (count > 1) console.log(`Note: ${count} recordings target ${storyKey} — publishing all.`);
  }

  // OWNERSHIP GATE (MOTIR-1937) — publish only the receipts for the acceptance
  // specs THIS run changed; everything else is a rehearsal.
  //
  // Applied AFTER the watchability + size assessment on purpose, so a PR still
  // pays for every check: the recordings were discovered, each story resolved, and
  // each clip measured against the MOTIR-1772 floor and the MOTIR-1911 per-file
  // cap — all reported and annotated. Only
  // the WRITE is scoped. Skipping the work entirely for un-owned recordings would
  // move those checks to whichever run does own them, which is how a broken
  // acceptance gate stayed invisible for days (MOTIR-1905).
  const owned = publishable.filter((t) => t.owned);
  const rehearsed = publishable.filter((t) => !t.owned);

  for (const { storyKey, recording, meta } of rehearsed) {
    console.log(
      `  rehearsed: ${path.basename(recording.dir)} → ${storyKey} — this run did not change ` +
        `${meta?.specFile ?? 'its spec'}, so its receipt is left as it is.`,
    );
  }
  if (rehearsed.length > 0) {
    ciSummary(
      `- ℹ️ ${rehearsed.length} recording(s) checked but not published — this run does not own their specs.`,
    );
  }

  if (owned.length === 0) {
    console.log(
      `Nothing to publish: ${publishable.length} publishable recording(s), none produced by a spec ` +
        `this run changed (${ownedSpecs.size} owned spec(s)). A story's receipt is written by the ` +
        'PR that changes its acceptance spec, so an unrelated run never supersedes it.',
    );
    // An unwatchable or over-limit clip this run OWNS is still a defect worth
    // failing on. One it merely rehearsed is not (MOTIR-2499) — see the
    // whose-defect-is-it note above.
    if (rejectedOwned.length > 0) {
      console.error(
        `${rejectedOwned.length} unpublishable owned recording(s) out of ${targets.length} — reported above.`,
      );
      process.exit(1);
    }
    return;
  }

  console.log(
    `Publishing ${owned.length} of ${publishable.length} recording(s) — the ones produced by the ` +
      `acceptance spec(s) this run changed: ${[...ownedSpecs].join(', ')}.`,
  );

  // Keyless GitHub OIDC first (MOTIR-1650); fall back to a MOTIR_PUBLISH_TOKEN
  // PAT for a repo not connected via the Motir GitHub App (ADR §4). Motir's own
  // lanes pass no PAT at all (MOTIR-7253): they publish over OIDC or not at all.
  // Neither present → a NAMED no-op, exit 0 — a fork PR gets no OIDC token, and
  // a red lane for a credential the fork cannot have would teach everyone to
  // ignore the lane.
  const oidcToken = await requestGithubOidcToken(audience);
  const token = process.env['MOTIR_PUBLISH_TOKEN'] || null;
  if (!oidcToken && !token) {
    console.log(
      'Not publishing: no GitHub OIDC token and no MOTIR_PUBLISH_TOKEN. GitHub mints an OIDC token ' +
        'only for a job granted `id-token: write`, and never for a pull request from a fork — so a ' +
        'fork PR, or a job without that grant, records and does not publish.',
    );
    // Returns 0 even if a recording was unwatchable. Deliberate: with no
    // credential nothing was going to be published anyway, and a fork PR — which
    // gets neither OIDC nor the secret — must not be red-lit by a pacing defect
    // it cannot fix. The unwatchable clips were still REPORTED and annotated
    // above, so the signal is not lost on a run that can act on it.
    return;
  }
  console.log(
    oidcToken
      ? 'Authenticating the acceptance-video publish via keyless GitHub OIDC.'
      : 'Authenticating the acceptance-video publish via MOTIR_PUBLISH_TOKEN (PAT fallback).',
  );

  const provenance = {
    commitSha: process.env['GITHUB_SHA'] ?? null,
    ciRunUrl: ciRunUrl(),
  };

  // One publish per recording. A failure is REPORTED and the loop continues, so
  // one story's bad publish cannot cost the others their receipt; the step still
  // exits non-zero at the end, so a partial publish is never silently green.
  let failed = 0;
  // A skipped story wrote nothing, so it is NOT a publish; nothing went wrong, so
  // it is NOT a failure. A third tally is what keeps the "Published N of M" line
  // honest once most of the lane is accepted (MOTIR-2768).
  let skipped = 0;
  for (const { recording, storyKey, verdict, sizes } of owned) {
    // An over-cap TRACE is dropped, not fatal (MOTIR-1911). The receipt is the
    // video; refusing to publish it because a debugging aid is too big is how
    // MOTIR-813 lost its evidence for a 113 MB trace beside a 6 MB clip.
    if (sizes.dropTrace) {
      const dropped =
        `Acceptance TRACE for ${storyKey} (${path.basename(recording.dir)}) was DROPPED: ${sizes.dropReason}. ` +
        'The video — the receipt itself — is published without it. A trace this size means the ' +
        'recorded journey is long: reduce trace fidelity for this lane or split the story.';
      console.warn(dropped);
      ciAnnotate('warning', `Acceptance trace dropped for ${storyKey}: ${sizes.dropReason}`);
    }
    try {
      const result = await uploadAcceptanceVideo({
        baseUrl,
        token,
        oidcToken,
        storyKey,
        artifacts: {
          video: recording.video,
          trace: sizes.dropTrace ? null : recording.trace,
          chapters: recording.chapters,
        },
        provenance: { ...provenance, producedByKey: resolveProducedByKey(storyKey) },
      });
      if (result?.skipped) {
        // Reported where a person is already looking. A step that quietly does
        // nothing is indistinguishable from a step that worked, and this lane has
        // already shipped one incident of exactly that (MOTIR-2499).
        skipped += 1;
        const line = `${storyKey} is closed — it takes no new receipt, nothing was published.`;
        console.log(`Skipped ${storyKey}: ${result.reason}.`);
        ciAnnotate('notice', `Acceptance publish skipped: ${line}`);
        ciSummary(
          `- ⏭️ **${storyKey}** — skipped: ${result.reason}. The spec has discharged its ` +
            'purpose and should leave the lane (promote or retire — see ' +
            'docs/decisions/acceptance-receipt-lifecycle.md §3).',
        );
        continue;
      }
      // A trace the STORE refused, dropped so the receipt could land (MOTIR-3409).
      // Reported through the same channels as the over-cap drop above, and
      // deliberately worded so the two are distinguishable in a log: that one
      // names a size, this one names the store's answer. NOT counted in `failed`
      // — no recording was lost, which is the thing that tally means.
      if (result?.traceDropped) {
        const dropped =
          `Acceptance TRACE for ${storyKey} (${path.basename(recording.dir)}) was DROPPED — ` +
          `the store REFUSED it: ${result.traceDropped}. The video — the receipt itself — is ` +
          'published without it. The upload was already retried; this is the store still saying no.';
        console.warn(dropped);
        ciAnnotate('warning', `Acceptance trace refused for ${storyKey}: ${result.traceDropped}`);
      }
      console.log(`Published acceptance evidence for ${storyKey}: ${result?.evidence?.id ?? 'ok'}`);
      ciSummary(
        `- ✅ **${storyKey}** — published (${verdict.totalSeconds?.toFixed(1) ?? '?'}s clip, ` +
          `video ${formatBytes(sizes.videoBytes)}` +
          (sizes.dropTrace ? `; trace DROPPED — ${sizes.dropReason}` : '') +
          (result?.traceDropped ? `; trace DROPPED — the store refused it` : '') +
          ').',
      );
    } catch (err) {
      failed += 1;
      console.error(
        `Failed to publish ${path.basename(recording.dir)} → ${storyKey}: ${err?.message ?? err}`,
      );
      ciAnnotate('error', `Acceptance publish failed for ${storyKey}: ${err?.message ?? err}`);
      ciSummary(`- ❌ **${storyKey}** — publish failed: ${err?.message ?? err}`);
    }
  }

  console.log(
    `Published ${owned.length - failed - skipped} of ${owned.length} owned acceptance ` +
      `recording(s) (${targets.length} recorded in this run` +
      (skipped > 0 ? `; ${skipped} skipped — the story is closed and takes no new receipt` : '') +
      ').',
  );
  if (rejectedRehearsed.length > 0) {
    console.log(
      `${rejectedRehearsed.length} unpublishable recording(s) belong to specs this run does not ` +
        'own — reported above, and NOT counted as failures of this run.',
    );
  }
  // THE EXIT VERDICT. Non-zero on either kind of problem this run is answerable
  // for — a failed upload, or a clip of its OWN that was unwatchable or too big
  // to publish; both mean a story this PR owns has no receipt (MOTIR-1905 /
  // MOTIR-1911 / MOTIR-2499). Two things are deliberately NOT in here: a DROPPED
  // TRACE (the receipt published, so the run is not broken — a warning; this now
  // covers a trace the STORE REFUSED as well as an over-cap one, MOTIR-3409), and
  // an unpublishable REHEARSED recording (another PR's defect; counted separately
  // just above, so it is visible without being inherited).
  //
  // ⚠️ THIS EXIT CODE IS NOW THE SIGNAL. The workflow step no longer runs under
  // `continue-on-error`, which used to rewrite its conclusion to `success` and
  // left the annotations and the raw log as the only witnesses — the fail-open
  // that let "Published 0 of 2" pass for three days (MOTIR-2499).
  if (failed > 0 || rejectedOwned.length > 0) {
    console.error(
      `${failed} publish failure(s) and ${rejectedOwned.length} unpublishable owned ` +
        `recording(s) out of ${targets.length}` +
        (rejectedRehearsed.length > 0
          ? ` (plus ${rejectedRehearsed.length} unpublishable rehearsed recording(s), not fatal).`
          : '.'),
    );
    process.exit(1);
  }
}

// Run only when invoked as a script (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith('upload-acceptance-video.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
