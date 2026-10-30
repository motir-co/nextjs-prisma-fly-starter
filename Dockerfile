# syntax=docker/dockerfile:1.7
#
# The image this starter runs as on a Fly Machine (MOTIR-9811; the hosting
# record's §4). It listens on 0.0.0.0:3000 as the non-root `node` user. Values below are the ones motir.hosting.json declares —
# tests/hosting-manifest.test.ts holds the two files to each other.
#
#   build:   docker buildx build --platform linux/amd64 -t app .
#   run:     docker run -p 3000:3000 -e BETTER_AUTH_SECRET=… -e DATABASE_URL=… app
#   migrate: docker run --rm -e DATABASE_URL=… app \
#              node migrate/node_modules/prisma/build/index.js migrate deploy --config migrate/prisma.config.ts
#
# The build needs no database: `next build` never migrates (that is the
# manifest's `database.migrateCommand`, run from this same image), and the
# placeholders in the build stage only let modules that read their variables at
# load time be imported. None of them reaches the runtime stage.

ARG NODE_VERSION=22

FROM --platform=linux/amd64 node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── Dependencies (cached on the lockfile) ───────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── The manifest's buildCommand ─────────────────────────────────────────────
FROM deps AS build
ARG MOTIR_BUILD_COMMAND="pnpm build"
COPY . .
RUN BETTER_AUTH_SECRET=image-build-placeholder-not-a-secret-32-bytes \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    sh -c "$MOTIR_BUILD_COMMAND"

# ── The Prisma CLI for database.migrateCommand, at the versions the lockfile pins
FROM deps AS migrate
RUN mkdir /migrate && cd /migrate && echo '{"private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund \
      "prisma@$(node -p "require('/app/node_modules/prisma/package.json').version")" \
      "dotenv@$(node -p "require('/app/node_modules/dotenv/package.json').version")"
COPY prisma.config.ts /migrate/prisma.config.ts
COPY prisma /migrate/prisma

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=migrate --chown=node:node /migrate ./migrate

# The AWS Lambda Web Adapter (the hosting record's D-2 / D-3: one image runs on
# every target). It is a Lambda EXTENSION: only the Lambda runtime starts
# anything under /opt/extensions, so on a Fly Machine or in `docker run` it is
# an inert file and `node server.js` serves exactly as before. Under Lambda it
# proxies each invocation to the same server on the manifest's port, once the
# manifest's health path answers.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=3000 \
    AWS_LWA_READINESS_CHECK_PATH=/api/health \
    AWS_LWA_INVOKE_MODE=response_stream

USER node
EXPOSE 3000
CMD ["node", "server.js"]
