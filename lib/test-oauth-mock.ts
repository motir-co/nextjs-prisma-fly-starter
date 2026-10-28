// Node-only Google OAuth token-endpoint mock for E2E.
//
// Pulled out of instrumentation.ts so the imports of node:crypto and
// node:fs/promises never get analyzed by Next's Edge-runtime bundler.
// instrumentation.ts dynamic-imports this file ONLY when E2E_TEST_OAUTH=1
// AND NEXT_RUNTIME=nodejs, which keeps the production code path totally
// dormant.
//
// What the mock does:
//   - Replaces the global undici dispatcher.
//   - Intercepts POST https://oauth2.googleapis.com/token with a fixed
//     synthetic token response. The id_token is a properly-formed JWT
//     whose payload Better-Auth's google provider decodes (no signature
//     check on this code path, since `getUserInfo` uses jose's `decodeJwt`
//     directly — `verifyIdToken` is a separate sign-in-with-id-token
//     path we don't exercise).
//   - Reads the per-test user identity from E2E_TEST_OAUTH_USER_PATH on
//     each invocation so a single dev-server run can serve multiple
//     sequential E2E tests with different synthetic users.
//
// CRITICAL — undici version coupling:
//   The undici devDep is pinned to ^6.x specifically because Node 22
//   ships with built-in undici@6.x (process.versions.undici). Node's
//   `globalThis.fetch` uses the built-in dispatcher; calling
//   `setGlobalDispatcher` from a *different major* of the undici package
//   silently sets a dispatcher on the wrong copy of undici and the
//   intercept never fires. If a future Node upgrade bumps the bundled
//   undici to v7+, bump this devDep in lockstep.

import { MockAgent, setGlobalDispatcher } from 'undici';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = enc({ alg: 'HS256', typ: 'JWT', kid: 'test' });
  const body = enc({
    iss: 'https://accounts.google.com',
    aud: process.env['GOOGLE_CLIENT_ID'] ?? 'test',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const sig = createHmac('sha256', 'test-only-not-a-real-secret')
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

export function installGoogleTokenMock(): void {
  const TEST_USER_PATH =
    process.env['E2E_TEST_OAUTH_USER_PATH'] ?? '/tmp/starter-test-oauth-user.json';

  const agent = new MockAgent();
  // Allow real network for everything we don't explicitly intercept (so
  // Prisma's TCP to Postgres still works). MockAgent's default is to
  // disable net-connect once enableNetConnect() is unset; we call it
  // explicitly to be unambiguous.
  agent.enableNetConnect();

  const pool = agent.get('https://oauth2.googleapis.com');
  pool
    .intercept({ path: '/token', method: 'POST' })
    .reply(
      200,
      async () => {
        let profile: { sub: string; email: string; name: string; emailVerified: boolean };
        try {
          const raw = await readFile(TEST_USER_PATH, 'utf8');
          profile = JSON.parse(raw) as typeof profile;
        } catch {
          profile = {
            sub: 'test-sub-default',
            email: 'google-e2e@example.com',
            name: 'Google E2E',
            emailVerified: true,
          };
        }
        const idToken = makeJwt({
          sub: profile.sub,
          email: profile.email,
          name: profile.name,
          email_verified: profile.emailVerified,
          picture: 'https://example.com/avatar.png',
        });
        return {
          access_token: `mock-access-token-${profile.sub}`,
          refresh_token: `mock-refresh-token-${profile.sub}`,
          id_token: idToken,
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid email profile',
        };
      },
      { headers: { 'content-type': 'application/json' } },
    )
    .persist();

  setGlobalDispatcher(agent);
}
