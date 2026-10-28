'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { signIn } from '@/lib/auth/client';
import { AuthShell, OrDivider, FormAlert } from '../_components/AuthShell';
import { GoogleButton } from '../_components/GoogleButton';

/**
 * Two-step sign-in:
 *
 *   step 'email'    — Google button + email field + Continue.
 *   step 'password' — email read-only, password field, "Forgot password?"
 *                     link ABOVE the password field, Continue button.
 *
 * One route, internal state. The URL stays /sign-in throughout. On wrong
 * password, the user stays on step 2 and sees an inline error.
 *
 * The "Forgot password?" position is ABOVE the password field — that's
 * the Clay sign-in pattern, not the more common below-field placement.
 *
 * Plain Tailwind only.
 */
export default function SignInPage() {
  // useSearchParams must be wrapped in Suspense for Next 16's static
  // pre-rendering — the suspense boundary lets the static shell stream
  // while the search params resolve client-side.
  return (
    <Suspense fallback={<SignInShell />}>
      <SignInForm />
    </Suspense>
  );
}

const PRIMARY_BTN =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-6 text-base font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const INPUT_BASE =
  'block h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1';
const INPUT_ERROR =
  'block h-11 w-full rounded-md border border-red-500 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1';
const LINK = 'font-medium text-zinc-900 underline-offset-2 hover:underline';

function SignInShell() {
  return (
    <AuthShell headline="Welcome back!" subhead="Sign in to continue.">
      <div className="flex flex-col gap-5" aria-hidden />
    </AuthShell>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = searchParams.get('next') ?? '/dashboard';

  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // pageError is seeded from a `?error=` query param (Better-Auth bounces
  // back here on a denied/failed Google consent). Seed it once during
  // initial render via useState's lazy initializer; pulling it out of the
  // URL into local state avoids the cascading-render trap that
  // useEffect+setState would create.
  const [pageError, setPageError] = useState(() =>
    searchParams.get('error') ? "Google sign-in didn't complete. Try again, or use email." : '',
  );
  const [passwordError, setPasswordError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function onContinueEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPageError('');
    if (!email.trim()) return;
    // We DON'T pre-check the email server-side here — that would enumerate
    // accounts. Always advance to the password step; the password submit
    // surfaces the unified "email or password is wrong" error if either
    // is invalid.
    setStep('password');
  }

  async function onSubmitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError('');
    setPageError('');
    if (!password) return;
    setSubmitting(true);
    try {
      const result = await signIn.email({ email, password, callbackURL });
      if (result?.error) {
        // Unified error message — no enumeration.
        setPasswordError("That password isn't right. Try again, or reset it.");
        setSubmitting(false);
        return;
      }
      router.push(callbackURL);
    } catch {
      setPasswordError("That password isn't right. Try again, or reset it.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell headline="Welcome back!" subhead="Sign in to continue.">
      {pageError ? <FormAlert>{pageError}</FormAlert> : null}

      {step === 'email' ? (
        <form onSubmit={onContinueEmail} className="flex flex-col gap-5" noValidate>
          {/* Google button first — tab order is Google → email → continue. */}
          <GoogleButton callbackURL={callbackURL} onError={setPageError} />
          <OrDivider />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-zinc-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
              required
              autoFocus
              className={INPUT_BASE}
            />
          </div>
          <button type="submit" className={PRIMARY_BTN} disabled={submitting}>
            {submitting ? 'Checking…' : 'Continue'}
          </button>
          <FooterLink prompt="Don't have an account?" linkText="Sign up" href="/sign-up" />
        </form>
      ) : (
        <form onSubmit={onSubmitPassword} className="flex flex-col gap-5" noValidate>
          {/* Email recap — read-only display, click to edit. */}
          <div className="flex flex-col gap-1.5">
            <div
              className="flex h-11 w-full items-center gap-2 rounded-md bg-zinc-100 px-3"
              aria-label={`Signing in as ${email}`}
            >
              <span className="flex-1 truncate text-sm text-zinc-900">{email}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setPassword('');
                setPasswordError('');
              }}
              className="self-start text-xs text-zinc-700 hover:text-zinc-900 focus-visible:outline-none focus-visible:underline"
            >
              Use a different email
            </button>
          </div>

          {/* Forgot password — ABOVE the field, per the Clay pattern. */}
          <Link
            href="/reset-password"
            className="self-start text-sm font-medium text-zinc-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            Forgot password?
          </Link>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'password-error' : undefined}
                required
                autoFocus
                className={`${passwordError ? INPUT_ERROR : INPUT_BASE} pr-10`}
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
            {passwordError ? (
              <p id="password-error" className="text-sm text-red-600">
                {passwordError}
              </p>
            ) : null}
          </div>

          <button type="submit" className={PRIMARY_BTN} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Continue'}
          </button>

          <FooterLink prompt="Don't have an account?" linkText="Sign up" href="/sign-up" />
        </form>
      )}
    </AuthShell>
  );
}

function FooterLink({
  prompt,
  linkText,
  href,
}: {
  prompt: string;
  linkText: string;
  href: string;
}) {
  return (
    <p className="text-sm text-zinc-700">
      {prompt}{' '}
      <Link href={href} className={LINK}>
        {linkText}
      </Link>
    </p>
  );
}
