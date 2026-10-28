import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { nextCookies } from 'better-auth/next-js';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { hash, verify } from './passwords';

// Better-Auth instance. Persistence is Postgres via Prisma; password hashing
// is argon2id (overriding Better-Auth's default scrypt) so the codebase has
// exactly one password-hashing primitive — see lib/auth/passwords.ts.
//
// Google OAuth is wired as a peer sign-in method. The auto-link policy lives
// in Better-Auth's `account.accountLinking` config (trustedProviders:
// ['google']) — when a Google sign-in arrives with an email that matches an
// existing User, Better-Auth links the new Account row to that User instead
// of creating a duplicate. The security trade-off (Google-compromise →
// account takeover) is acceptable for v1 because Google has already verified
// the email; revisit if your threat model differs.
//
// Each project supplies its own Google Cloud OAuth credentials: no shared
// defaults ship. Missing creds → requiredEnv throws at module load, surfacing
// the gap loudly instead of letting the Google button error mysteriously at
// click time. If you don't need Google sign-in, remove the socialProviders
// block AND the GoogleButton from the auth pages.
//
// Password reset is wired below via emailAndPassword.sendResetPassword.
// Better-Auth mounts the request endpoint at /api/auth/request-password-reset
// and the confirm endpoint at /api/auth/reset-password automatically; reset
// tokens are stored in the existing Verification table (identifier =
// "reset-password:<token>", value = userId). No separate token table is
// needed — see the schema's Verification docstring for the wider rationale.
//
// Email verification stays off in this starter; flip
// requireEmailVerification on once you've designed the verification-email UX.

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example for the required auth env vars.`);
  }
  return value;
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),

  secret: requiredEnv('BETTER_AUTH_SECRET'),
  // baseURL is the canonical origin Better-Auth uses to build email-link
  // URLs and OAuth redirect URIs. It identifies the deployment to itself
  // but does NOT, on its own, establish which origins are allowed to call
  // the /api/auth/* endpoints — that's `trustedOrigins` below.
  //
  // Resolution order:
  //   1. BETTER_AUTH_URL — explicit override; set on production with the
  //      canonical public URL (e.g. https://your-app.vercel.app).
  //   2. VERCEL_BRANCH_URL — Vercel-injected, the stable branch-alias URL
  //      (e.g. your-app-git-<branch>-<team>.vercel.app). This is the
  //      URL browsers actually visit on preview deployments.
  //   3. VERCEL_URL — fallback to the per-deployment unique URL. Note:
  //      Vercel's docs warn this var "cannot be used in conjunction with
  //      Standard Deployment Protection," so prefer VERCEL_BRANCH_URL.
  //   4. localhost — local dev (`pnpm dev` on :3000).
  baseURL:
    process.env['BETTER_AUTH_URL'] ??
    (process.env['VERCEL_BRANCH_URL']
      ? `https://${process.env['VERCEL_BRANCH_URL']}`
      : process.env['VERCEL_URL']
        ? `https://${process.env['VERCEL_URL']}`
        : 'http://localhost:3000'),
  // trustedOrigins is the allowlist for cross-origin (and same-origin
  // with mismatched baseURL) requests to /api/auth/*. Without an explicit
  // list, Better-Auth defaults to [baseURL] — which fails for Vercel
  // previews where the request may arrive on the branch-alias URL, the
  // deployment-unique URL, or a custom domain, all pointing at the same
  // deployment. Listing all the URLs the deployment is reachable on
  // closes the gap. Filter out empty/undefined values so a missing env
  // var doesn't shrink the list to something with empty strings in it
  // (which Better-Auth would happily allow any unknown origin against).
  trustedOrigins: [
    process.env['BETTER_AUTH_URL'],
    process.env['VERCEL_BRANCH_URL'] ? `https://${process.env['VERCEL_BRANCH_URL']}` : undefined,
    process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : undefined,
    process.env['VERCEL_PROJECT_PRODUCTION_URL']
      ? `https://${process.env['VERCEL_PROJECT_PRODUCTION_URL']}`
      : undefined,
    'http://localhost:3000',
  ].filter((u): u is string => Boolean(u)),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      hash,
      verify: ({ hash: stored, password }) => verify(password, stored),
    },
    // 1 hour matches Better-Auth's default; pinned explicitly so a future
    // framework default change can't silently widen the reset-token window.
    resetPasswordTokenExpiresIn: 3600,
    // Called by Better-Auth when /api/auth/request-password-reset succeeds.
    // `url` is the canonical link to land the user on the new-password page;
    // its `token` query param is the single-use reset token (also passed as
    // a separate arg so callers don't have to parse the URL).
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        text: [
          `Hi ${user.name || ''},`,
          '',
          'We received a request to reset your password.',
          '',
          `Reset link: ${url}`,
          '',
          'This link expires in 1 hour. If you didn’t request this, you can ignore this email.',
        ].join('\n'),
        html: [
          '<p>Hi ' + (user.name || '') + ',</p>',
          '<p>We received a request to reset your password.</p>',
          `<p><a href="${url}">Reset your password</a></p>`,
          `<p>Or copy this link into your browser:<br><code>${url}</code></p>`,
          '<p>This link expires in 1 hour. If you didn’t request this, you can ignore this email.</p>',
        ].join('\n'),
      });
    },
  },

  // Rate-limit configuration. Better-Auth's rate limiter keys requests by
  // client IP (see @better-auth/core's get-request-ip.ts). We approximate
  // "3 requests/hour per email" on password-reset as "3/hour per IP for
  // /request-password-reset" — Better-Auth can't bind a rule to a body
  // field, only to a request path. A single attacker behind one IP can't
  // enumerate; the small UX cost of shared-NAT users hitting the limit is
  // acceptable for v1. Note that `enabled` defaults to `true` only in
  // production — we set it explicitly so the limiter is active in dev
  // and tests too.
  //
  // The path here is /request-password-reset (not /forget-password):
  // that's the canonical endpoint mounted by better-auth@1.6.11's
  // password.mjs route module.
  // PRODECT_FINDINGS #9: Better-Auth groups /sign-in, /sign-up,
  // /change-password, /change-email into one IP-keyed bucket (window 10s,
  // max 3). Multi-user E2E flows sign up several users from localhost (one IP)
  // inside that window and hit 429s. The `E2E_DISABLE_RATE_LIMIT=1` flag is an
  // explicit opt-in set ONLY in playwright.config.ts's webServer.env — prod
  // never sets it, so the limiter stays fully active in production.
  rateLimit: {
    enabled: process.env['E2E_DISABLE_RATE_LIMIT'] !== '1',
    customRules: {
      '/request-password-reset': {
        window: 3600,
        max: 3,
      },
    },
  },

  socialProviders: {
    google: {
      clientId: requiredEnv('GOOGLE_CLIENT_ID'),
      clientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      // When a sign-in via a trusted provider arrives with an email that
      // already exists on a local User, Better-Auth links the new Account
      // row to that User. Google is trusted because it verifies email
      // addresses before issuing tokens (the id_token's email_verified
      // claim is enforced upstream). Add new providers here only after
      // confirming the same.
      trustedProviders: ['google'],
      // Better-Auth's `requireLocalEmailVerified` defaults to `true`, which
      // gates linking on the EXISTING user.emailVerified column even when
      // the incoming provider is trusted (see better-auth's
      // oauth2/link-account.mjs line 22). The email/password sign-up does
      // NOT set emailVerified=true (the verification UX is not yet wired),
      // so leaving this default on would block the very flow
      // `trustedProviders: ['google']` was meant to enable: email-first
      // user later signing in with Google. Setting it to false defers the
      // verification gate to the provider's `userInfo.emailVerified` —
      // which for Google is enforced upstream before the id_token is
      // issued. Side benefit: better-auth then promotes the local user's
      // emailVerified to true on the linking sign-in (link-account.mjs
      // line 48), so subsequent flows see the user as verified.
      // The reverse direction (OAuth-first then email/password sign-in)
      // remains unsupported because OAuth-only users have no credential
      // Account row with a password hash.
      requireLocalEmailVerified: false,
    },
    // Refresh persisted access/refresh tokens on every sign-in so a
    // long-lived refresh token doesn't go stale. Default in Better-Auth,
    // pinned here for visibility.
    updateAccountOnSignIn: true,
  },

  // Better-Auth's default session cookie is already httpOnly + sameSite=lax
  // + secure-in-production. Pinning the explicit settings here gives future
  // env-specific overrides an obvious home.
  advanced: {
    cookies: {
      session_token: {
        attributes: {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env['NODE_ENV'] === 'production',
        },
      },
    },
  },

  // The nextCookies plugin makes Set-Cookie headers flow correctly through
  // Next.js Server Actions. Recommended for App Router.
  plugins: [nextCookies()],
});

/**
 * Server-side helper for reading the current session from a React Server
 * Component, Route Handler, or Server Action.
 *
 * Returns `null` when there is no active session. Returns the
 * `{ session, user }` object otherwise — shape is whatever Better-Auth's
 * `auth.api.getSession` returns for the current config.
 *
 * Usage:
 *   const session = await getSession();
 *   if (!session) redirect('/sign-in');
 */
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}
