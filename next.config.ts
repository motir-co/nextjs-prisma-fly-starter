import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Wires next-intl's request config (./i18n/request.ts by default) into the build.
const withNextIntl = createNextIntlPlugin();

// PRODECT_FINDINGS #3: `next build`'s "Collecting page data" step evaluates
// every route module, transitively importing `lib/auth/index.ts` and running
// its module-level `requiredEnv('GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET')`.
// A local checkout (or `git worktree`) whose `.env` omits the OAuth vars then
// fails `next build` on routes that have zero coupling to Google.
//
// The placeholders below are inert build-time stand-ins — they only let the
// module-load `requiredEnv` checks pass; they never authenticate against
// Google (no OAuth round-trip happens during a build). Gated to non-production
// so a production deploy that genuinely lacks the creds still fails loud at the
// first /api/auth request. On Vercel both Production and Preview carry real
// creds, so the `??=` never overwrites anything there.
if (process.env['NODE_ENV'] !== 'production') {
  process.env['GOOGLE_CLIENT_ID'] ??= 'build-time-placeholder-client-id';
  process.env['GOOGLE_CLIENT_SECRET'] ??= 'build-time-placeholder-client-secret';
  process.env['BETTER_AUTH_SECRET'] ??= 'build-time-placeholder-secret-32-bytes-minimum';
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
