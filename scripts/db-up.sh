#!/usr/bin/env bash
# Bring up the local dev Postgres in Docker and apply Prisma migrations.
# Idempotent: safe to run repeatedly. Exits 0 on success, non-zero on failure.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed or not on PATH" >&2
  exit 1
fi

echo "==> Starting nextjs-prisma-vercel-starter-postgres (docker compose up -d)"
docker compose up -d postgres

echo "==> Waiting for Postgres to be healthy (max 30s)"
deadline=$(( $(date +%s) + 30 ))
until docker compose exec -T postgres pg_isready -U nextjs_prisma_vercel_starter -d nextjs_prisma_vercel_starter >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    echo "error: Postgres did not become ready within 30s" >&2
    docker compose logs postgres | tail -40 >&2
    exit 1
  fi
  sleep 1
done
echo "    Postgres is ready."

echo "==> Applying Prisma migrations (prisma migrate deploy)"
pnpm prisma migrate deploy

echo "==> Done. Database is up at postgresql://nextjs_prisma_vercel_starter:nextjs_prisma_vercel_starter@localhost:5433/nextjs_prisma_vercel_starter"
