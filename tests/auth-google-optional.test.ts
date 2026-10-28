import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// GOOGLE SIGN-IN IS OPTIONAL (MOTIR-9810). A preview has no Google credentials
// (hosting record §9), so the app must start and sign people in by email with
// them unset — and offer Google, and register its provider, only with both set.
// BETTER_AUTH_SECRET is still required.

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshAuth() {
  vi.resetModules();
  return (await import('@/lib/auth')).auth;
}

async function providerIds(): Promise<string[]> {
  const auth = await freshAuth();
  const options = auth.options as { socialProviders?: Record<string, unknown> };
  return Object.keys(options.socialProviders ?? {});
}

describe('the Google provider', () => {
  it.each([
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID'],
  ])('is not registered with %s unset, and auth still loads', async (unset, set) => {
    vi.stubEnv(unset, '');
    vi.stubEnv(set, 'present');
    expect(await providerIds()).toEqual([]);
  });

  it('is registered when both are set', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    expect(await providerIds()).toEqual(['google']);
  });

  it('a missing BETTER_AUTH_SECRET still fails the first auth import, naming it', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    await expect(freshAuth()).rejects.toThrow(/BETTER_AUTH_SECRET is not set/);
  });
});

describe('the "is Google configured?" reader', () => {
  it('needs both credentials', async () => {
    const { isGoogleConfigured } = await import('@/lib/auth/google');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(isGoogleConfigured()).toBe(false);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    expect(isGoogleConfigured()).toBe(true);
  });
});

describe('the auth pages offer Google only when the server says it is configured', () => {
  it.each([
    ['sign-in', 'SignInPage'],
    ['sign-up', 'SignUpPage'],
  ])('%s', (route, component) => {
    const page = read(`app/(auth)/${route}/page.tsx`);
    // The page is a server component that asks the one reader, per request.
    expect(page).not.toMatch(/'use client'/);
    expect(page).toContain(`<${component} googleEnabled={isGoogleConfigured()} />`);
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/);
    // The client form renders the button (and its divider) behind that flag only.
    const form = read(`app/(auth)/${route}/${component}.tsx`);
    expect(form).toMatch(/\{googleEnabled \? \(\s*<>\s*<GoogleButton/);
    expect(form.match(/<GoogleButton/g)).toHaveLength(1);
  });
});
