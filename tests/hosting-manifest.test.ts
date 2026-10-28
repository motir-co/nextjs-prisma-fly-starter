import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// THE HOSTING MANIFEST IS TRUE OF THIS REPOSITORY (MOTIR-9811).
//
// `motir.hosting.json` tells Motir's deploy machinery how to build, start,
// health-check and migrate this starter. Its shape is fixed by §7 of the
// approved hosting record, and motir-core's `parseHostingManifest` refuses
// anything else. This file checks the two things that parser cannot: that every
// value is TRUE here (the route exists, the script exists, the image listens
// where the manifest says), and that no key outside the record's table crept in.

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The record's §7 table, in its order: every field and the shape it takes. */
const RECORD_FIELDS = {
  top: [
    'schemaVersion',
    'targets',
    'port',
    'healthCheck',
    'startCommand',
    'buildCommand',
    'requires',
    'database',
  ],
  healthCheck: ['path'],
  requires: ['websockets', 'backgroundWork'],
  database: ['kind', 'migrateCommand', 'seedCommand'],
} as const;

interface Manifest {
  schemaVersion: number;
  targets: string[];
  port: number;
  healthCheck: { path: string };
  startCommand: string;
  buildCommand: string;
  requires: { websockets: boolean; backgroundWork: boolean };
  database: { kind: string; migrateCommand?: string; seedCommand?: string };
}

const manifest = JSON.parse(read('motir.hosting.json')) as Manifest;
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const dockerfile = read('Dockerfile');

/** Every key the manifest carries that the record's table does not name. */
function unknownKeys(m: Record<string, unknown>): string[] {
  const out = Object.keys(m).filter((k) => !(RECORD_FIELDS.top as readonly string[]).includes(k));
  for (const nested of ['healthCheck', 'requires', 'database'] as const) {
    const value = m[nested];
    if (typeof value !== 'object' || value === null) continue;
    for (const key of Object.keys(value)) {
      if (!(RECORD_FIELDS[nested] as readonly string[]).includes(key)) out.push(`${nested}.${key}`);
    }
  }
  return out;
}

/** The route file a health path is served from, under `app/`. */
function routeFileFor(path: string): string {
  return join('app', ...path.split('/').filter(Boolean), 'route.ts');
}

/** The package script a `pnpm <script>` / `pnpm run <script>` command names. */
function scriptNamedBy(command: string): string | null {
  const match = /^pnpm (?:run )?([\w:-]+)$/.exec(command.trim());
  return match ? match[1]! : null;
}

/** An `ENV` value the runtime stage of the Dockerfile sets. */
function runtimeEnv(name: string): string | null {
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('AS runtime'));
  const match = new RegExp(`\\b${name}=(\\S+)`).exec(runtime);
  return match ? match[1]! : null;
}

describe('motir.hosting.json carries exactly the record’s fields', () => {
  it('names no key outside the record’s table', () => {
    expect(unknownKeys(manifest as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('carries every required field', () => {
    for (const key of RECORD_FIELDS.top) expect(manifest).toHaveProperty(key);
    expect(manifest.database.migrateCommand).toEqual(expect.any(String));
  });

  it('declares the Fly target only, and the Postgres this starter uses', () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      targets: ['fly'],
      port: 3000,
      healthCheck: { path: '/api/health' },
      startCommand: 'node server.js',
      buildCommand: 'pnpm build',
      requires: { websockets: false, backgroundWork: false },
      database: { kind: 'postgres' },
    });
    // No seed ships, so none is declared.
    expect(manifest.database.seedCommand).toBeUndefined();
  });

  it('a check that would refuse a key outside the table', () => {
    const extra = { ...manifest, region: 'eu', database: { ...manifest.database, pool: 5 } };
    expect(unknownKeys(extra as unknown as Record<string, unknown>)).toEqual([
      'region',
      'database.pool',
    ]);
  });
});

describe('every value is true of this repository', () => {
  it('the health path has a route file', () => {
    expect(existsSync(join(ROOT, routeFileFor(manifest.healthCheck.path)))).toBe(true);
  });

  it('the build command names a script that exists, and that script does not migrate', () => {
    const script = scriptNamedBy(manifest.buildCommand);
    expect(script).not.toBeNull();
    expect(pkg.scripts).toHaveProperty(script!);
    expect(pkg.scripts[script!]).not.toMatch(/migrate/);
  });

  it('migrations are their own script, and the image migrates with the same CLI', () => {
    expect(pkg.scripts['db:migrate']).toBe('prisma migrate deploy');
    expect(manifest.database.migrateCommand).toMatch(/prisma\/build\/index\.js migrate deploy/);
  });

  it('the image listens on the manifest’s port and starts with its start command', () => {
    expect(manifest.port).toBe(3000);
    expect(runtimeEnv('PORT')).toBe(String(manifest.port));
    const cmd = /^CMD (\[.*\])$/m.exec(dockerfile)?.[1];
    expect(cmd && (JSON.parse(cmd) as string[]).join(' ')).toBe(manifest.startCommand);
    expect(dockerfile).toMatch(/ARG MOTIR_BUILD_COMMAND="pnpm build"/);
  });

  it('the image listens on every interface, as a non-root user', () => {
    expect(runtimeEnv('HOSTNAME')).toBe('0.0.0.0');
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^EXPOSE 3000$/m);
  });

  it('next builds the standalone server the start command runs', () => {
    expect(read('next.config.ts')).toMatch(/output: 'standalone'/);
  });
});
