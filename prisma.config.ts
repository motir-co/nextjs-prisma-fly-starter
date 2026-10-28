import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 doesn't auto-load .env when evaluating this config file (in
// contrast to Prisma 6's CLI behavior). Load it explicitly so DATABASE_URL
// is available below.
loadEnv();

// The CLI config: where the schema lives, where migrations live, and the
// datasource URL the CLI uses for `prisma migrate` / `prisma db` commands.
// The runtime adapter (PrismaPg) is wired up separately in `lib/db.ts` —
// adapters belong to the client constructor, not the CLI config.
//
// Migrations use the UNPOOLED URL (direct connection); runtime queries use
// the pooled URL. Neon's pooler (PgBouncer in transaction mode) breaks
// long-running statements + prepared statements, both of which migrations
// need. Vercel-Neon integration sets both DATABASE_URL (pooled) and
// DATABASE_URL_UNPOOLED. For local dev (single Docker Postgres, no pooler),
// the same URL works for both, so fall back to DATABASE_URL when UNPOOLED
// isn't set.
//
// Why datasource is conditional: Prisma 7 loads this entire config at every
// CLI startup, including `prisma generate` (which doesn't need a database
// connection). If we hard-required a URL here, `generate` would fail in
// CI's typecheck job (which has no DB). Migrate commands will produce
// their own clear "no datasource" error when actually invoked without a URL.
const migrationUrl = process.env['DATABASE_URL_UNPOOLED'] ?? process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
