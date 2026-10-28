import { createAuthClient } from 'better-auth/react';

// Browser-safe Better-Auth client. Pair with lib/auth/index.ts which is the
// server instance — that file imports next/headers + Prisma and CANNOT be
// imported from a client component (importing it will fail the build with
// module-resolution errors). All client components doing sign-in / sign-up
// / signOut go through this file.
//
// baseURL: read from the public env var so the client can resolve the API
// origin in both browser and SSR contexts. Defaults to '' which Better-Auth
// resolves to the current origin at request time — works for local dev and
// for any single-origin deployment. Multi-origin setups must set
// NEXT_PUBLIC_BETTER_AUTH_URL explicitly. We deliberately don't read
// BETTER_AUTH_URL (the server var) — that one isn't exposed to the browser
// and would be undefined at runtime, silently falling back to current origin.

export const authClient = createAuthClient({
  baseURL: process.env['NEXT_PUBLIC_BETTER_AUTH_URL'] ?? '',
});

export const { signIn, signOut, signUp, useSession } = authClient;
