# Acceptance videos

A **story acceptance video** is a recording of your app's happy path, produced by a
green E2E run and published to the story in Motir. A reviewer watches it and
Approves — that is the acceptance gate (Motir Principle #18: review at the story
level, not per subtask). It is distinct from verification: your tests prove the
code is **correct**; the video is what a person watches to decide it is **what
they wanted**.

This starter ships the lane pre-wired, so a project generated from it produces
that receipt on day one: **CI records the clip and, on a green pull-request run,
publishes it to its story** over keyless GitHub OIDC, with nothing to configure
(MOTIR-7255, following motir-core's MOTIR-7253).

## Writing an acceptance spec

Create `tests/e2e/acceptance-<area>.spec.ts` and use the harness:

```ts
import { test, expect } from './_helpers/acceptance-video';

test('sign up and land on the dashboard', async ({ page, chapter, acceptanceStory, beat }) => {
  acceptanceStory('MOTIR-123'); // the STORY this clip is the receipt for

  await chapter('Open the sign-up page', async () => {
    await page.goto('/sign-up');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  });

  await chapter('Create the account', async () => {
    await page.getByLabel('Email').fill('ada@example.com');
    await beat(); // pace it — a human is watching
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});
```

Two rules that are easy to get wrong:

- **`acceptanceStory(...)` names the STORY, not the subtask.** Acceptance is
  story-level. The key it declares is what the clip is published against.
- **Pace it.** The clip is a thing a person WATCHES. `chapter()` paces itself and
  `beat()` adds a breath after a user-visible action. A spec that races through
  passes every assertion and produces a receipt nobody can review. The uploader
  measures it before publishing, and a clip of a spec your PR owns that is too
  unpaced to watch is reported as unpublishable and fails the publish step.

Run it locally with `pnpm test:e2e:acceptance`. It uses its own Playwright config
(`playwright.acceptance.config.ts`, port 3200) so it can run alongside the main
suite, and the main suite `testIgnore`s `acceptance*.spec.ts` so nothing runs twice.

### Retiring a spec — an empty lane is the normal state

An acceptance spec has a **lifecycle**, and it is not "written once and kept
forever". It enters the lane when its story goes into review, records the clip
the reviewer watches, and then **leaves** once that story is approved — either
_promoted_ into the main Playwright lane (rename it out of `acceptance*.spec.ts`,
so the behaviour keeps being regression-tested every PR without re-recording a
receipt nobody will watch again) or _retired_ (deleted, when the main lane
already covers it).

So the lane's membership is roughly "the stories currently in review", and its
correct size is frequently **zero** — including on a fresh project, which starts
there. Two consequences worth knowing before they surprise you:

- **The PR that retires the last spec is a normal, green PR.** A deletion matches
  the workflow's `paths:` filter exactly as an edit does, so that PR _does_ run
  the lane, and the lane then collects nothing. `pnpm test:e2e:acceptance`
  therefore carries **`--pass-with-no-tests`**: without it Playwright exits 1 on
  `No tests found` and the one PR that ends a receipt's life reports a red check
  on a diff that deletes a test — the most misreadable signal CI can give, whose
  obvious remedy is to put the spec back and keep every approved story's spec in
  the lane forever (MOTIR-2927). Do not remove the flag as a papered-over
  misconfiguration; an empty lane here is a legitimate state, not a broken one.
- **An empty lane still fails when a spec fails.** `--pass-with-no-tests` only
  changes the verdict on _zero collected tests_. One collected failing test is a
  red lane exactly as before.

## What CI does

| Run                                              | Records + checks           | Publishes                     |
| ------------------------------------------------ | -------------------------- | ----------------------------- |
| PR that changes `tests/e2e/acceptance-X.spec.ts` | yes                        | **yes, on green** — X's story |
| PR that changes no acceptance spec               | **no run at all**          | —                             |
| Push to the default branch, lane holds ≥ 1 spec  | yes — the **baseline**     | never                         |
| Push to the default branch, lane is empty        | no — gate job only (~10 s) | —                             |

The `paths:` scoping does two jobs. A PR that owns no acceptance spec must show
**no acceptance check at all**, not a greyed `Skipped` one (MOTIR-1958). And the
publisher must write only the receipts the PR owns:

1. **Publishing SUPERSEDES.** A new receipt for a story retires the previous one
   and unlinks its video for garbage collection. It is not additive.
2. **Each recording targets its OWN declared story**, from `acceptanceStory(...)`,
   not from the branch it was recorded on. A publisher that shipped everything it
   found would republish every story that has a spec, with clips no reviewer
   watched. That is exactly what happened in Motir's own CI before MOTIR-1937: one
   backend PR republished seven already-accepted stories. So the lane computes the
   specs the PR changed (the `owned-specs` step) and the uploader publishes only
   the recordings those specs produced.

So the lane lives in its **own workflow**,
[`.github/workflows/acceptance-tests.yml`](../.github/workflows/acceptance-tests.yml),
triggered by `on: pull_request: paths: ['tests/e2e/acceptance*.spec.ts']`, plus a
default-branch baseline.

### The default-branch baseline

That `paths:` filter is deliberately blind to your **app**. An acceptance spec
drives a real product surface, so the filter cuts straight between a page and the
only test that reads it: change the page, and the lane does not run. Widening the
filter is not the answer — the set of sources these specs read is most of your
app, so any honest widening runs the whole lane on nearly every PR, usually to
execute nothing at all.

So the lane **also runs on a push to the default branch**, which is why the table
above has two rows for it. Without that, a change that breaks an acceptance spec
merges green and then sits there until some unrelated PR happens to touch a spec
— and that PR's author inherits the diagnosis of somebody else's change. The
baseline puts the red on the merge that caused it.

Two properties keep that affordable, and both are asserted in
`tests/ci-acceptance-lane.test.ts`:

- **It is gated on the lane holding a spec.** A full run installs pnpm, generates
  a Prisma client, migrates a Postgres, downloads a Chromium and boots a dev
  server; the cost is the setup, not the specs, so an ungated trigger would pay
  it on every merge to run zero tests. A fresh project's lane is empty until
  someone writes the first acceptance spec, so that is the common case, not the
  edge case. The `membership` job is a checkout and a `find` — seconds — and the
  rest of the lane only starts if it finds something.
- **Superseded runs are cancelled on PRs only.** On a PR only the tip matters. On
  the default branch, back-to-back merges would cancel each other's baseline and
  leave exactly the "which merge broke it?" ambiguity the baseline removes.

This does not weaken the no-check-at-all requirement below. That requirement is
about **pull requests**; a `push` event attaches its checks to the commit on the
default branch and adds nothing to any open PR, so the gate can skip freely there
and cost no PR a check. For a `pull_request` event the gate answers `true`
unconditionally — the `paths:` filter has already decided.

What is still **not** covered, said plainly: the PR that breaks a spec goes green.
The baseline catches it one merge later, not before it lands. The accepted cost is
a red default branch for the length of one fix — bounded, attributed, and paid by
the author who caused it rather than by the next passer-by.

**Why a whole workflow, and not a job with an `if:`?** Because the requirement is
that a PR owning no acceptance spec shows no acceptance check _at all_, and a
job-level `if:` does not deliver that: a job whose `if:` is false is still
reported, as a greyed `Skipped` check — and so is any extra job added just to
compute the condition. Only a workflow that is never triggered leaves nothing on
the PR. This starter shipped the `if:` version first, under a comment claiming
the opposite; measured on PR #8, a PR touching no acceptance spec listed both
`Acceptance video  skipping` and `Changed acceptance specs  pass` (MOTIR-1958).

The trade is that a separate workflow cannot `needs:` another workflow's job or
read its artifacts. This lane needs neither — it runs against `pnpm dev` — but it
no longer waits for a green build, and its `env:` block is a copy of `ci.yml`'s
`e2e` job rather than a shared one. Change both together.

**Why the baseline never publishes.** The receipt belongs to the review moment:
Motir's approve action moves a story `in_review → done`, and `in_review` is the
**PR-open** state, so a receipt that only arrived after the merge would land once
the story was already done and the reviewer would never get to watch-then-approve.
The publish step is gated on `pull_request`, and on a `push` the `owned-specs`
step emits an empty list, which the uploader fails closed on — two mechanisms,
because a wrong answer would supersede a story's evidence.

## Who publishes the receipt (CHANGED AGAIN — MOTIR-7255)

**CI does**, from a green pull-request run. The `Publish the acceptance receipt`
step runs the vendored uploader through `.github/actions/upload-acceptance-video`,
which mints a GitHub OIDC token (the job's `id-token: write`) that Motir verifies
against this repository's Motir GitHub App connection. A Motir-hosted repository
is connected at creation, so **there is nothing to configure** — no repository
secret, no Motir token anywhere in the workflow. The run log names the story, the
uploaded video and the receipt id.

**An agent working in this repository stands down.** The dispatch prompt has it
check its checkout for a workflow that `uses: ./.github/actions/upload-acceptance-video`;
finding this one, it makes no MCP publish and reports that the lane publishes.

**Where CI cannot publish, the receipt goes through the Motir MCP tools**
(`create_acceptance_upload` + `publish_acceptance_result`), which an agent uses
with the credential it already holds. That is the case for a pull request from a
**fork** (GitHub mints a fork no OIDC token, and the uploader then logs why and
exits 0), and for a copy of this template that is **not connected to Motir**,
which has no App connection for the OIDC identity to resolve through. The
action's optional `token` input is the other door for an unconnected repository —
an `integration`-scope Motir token stored as a secret; see
`motir-core/docs/e2e/acceptance-video-byok.md`.

History: from 2026-09-02 (MOTIR-4097, following motir-core's MOTIR-4096) to
2026-10-01 this lane only recorded and the agent published over MCP. A receipt
that exists only if an agent remembered two calls and could reach MCP is the least
reliable link in the gate, so for the repositories Motir writes, CI publishes
again (motir-core `docs/decisions/acceptance-video.md`, the 2026-10-01 amendment).
Projects generated from this template before then keep their record-only lane;
their agents still publish over MCP, which still works.

## What turns the lane RED

**A failing acceptance spec**, or **a publish step that could not land a receipt
for a story this PR owns** — an upload the server refused, or a clip of that
story's own spec too unpaced to watch. Neither is a cosmetic failure: the receipt
is the lane's product. A story that is already closed is reported as **skipped**
(`ACCEPTANCE_EVIDENCE_STORY_CLOSED`) and stays green, and so does a run with no
OIDC token; a recording this PR does not own is reported and never fails it.

**The lane still carries no `continue-on-error`, and it must not acquire one**
(MOTIR-2690). The original occurrence was the publish step: `continue-on-error`
rewrites a step's conclusion to `success` in the checks UI, in `gh pr checks`,
**and** in the REST API. Measured in Motir's own CI, the publish failed on every
run for three days — `Published 0 of 2`, two `##[error]` lines — while the lane
reported `pass` each time, and two stories lost their receipt with nothing anywhere
saying so. That step is gone; the prohibition is kept and widened to the whole
file, because a check that cannot fail is worse than no check whichever step wears
it. `tests/ci-acceptance-lane.test.ts` asserts it.

## The uploader is VENDORED here (MOTIR-1941; restored by MOTIR-7255)

`scripts/upload-acceptance-video.mjs`, `.github/actions/upload-acceptance-video/`
and `tests/acceptance-video-uploader.test.ts` are **copies** of motir-core's. A
composite action resolves `node scripts/upload-acceptance-video.mjs` against the
CALLER's workspace, so the action cannot be referenced remotely; the copy is how
this repository runs it. Each file opens with a **SYNC POINT** naming the
motir-core commit it was copied from, and the body below the header is upstream
**verbatim** (the test carries one marked divergence: it pins the refusal code as
a literal, because motir-core's error class does not exist here). So a re-sync is
a `diff`, not archaeology (MOTIR-2693):

```sh
diff <(git -C ../motir-core show <sha>:scripts/upload-acceptance-video.mjs) \
     <(tail -n +24 scripts/upload-acceptance-video.mjs)
```

Fix bugs upstream and re-copy; never patch the copy here. They were deleted on
2026-09-02 (MOTIR-4097) and restored on 2026-10-01 from motir-core's MOTIR-7253,
which brought the client up to today's server: the closed-story skip keys on
`ACCEPTANCE_EVIDENCE_STORY_CLOSED`, and `producedByKey` is the PR's own card key,
so a CI publish and an agent's MCP publish of one commit collapse to one receipt.

**Vendoring charges rent, and this is where it was paid before.** Between
2026-07-24 and 2026-08-11 the old copy fell four upstream cards behind, and one of
them had changed the WIRE (MOTIR-2389 moved the blob store to S3). Nothing was red,
because this repository's own `paths:`-filtered lane never fires — it owns no
acceptance spec. The vendored uploader test is what fails a bad sync locally, and
`tests/acceptance-video-uploader.test.ts`' manifest guard is what catches a
`${'{'}{ }}` expression in an input `description:`, which stops GitHub loading the
action at all (MOTIR-2937, measured on this repo's PR #17).

Upstream: `motir-core/docs/e2e/acceptance-video-byok.md` (the consumer contract for
CI that still publishes over the HTTP route) and
`motir-core/docs/decisions/acceptance-video.md` (the policy; its 2026-10-01
amendment records why CI publishes again).
