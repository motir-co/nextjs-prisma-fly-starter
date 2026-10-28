# nextjs-prisma-vercel-starter

A production-ready starter for **Next.js + Prisma + Vercel + Neon**, with the
discovered gotchas baked in. Click "Use this template" above and ship in
minutes.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmoooon-B-V%2Fnextjs-prisma-vercel-starter)

## What this is

A starter template for the **fast path** to a deployed full-stack Next.js
app: Next.js 16 + Prisma 7 + Tailwind v4 + TypeScript strict mode, deployed
to Vercel with a managed Neon Postgres. CI on GitHub Actions runs lint +
typecheck + build against a real Postgres on every PR. Husky pre-commit
hooks keep style consistent. Vercel preview deploys fire automatically and
get isolated Neon DB branches per PR.

## Why this and not `create-next-app`?

`create-next-app` gives you ~10% of what a real Next.js + Prisma app needs.
This starter gives you the other 90%, with **specific gotchas already
fixed**:

- **`postinstall: prisma generate`** — Vercel's build cache aggressively
  reuses `node_modules`, which stales out Prisma's generated client. Without
  this hook your first deploy after a schema change fails with a confusing
  "Cannot find module '@prisma/client'" error. The fix lives in
  [`package.json`](package.json).
- **Pooled vs. unpooled DATABASE_URL split** — the Vercel-Neon integration
  sets ~10 env vars. The two that matter: `DATABASE_URL` (pooled via
  PgBouncer, fast for runtime queries) and `DATABASE_URL_UNPOOLED` (direct,
  required for Prisma migrations because PgBouncer in transaction mode
  breaks them). [`prisma.config.ts`](prisma.config.ts) reads `_UNPOOLED` for
  migrations, falls back to `DATABASE_URL` for local dev. [`lib/db.ts`](lib/db.ts)
  uses the pooled URL for runtime queries.
