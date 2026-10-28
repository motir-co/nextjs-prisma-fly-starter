# nextjs-prisma-fly-starter

A production-ready **Fly** starter for **Next.js + Prisma + Postgres**, with
the discovered gotchas baked in. It builds into one container image, and
Motir's hosting runs that image on **Fly Machines** with a serverless Postgres
(Neon). It is the starter for apps that keep running: steady traffic,
long-lived requests, work that does not fit a function.
Click "Use this template" above and ship in minutes.

## What this is

A starter template for the **fast path** to a deployed full-stack Next.js
app: Next.js 16 + Prisma 7 + Tailwind v4 + TypeScript strict mode, built as a
standalone server in one `linux/amd64` image ([`Dockerfile`](Dockerfile)) and
described to the host by [`motir.hosting.json`](motir.hosting.json). CI on
GitHub Actions runs lint + typecheck + build against a real Postgres on every
PR. Husky pre-commit hooks keep style consistent.

## Why this and not `create-next-app`?

`create-next-app` gives you ~10% of what a real Next.js + Prisma app needs.
This starter gives you the other 90%, with **specific gotchas already
fixed**:

- **`postinstall: prisma generate`** — a build cache that reuses
  `node_modules` stales out Prisma's generated client. Without this hook
  your first build after a schema change fails with a confusing
  "Cannot find module '@prisma/client'" error. The fix lives in
  [`package.json`](package.json).
