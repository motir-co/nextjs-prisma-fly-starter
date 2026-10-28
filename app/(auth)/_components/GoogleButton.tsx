'use client';

import { useState } from 'react';
import { signIn } from '@/lib/auth/client';

/**
 * "Continue with Google" button — used on /sign-in (both steps) and /sign-up.
 *
 * Triggers Better-Auth's OAuth flow via `authClient.signIn.social`. The
 * SDK returns a redirect URL; the browser navigates to Google, then back
 * through `/api/auth/callback/google`, then to `callbackURL`. We show a
 * spinner from click → navigation start; the spinner stays on if the
 * redirect throws so the user sees what went wrong via the `onError`
 * prop's parent-level alert.
 *
 * The label is "Continue with Google" — Google's branding guidelines
 * approve this phrasing across both sign-in and sign-up flows, and using
 * one string keeps the component context-free.
 *
 * Plain Tailwind only; the Google brand SVG ships inline verbatim
 * (multi-color logo, brand assets are not subject to translation).
 */
export function GoogleButton({
  callbackURL,
  onError,
}: {
  callbackURL: string;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    onError('');
    try {
      const result = await signIn.social({ provider: 'google', callbackURL });
      // Better-Auth's React client returns `{ data, error }` — if error is
      // populated the redirect never happened, so we surface it inline.
      if (result?.error) {
        setLoading(false);
        onError(humanizeOAuthError(result.error.message ?? null));
      }
      // Success path: the browser is already navigating to Google's consent
      // screen, so leave `loading=true` until the unload tears us down.
    } catch (err) {
      setLoading(false);
      onError(humanizeOAuthError(err instanceof Error ? err.message : null));
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={loading}
      aria-busy={loading}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-6 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <>
          <Spinner />
          <span>Connecting…</span>
        </>
      ) : (
        <>
          <GoogleGlyph />
          <span>Continue with Google</span>
        </>
      )}
    </button>
  );
}

// Tiny inline SVG spinner. Kept inside this file rather than added to a
// components/ui/Spinner.tsx so the bare starter stays bare.
function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// Official multi-color G per Google Identity branding guidelines
// (https://developers.google.com/identity/branding-guidelines). Inlined
// rather than fetched from gstatic so the button renders offline, in
// tests, and without a third-party network round-trip.
function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function humanizeOAuthError(_raw: string | null): string {
  // Better-Auth surfaces a few documented codes (USER_CANCELED, etc.) but
  // most provider-side failures come through as opaque strings. Keep the
  // copy short, actionable, no enumeration.
  return "Google sign-in didn't complete. Try again, or use email.";
}