- **Prisma 7's "config loads on every CLI command" quirk** — `prisma
generate` doesn't need a database connection, but if `prisma.config.ts`
  throws on missing `DATABASE_URL`, even `generate` fails. The config block
  is conditional; CLI commands that need a connection produce their own
  clear errors.
- **pnpm 11 requires Node ≥22.13** — `engines.node: ">=22"` and CI pins
  Node 22. The Subtask card's "Node 20 LTS" wording predated pnpm 11.
- **Postgres on host port 5433** — defensive default; many devs already have
  something on 5432. The container internally uses 5432; only the host port
  is shifted.

These took CI failures and Vercel deploy failures to discover. Now they don't.

## Quickstart

### Option 1: Deploy to Vercel (recommended)

Click the **Deploy with Vercel** button above. Vercel will:

1. Clone this template into your GitHub account
2. Create a Vercel project from the new repo
3. Prompt you to install the **Neon Postgres** integration from Vercel's
   Storage tab — accept it; the integration auto-sets `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED` for both Production and Preview scopes
4. Deploy the placeholder page

Then clone your new repo locally to start building:

```bash
git clone <your-new-repo-url>
cd <your-new-repo>
corepack enable
cp .env.example .env  # then paste your Neon connection string into DATABASE_URL
pnpm install
pnpm dev
```

### Option 2: Local-first (Docker Postgres, no Vercel yet)

```bash
git clone <your-new-repo-url>
cd <your-new-repo>
corepack enable
cp .env.example .env  # the default DATABASE_URL points at the Docker DB
pnpm install
./scripts/db-up.sh    # starts Postgres in Docker and applies migrations
pnpm dev              # http://localhost:3000
```

Then connect to Vercel + Neon when you're ready to ship.

## Stack

- **Runtime**: [Node.js](https://nodejs.org) ≥22 (pnpm 11 requires it)
- **Framework**: [Next.js 16](https://nextjs.org) (App Router, React Server Components, Turbopack)
- **Language**: [TypeScript](https://www.typescriptlang.org) (strict mode; `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com) + [`@motir/design-system`](https://www.npmjs.com/package/@motir/design-system) — Motir's 3-axis design system (Colour · Style · Type), wired in out of the box (see [Design system](#design-system))
- **Database**: [Postgres 16](https://www.postgresql.org) (local Docker; managed [Neon](https://neon.tech) in production via the [Vercel-Neon integration](https://vercel.com/marketplace/neon))
- **ORM**: [Prisma 7](https://www.prisma.io) with [`@prisma/adapter-pg`](https://www.npmjs.com/package/@prisma/adapter-pg)
- **Lint / format**: [ESLint 9](https://eslint.org) (flat config) + [Prettier 3](https://prettier.io) + [Husky](https://typicode.github.io/husky) pre-commit + [lint-staged](https://github.com/lint-staged/lint-staged)
- **Package manager**: [pnpm](https://pnpm.io) (pinned via `packageManager` field; use `corepack enable`)
- **CI**: [GitHub Actions](https://docs.github.com/actions) — 3 parallel jobs (lint, typecheck, build with Postgres service container)
- **Deploy**: [Vercel](https://vercel.com) with [Neon Postgres](https://neon.tech) (per-PR isolated DB branches for preview deploys)

## Design system

This starter ships **Motir's 3-axis design system** — Colour (palette), Style
(shape / feel), and Type (font pairing) — already wired in, so a freshly
scaffolded product looks designed out of the box.

**Distribution: a versioned dependency on the public npm registry.** The design
system lives in one place — the [`@motir/design-system`](https://www.npmjs.com/package/@motir/design-system)
package (source: `motir-core/packages/design-system`) — and is consumed here as
a normal caret-ranged dependency (`"@motir/design-system": "^0.1.0"`). It is
**GPL-3.0 and public**, so there is **no registry auth at install time** — a
scaffold agent or a scaffolded product just `pnpm add @motir/design-system` like
any public package. Updates arrive through normal `pnpm update` within the
pinned major; the token contract (the `--el-*` names, the `data-*` attribute
set, the theme-apply API) is the semver surface. This is the mechanism fixed by
the keystone ADR (`motir-core/docs/decisions/design-system-package.md`);
publishing to a private registry, a git dependency, and a vendored/synced copy
were all considered and rejected there. **There is no hand-copied token CSS or
primitive source in this repo** — the package is the single source of truth, so
the design system can never drift into a second, divergent copy.

**What's wired:**

- **`app/globals.css`** imports the whole token layer with one line —
  `@import '@motir/design-system/theme.css';` — giving you the Tailwind v4
  `@theme` preset, the Tier-3 `--el-*` element tokens, and every
  `[data-palette]` / `[data-style]` / `[data-type]` / `[data-surface]` swap
  block. Reference colour through the `--el-*` tokens (e.g.
  `text-(--el-text)`, `bg-(--el-surface)`), never raw hexes.
- **`app/layout.tsx`** loads the type-axis fonts (as `--font-*-source`
  variables), sets the **default** design on `<html>` (Colour `motir` · Style
  `warm-editorial` · Type `motir`) via `resolveAxesToApplied({})`, renders the
  FOUC-safe `buildThemeInitScript(null)`, and wraps the app in the package's
  `ThemeProvider` + `ToastProvider`.
- **`@/components/ui`** re-exports the primitives (`Button`, `Card`, `Modal`,
  `Input`, `Pill`, …) — or import them directly from `@motir/design-system`.
- **`/tokens`** renders the package's live `TokensSpecimen` — the same specimen
  motir-core uses — so you have an always-in-sync reference of every primitive
  plus the axis pickers to preview the swaps live.

**Applying a specific choice.** To ship a non-default design, resolve the axes
and pass them to both the init script and the provider (the same seam
motir-core's scaffold agent uses to re-apply a planner-stored choice):

```tsx
import { resolveAxesToApplied, buildThemeInitScript } from '@motir/design-system';
const applied = resolveAxesToApplied({ styleId, paletteId, typeId }); // your choice
// <html data-style={applied.styleId} data-palette={applied.paletteId} data-type={applied.typeId}>
// <script dangerouslySetInnerHTML={{ __html: buildThemeInitScript(applied) }} />
```

> **`nextjs-prisma-vercel-starter-with-design`** was an earlier, partial
> hand-copied port of the design system. It is **superseded** by this
> package-based wiring (per the ADR) and should be archived — this repo is the
> single design-system-enabled starter.

## Scripts

| Script                     | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                 | Start the dev server on `localhost:3000`                            |
| `pnpm build`               | Apply pending Prisma migrations, then production build (0 warnings) |
| `pnpm start`               | Start the production server                                         |
| `pnpm lint`                | Run ESLint                                                          |
| `pnpm format`              | Run Prettier and write fixes in place                               |
| `pnpm format:check`        | Run Prettier in check mode (used by CI)                             |
| `pnpm typecheck`           | Run `tsc --noEmit`                                                  |
| `pnpm test`                | Run Vitest unit / integration tests against a real Postgres         |
| `pnpm test:e2e`            | Run Playwright E2E tests (spawns the dev server automatically)      |
| `pnpm test:e2e:acceptance` | Run the acceptance lane (records a clip per story flow)             |

## Project layout

```
app/          Next.js App Router routes — your pages and route handlers.
              `(auth)/` — sign-in, sign-up, reset-password (plain Tailwind).
              `(authed)/` — gated routes (smoke `dashboard/page.tsx`).
              `api/auth/[...all]/route.ts` — Better-Auth catch-all handler.
components/   React UI primitives. `ui/index.ts` re-exports the
              `@motir/design-system` primitives (Button, Card, Modal, …) so app
              code imports them from `@/components/ui` — no hand-copied source.
              `LocaleToggle.tsx` — the starter's plain locale switcher.
lib/          Server-side logic.
              `db.ts` — singleton Prisma client.
              `auth/` — Better-Auth instance, client SDK, argon2 wrappers.
              `users/` — user repo + typed errors.
              `email.ts` — pluggable email-sending abstraction.
              `test-oauth-mock.ts` — Node-only Google token-endpoint mock
              for E2E (dormant unless E2E_TEST_OAUTH=1).
proxy.ts      Next.js Proxy (formerly middleware) — gates the `(authed)` route group.
instrumentation.ts  Next.js boot hook — installs the OAuth mock for E2E.
prisma/       Prisma schema + migrations. Edit `schema.prisma`, run
              `pnpm prisma migrate dev --name <description>` to generate a
              new migration.
tests/        Vitest integration tests (real Postgres) + Playwright E2E
              specs in `tests/e2e/`. See `playwright.config.ts` and
              `vitest.config.ts`.
design/       Design assets — two files per surface (notes + mock), published
              to the work item with Motir's `publish_design_result` tool
              when work waits on the design. See `design/README.md`.
docs/         Project docs.
scripts/      Dev scripts. `db-up.sh` brings up Docker Postgres + migrations.
public/       Static assets.
.github/
  workflows/  CI definitions: `ci.yml` (lint, typecheck, unit, build, e2e),
              `acceptance-tests.yml` (paths-filtered story-acceptance lane),
              and the preview-database cleanup.
```

## CI

Runs on every PR and push to `main` via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
Jobs:

- **Lint** — `pnpm lint` + `pnpm format:check` (parallel)
- **TypeScript** — `pnpm prisma generate` then `pnpm typecheck` (parallel)
- **Unit tests** — `pnpm test` (Vitest) against a Postgres 16 service
  container (parallel). The suites in `tests/*.test.ts` are integration
  tests against a real database, so the job migrates it first — the same
  setup the E2E job uses, minus the browser.
- **Build** — `pnpm build` (runs `prisma migrate deploy && next build`),
  against a Postgres 16 service container (parallel)
- **Playwright E2E** — `pnpm test:e2e` against the same Postgres image,
  after the build job (sequential — no point burning E2E minutes on a
  red build)
  The Husky pre-commit hook catches lint/format issues before they reach CI;
  CI is the backstop. Total runtime targets <5 min on a fresh clone.

### There is NO design-result lane — the agent publishes

A design task's result — the `*.mock.html` mock(s), with the area's
`design-notes.md` one link away — reaches its work item in Motir because **the
agent that drew it calls `publish_design_result`**, naming the card, and it does
so **only when an open work item is `blocked_by` the design**; a design nothing
waits on publishes no result, and its pull request is its review. A reviewer
reads a published result on the card instead of opening raw files on GitHub.
There is no workflow, no check and no repository secret involved, and
`design/README.md` is the authoring guide.

This repository shipped a `design-result.yml` lane until MOTIR-3797, and it is
worth one paragraph on why it went, because the reason is about scaffolded
repositories specifically. The lane ran a **publisher script that had to be
present in the repository**, so every repository scaffolded from this one
carried a copy — and a copy has no way to know it has gone stale. Nothing
imports it, nothing type-checks it against an interface, no check compares it to
anything. This starter's copy sat seventeen days and five bug fixes behind its
original, still resolving its target card from the branch ref, and every signal
was green the entire time. A tool the agent calls is the same publish with none
of the copying.

### The acceptance lane — its own paths-filtered workflow

[`.github/workflows/acceptance-tests.yml`](.github/workflows/acceptance-tests.yml)
records the story-acceptance clip. It is **opt-in by authoring a spec**, and that
opt-in is enforced by the workflow's own trigger:

```yaml
on:
  pull_request:
    paths:
      - 'tests/e2e/acceptance*.spec.ts'
```

A PR that changes no acceptance spec never triggers the workflow, so it shows
**no acceptance check at all** — not a greyed skipped one. That is why the lane
is a separate file rather than a job in `ci.yml`: a job-level `if:` that
evaluates false is still REPORTED as a `Skipped` check, and so is any job added
just to compute the condition. Only an untriggered _workflow_ leaves nothing on
the PR. On a PR that does change a spec, the lane runs and uploads its Playwright report,
which is where the clips, traces and `chapters.json` sidecars survive.

**CI publishes the receipt** from a green pull-request run, over keyless GitHub
OIDC (MOTIR-7255): the lane's `Publish the acceptance receipt` step runs the
vendored uploader for the specs that PR changed. A Motir-hosted repository is
connected to the Motir GitHub App at creation, so there is no repository secret
to set. An agent working here sees that step and does not publish over MCP. See
[`docs/acceptance-video.md`](docs/acceptance-video.md).

Because it is a separate workflow it cannot depend on `ci.yml`'s `build` job —
it runs against `pnpm dev` and so needs no build, but it also no longer waits
for a green one. That cost is only paid on the PRs that own a spec.

### Where CI runs — `vars.MOTIR_RUNNER`

Every job in every workflow picks its runner through
`runs-on: ${{ vars.MOTIR_RUNNER || 'ubuntu-latest' }}` instead of a hardcoded
label. `MOTIR_RUNNER` is a **Motir-managed** Actions variable:

- **While Motir hosts this repo**, Motir sets `MOTIR_RUNNER` to its own
  ephemeral runner fleet's label, and CI runs there — on Motir's bill.
- **Clearing or deleting the variable returns the repo to GitHub-hosted
  runners** (`ubuntu-latest`), with no edit to any workflow file. An unset
  variable evaluates to the empty string, which is falsy, so `||` yields the
  literal default.

That is what makes a repo handed over to its owner keep working: a transferred
repo has no self-hosted runners, and a hardcoded `runs-on: [self-hosted, …]`
would leave every job queued until GitHub drops it. If you own this repo and
are not using Motir's fleet, you do not need to do anything — just leave
`MOTIR_RUNNER` unset.

## Customizing for your project

After clicking "Use this template," you'll want to rename a few things:

1. **`package.json`** — change `"name"` and `"description"`
2. **`app/page.tsx`** and **`app/layout.tsx`** — replace the placeholder content
3. **`docker-compose.yml`** + **`.env.example`** + **`scripts/db-up.sh`** —
   the DB user/password/name is currently `nextjs_prisma_vercel_starter`;
   change to match your project
4. **`prisma/schema.prisma`** — delete the `Marker` placeholder once you add
   your first real model (it exists only so the initial migration has
   something to apply)
5. **`LICENSE`** — replace the copyright holder with your name or org

The migration in `prisma/migrations/20260521222036_init/` is named
generically (`init`); you can leave it or delete it after generating your
own first migration.

## Auth

This starter ships pre-wired email/password + Google OAuth via
[Better-Auth](https://www.better-auth.com), with argon2id hashing, password
reset by email link, session cookies, and edge middleware that gates the
`/dashboard/*` routes. The auth pages (`/sign-in`, `/sign-up`,
`/reset-password`, `/reset-password/new`) are rewritten in plain Tailwind
so they render reasonably out of the box; restyle them when you add your
real design system.

### What's already there

- **Schema**: `User`, `Account`, `Session`, `Verification` tables (matching
  Better-Auth's adapter conventions) in
  [`prisma/schema.prisma`](prisma/schema.prisma).
- **Server-side config**: [`lib/auth/index.ts`](lib/auth/index.ts) — Better-Auth
  instance with the auto-link policy for Google, rate limiting (3/hour on
  password-reset), and cookie hardening pinned for review.
- **Client SDK**: [`lib/auth/client.ts`](lib/auth/client.ts) — exports `signIn`,
  `signOut`, `signUp`, `useSession` for client components.
- **Repo layer**: [`lib/users/repo.ts`](lib/users/repo.ts) — `createUser`,
  `verifyPassword`, `findOrCreateOAuthUser` for any direct-DB code path.
- **API route**: [`app/api/auth/[...all]/route.ts`](app/api/auth/[...all]/route.ts) — Better-Auth's
  catch-all handler at `/api/auth/*`.
- **Proxy**: [`proxy.ts`](proxy.ts) — optimistic cookie check on every
  request to a protected route (Next.js 16's Proxy convention,
  [formerly known as middleware](https://nextjs.org/docs/messages/middleware-to-proxy)).
- **Smoke route**: [`app/(authed)/dashboard/page.tsx`](<app/(authed)/dashboard/page.tsx>) —
  proves the gate and `getSession()` work end-to-end. Replace with your
  real dashboard.
- **Tests**: Vitest integration tests in [`tests/`](tests/) hit a real
  Postgres; Playwright specs in [`tests/e2e/`](tests/e2e/) drive the
  full sign-up / sign-in / Google / password-reset flows. The Google OAuth
  E2E is intercepted at the HTTP boundary (see [`lib/test-oauth-mock.ts`](lib/test-oauth-mock.ts))
  so nothing leaves localhost.

### Required environment variables

Set these wherever you deploy (Vercel: Settings → Environment Variables;
local: `.env`).

- `BETTER_AUTH_SECRET` — random 32-byte secret. Generate with
  `openssl rand -base64 32`. Rotating invalidates all active sessions.
- `BETTER_AUTH_URL` — public origin (e.g. `https://your-app.vercel.app`).
  Optional locally (defaults to `http://localhost:3000`); MUST be set in
  production so OAuth callback URLs are correct.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from
  Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client
  ID (Web application). Authorized redirect URI:
  `{BETTER_AUTH_URL}/api/auth/callback/google`. Required at module load —
  missing values throw immediately so misconfiguration surfaces loudly.
- `EMAIL_PROVIDER` — `console` (default) for dev. Real providers
  (`resend`, `postmark`) are NOT YET WIRED: choose one and implement it in
  [`lib/email.ts`](lib/email.ts) before going to production with password
  reset enabled.

If you don't want Google sign-in, delete the `socialProviders.google`
block from [`lib/auth/index.ts`](lib/auth/index.ts) and remove
`<GoogleButton />` from the sign-in / sign-up pages.

### Cleanup workflow (preview database branches)

[`cleanup-preview-deployments.yml`](.github/workflows/cleanup-preview-deployments.yml)
deletes Vercel preview deployments when their PR closes, which cascades
to deleting the linked Neon (or other Marketplace-managed) database
branch — without it, preview branches accumulate against your free-tier
cap and new PR previews start failing with "Resource provisioning failed".

It needs three pieces of GitHub repo configuration (Settings → Secrets and
variables → Actions):

| Where         | Name                | Value                                                   |
| ------------- | ------------------- | ------------------------------------------------------- |
| **Secrets**   | `VERCEL_TOKEN`      | A Vercel Access Token with deployment-delete permission |
| **Variables** | `VERCEL_ORG_ID`     | Your team/account ID (visible in `.vercel/repo.json`)   |
| **Variables** | `VERCEL_PROJECT_ID` | Your Vercel project ID (visible in `.vercel/repo.json`) |

`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are stored as variables (not
secrets) because they appear in the linked `.vercel/repo.json` and aren't
sensitive — anyone with repo access can already see them.

**If you set none of them, nothing breaks.** A repo that isn't linked to a
Vercel project has no preview deployments to delete, so the workflow logs a
notice and exits successfully. You will still see a green
`Delete preview deployments` check on every closed PR — the workflow is
triggered by `pull_request: closed`, and that trigger can't be filtered on
whether the config exists, so the job runs and reports a no-op rather than
not appearing at all. (Contrast the acceptance lane above, whose
opt-in _is_ expressible as a `paths:` filter, so it leaves no check
behind.)

Setting **some but not all three** is the one case that fails the check, on
purpose: cleanup is not running, and preview database branches are quietly
accumulating until new previews fail with "Resource provisioning failed."
The job names exactly which values are missing. Clear all three to opt out
entirely.

## License

[MIT](LICENSE). Fork freely. The copyright notice in LICENSE applies only
to the template files; your additions are yours.