- **Pooled vs. unpooled DATABASE_URL split** — a serverless Postgres gives
  you two URLs: `DATABASE_URL` (pooled via
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

- **The build never migrates** — `pnpm build` is `next build` and needs no
  database; migrations are `pnpm db:migrate`, run from the image as the
  manifest's `database.migrateCommand` before a release takes traffic.

These took CI failures and deploy failures to discover. Now they don't.

## Quickstart

### Option 1: Deploy through Motir (recommended)

A repository Motir creates from this starter is deployed by Motir's hosting:
it builds the image from the [`Dockerfile`](Dockerfile), runs the manifest's
migrate command against the project's Neon Postgres, and starts the image on
a Fly Machine, which takes traffic once `GET /api/health` answers. There is
no `fly.toml`: the manifest is the one description of how to run it.

### Option 2: Local-first (Docker Postgres)

```bash
git clone <your-new-repo-url>
cd <your-new-repo>
corepack enable
cp .env.example .env  # the default DATABASE_URL points at the Docker DB
pnpm install
./scripts/db-up.sh    # starts Postgres in Docker and applies migrations
pnpm dev              # http://localhost:3000
```

To run the production image locally:

```bash
docker buildx build --platform linux/amd64 -t app .
docker run --rm -p 3000:3000 -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) app
curl http://localhost:3000/api/health   # {"status":"ok"}
```

## Stack

- **Runtime**: [Node.js](https://nodejs.org) ≥22 (pnpm 11 requires it)
- **Framework**: [Next.js 16](https://nextjs.org) (App Router, React Server Components, Turbopack)
- **Language**: [TypeScript](https://www.typescriptlang.org) (strict mode; `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com) + [`@motir/design-system`](https://www.npmjs.com/package/@motir/design-system) — Motir's 3-axis design system (Colour · Style · Type), wired in out of the box (see [Design system](#design-system))
- **Database**: [Postgres 16](https://www.postgresql.org) (local Docker; a serverless [Neon](https://neon.tech) Postgres in production)
- **ORM**: [Prisma 7](https://www.prisma.io) with [`@prisma/adapter-pg`](https://www.npmjs.com/package/@prisma/adapter-pg)
- **Lint / format**: [ESLint 9](https://eslint.org) (flat config) + [Prettier 3](https://prettier.io) + [Husky](https://typicode.github.io/husky) pre-commit + [lint-staged](https://github.com/lint-staged/lint-staged)
- **Package manager**: [pnpm](https://pnpm.io) (pinned via `packageManager` field; use `corepack enable`)
- **CI**: [GitHub Actions](https://docs.github.com/actions) — 3 parallel jobs (lint, typecheck, build with Postgres service container)
- **Deploy**: one container image ([`Dockerfile`](Dockerfile), `output: 'standalone'`) run on [Fly Machines](https://fly.io/docs/machines/); see [Deploy](#deploy)

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
  variables), sets the **project's** design on `<html>` from
  [`motir.design.json`](motir.design.json) via
  `resolveAxesToApplied(projectDesign)`, renders the FOUC-safe
  `buildThemeInitScript(applied)` with the same design, and wraps the app in
  the package's `ThemeProvider` + `ToastProvider`.
- **`@/components/ui`** re-exports the primitives (`Button`, `Card`, `Modal`,
  `Input`, `Pill`, …) — or import them directly from `@motir/design-system`.
- **`/tokens`** renders the package's live `TokensSpecimen` — the same specimen
  motir-core uses — so you have an always-in-sync reference of every primitive
  plus the axis pickers to preview the swaps live.

**Applying a specific choice.** The design is the three ids in
[`motir.design.json`](motir.design.json), which ships with the registry
defaults (Colour `motir` · Style `warm-editorial` · Type `motir`). When Motir
creates a repository from this starter it writes the project's chosen ids
there in the first commit, with a `DESIGN.md` naming them. To change the look,
set other registered ids in that file; an unknown id falls back to that axis's
default.

> **`nextjs-prisma-vercel-starter-with-design`** was an earlier, partial
> hand-copied port of the design system. It is **superseded** by this
> package-based wiring (per the ADR) and should be archived — this repo is the
> single design-system-enabled starter.

## Scripts

| Script                     | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                 | Start the dev server on `localhost:3000`                       |
| `pnpm build`               | Production build (0 warnings); touches no database             |
| `pnpm db:migrate`          | Apply pending Prisma migrations (`prisma migrate deploy`)      |
| `pnpm start`               | Start the production server                                    |
| `pnpm lint`                | Run ESLint                                                     |
| `pnpm format`              | Run Prettier and write fixes in place                          |
| `pnpm format:check`        | Run Prettier in check mode (used by CI)                        |
| `pnpm typecheck`           | Run `tsc --noEmit`                                             |
| `pnpm test`                | Run Vitest unit / integration tests against a real Postgres    |
| `pnpm test:e2e`            | Run Playwright E2E tests (spawns the dev server automatically) |
| `pnpm test:e2e:acceptance` | Run the acceptance lane (records a clip per story flow)        |

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
   the DB user/password/name is currently `nextjs_prisma_fly_starter`;
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

Set these wherever you deploy (the hosting environment's secrets; local:
`.env`).

- `BETTER_AUTH_SECRET` — random 32-byte secret. Generate with
  `openssl rand -base64 32`. Rotating invalidates all active sessions.
- `BETTER_AUTH_URL` — public origin (e.g. `https://app.example.com`).
  Optional locally (defaults to `http://localhost:3000`); MUST be set in
  production so OAuth callback URLs are correct.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from
  Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client
  ID (Web application). Authorized redirect URI:
  `{BETTER_AUTH_URL}/api/auth/callback/google`. **Optional**: with both
  set, the provider is registered and the pages show "Continue with
  Google"; with either missing, sign-in is email and password only.
- `EMAIL_PROVIDER` — `console` (default) for dev. Real providers
  (`resend`, `postmark`) are NOT YET WIRED: choose one and implement it in
  [`lib/email.ts`](lib/email.ts) before going to production with password
  reset enabled.

## Deploy

This is the **Fly** starter. Motir's hosting runs it on Fly Machines, built
from its [`Dockerfile`](Dockerfile); the serverless and AWS starters are its
siblings for small apps and for apps that need an AWS account of their own.

- **The image** — a multi-stage `linux/amd64` build that runs the manifest's
  `buildCommand` (`pnpm build`; override with build-arg `MOTIR_BUILD_COMMAND`),
  copies the standalone server, `public/`, `.next/static` and the Prisma CLI
  with `prisma/` into a slim glibc Node 22 runtime (so `argon2`'s prebuilt
  binary loads), and starts `node server.js` on `0.0.0.0:3000` as the non-root
  `node` user.
- **The manifest** — [`motir.hosting.json`](motir.hosting.json) tells the host
  the target (`fly`), the port, the health path (`/api/health`), the
  build and start commands, and the database (`postgres`, migrated by
  `database.migrateCommand` from the same image). Its shape is fixed by
  Motir's hosting record; [`tests/hosting-manifest.test.ts`](tests/hosting-manifest.test.ts)
  holds every value true of this repository.
- **The health route** — `GET /api/health` answers `200 {"status":"ok"}`
  whenever the process serves requests. It does not touch the database, so a
  suspended Neon compute never fails a healthy Machine.
- **Production environment** — `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`
  (direct, for migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `EMAIL_PROVIDER`, and optionally `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.

## License

[MIT](LICENSE). Fork freely. The copyright notice in LICENSE applies only
to the template files; your additions are yours.
