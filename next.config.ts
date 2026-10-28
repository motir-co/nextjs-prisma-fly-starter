import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Wires next-intl's request config (./i18n/request.ts by default) into the build.
const withNextIntl = createNextIntlPlugin();

// PRODECT_FINDINGS #3: `next build`'s "Collecting page data" step evaluates
// every route module, transitively importing `lib/auth/index.ts` and running
// its module-level `requiredEnv('BETTER_AUTH_SECRET')`. A local checkout (or
// `git worktree`) whose `.env` omits it then fails `next build` on routes that
// have nothing to do with auth.
//
// The placeholder below is an inert build-time stand-in — it only lets the
// module-load check pass; it never signs a real session. Gated to
// non-production so a production deploy that genuinely lacks the secret still
// fails loud at the first /api/auth request. Google sign-in needs no
// placeholder: it is optional, and registered only when both of its variables
// are set (lib/auth/google.ts). The image build (Dockerfile) supplies its own
// build-stage placeholders, which never reach the runtime image.
if (process.env['NODE_ENV'] !== 'production') {
  process.env['BETTER_AUTH_SECRET'] ??= 'build-time-placeholder-secret-32-bytes-minimum';
}

const nextConfig: NextConfig = {
  // One artifact for every host: `next build` emits a self-contained
  // `.next/standalone` server (`node server.js`) that the Dockerfile copies into
  // a slim runtime image that Motir's hosting runs on Fly Machines — see
  // motir.hosting.json.
  output: 'standalone',
};

export default withNextIntl(nextConfig);
