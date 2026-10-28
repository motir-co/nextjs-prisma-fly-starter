'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '../../_components/AuthShell';

/**
 * The "set a new password" landing page reached from the email link.
 *
 * Wiring: when the user clicks the reset link in their email, Better-Auth's
 * GET /api/auth/reset-password/:token validates the token and redirects to
 * `redirectTo` (set by the previous page to `${origin}/reset-password/new`)
 * with `?token=<token>` appended. On invalid/expired token it redirects
 * with `?error=INVALID_TOKEN`.
 *
 * Better-Auth always uses a QUERY param for the token (see
 * node_modules/better-auth/.../password.mjs — `redirectCallback(callbackURL,
 * { token })`), so a dynamic segment can't capture it. This route is
 * therefore a static `/new` segment that reads `?token=` from search params.
 *
 * Plain Tailwind only.
 */
export default function NewPasswordPage() {
  return (
    <Suspense fallback={<NewPasswordShell />}>
      <NewPasswordForm />
    </Suspense>
  );
}

const PRIMARY_BTN =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-6 text-base font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_BTN =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-6 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2';
const INPUT_BASE =
  'block h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1';
const INPUT_ERROR =
  'block h-11 w-full rounded-md border border-red-500 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1';

function NewPasswordShell() {
  return (
    <AuthShell
      headline="Set a new password"
      subhead="Pick something you haven't used before — at least 8 characters."
    >
      <div className="flex flex-col gap-5" aria-hidden />
    </AuthShell>
  );
}

function NewPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const callbackError = searchParams.get('error');

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pageError, setPageError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Invalid/expired token path — rendered as a clean error state with a
  // clear path forward (request a new link). This is what the user lands
  // on if they clicked an old email or a tampered URL.
  if (callbackError === 'INVALID_TOKEN' || !token) {
    return (
      <AuthShell
        headline="This link has expired"
        subhead="Reset links expire after 1 hour for security. Request a new one to continue."
      >
        <div className="flex flex-col gap-4">
          <Link href="/reset-password" className={PRIMARY_BTN}>
            Request a new link
          </Link>
          <Link href="/sign-in" className={SECONDARY_BTN}>
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell headline="Password updated" subhead="You can now sign in with your new password.">
        <Link href="/sign-in" className={PRIMARY_BTN}>
          Continue to sign in
        </Link>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPageError('');
    setFieldError('');
    if (password.length < 8) {
      setFieldError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (res.ok) {
        setSuccess(true);
        // Hint the router so a future re-render doesn't get stuck on the
        // pending search params from the prior URL.
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (body.code === 'INVALID_TOKEN') {
        // Bounce to the expired-link state via the same query param the
        // callback uses, so the early-return branch above renders the
        // recovery UI.
        router.replace('/reset-password/new?error=INVALID_TOKEN');
        return;
      }
      setPageError(body.message ?? 'Something went wrong. Please try again.');
      setSubmitting(false);
    } catch {
      setPageError("We couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      headline="Set a new password"
      subhead="Pick something you haven't used before — at least 8 characters."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {pageError ? <FormAlert>{pageError}</FormAlert> : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-sm font-medium text-zinc-700">
            New password
          </label>
          <div className="relative">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              name="new-password"
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="New password"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'pw-error' : 'pw-help'}
              required
              autoFocus
              className={`${fieldError ? INPUT_ERROR : INPUT_BASE} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-2 my-auto inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          {fieldError ? (
            <p id="pw-error" className="text-sm text-red-600">
              {fieldError}
            </p>
          ) : (
            <p id="pw-help" className="text-sm text-zinc-500">
              At least 8 characters.
            </p>
          )}
        </div>
        <button type="submit" className={PRIMARY_BTN} disabled={submitting}>
          {submitting ? 'Updating…' : 'Set new password'}
        </button>
      </form>
    </AuthShell>
  );
}
