'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { signUp } from '@/lib/auth/client';
import { AuthShell, OrDivider, FormAlert } from '../_components/AuthShell';
import { GoogleButton } from '../_components/GoogleButton';

/**
 * Sign-up. Two-step:
 *
 *   step 'identity' — Google button + Email + Continue.
 *   step 'password' — Password field with the 8-char helper, Continue
 *                     button that creates the account.
 *
 * The `name` field is NOT collected from the user. Better-Auth's user
 * schema requires a `name` column (NOT NULL); we derive it from the
 * email localpart at create-time and let the user edit it later in
 * profile settings.
 *
 * Errors:
 *   - Email already taken → inline, with a link back to /sign-in.
 *   - Password too short  → inline on the field (8 chars min).
 *   - Other failures      → top-of-form FormAlert with a generic message.
 *
 * Plain Tailwind only.
 */
export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpShell />}>
      <SignUpForm />
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

function SignUpShell() {
  return (
    <AuthShell headline="Create your account" subhead="Welcome to your new app.">
      <div className="flex flex-col gap-5" aria-hidden />
    </AuthShell>
  );
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = searchParams.get('next') ?? '/dashboard';

  const [step, setStep] = useState<'identity' | 'password'>('identity');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // pageError is seeded from `?error=` once during initial render.
  const [pageError, setPageError] = useState(() =>
    searchParams.get('error') ? "Google sign-up didn't complete. Try again, or use email." : '',
  );
  const [emailExists, setEmailExists] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function onContinueIdentity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPageError('');
    setEmailExists(false);
    if (!email.trim()) return;
    setStep('password');
  }

  async function onCreateAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError('');
    setPageError('');
    setEmailExists(false);

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp.email({
        email,
        password,
        // Better-Auth's user schema requires a non-null `name`. We never
        // ask the user for one; derive a default from the email localpart
        // that the user can override later in profile settings.
        name: email.split('@')[0]!,
        callbackURL,
      });
      if (result?.error) {
        // Better-Auth surfaces these as { code, message }. We map the two
        // common ones to inline UI; everything else falls through to the
        // top-of-form alert.
        const code = result.error.code ?? '';
        if (
          code.startsWith('USER_ALREADY_EXISTS') ||
          /already exists/i.test(result.error.message ?? '')
        ) {
          setEmailExists(true);
          setStep('identity');
        } else if (code === 'PASSWORD_TOO_SHORT' || /password/i.test(result.error.message ?? '')) {
          setPasswordError('Password must be at least 8 characters.');
        } else {
          setPageError('Something went wrong. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      router.push(callbackURL);
    } catch {
      setPageError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <AuthShell headline="Create your account" subhead="Welcome to your new app.">
      {pageError ? <FormAlert>{pageError}</FormAlert> : null}

      {step === 'identity' ? (
        <form onSubmit={onContinueIdentity} className="flex flex-col gap-5" noValidate>
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
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailExists) setEmailExists(false);
              }}
              aria-label="Email address"
              aria-invalid={emailExists ? true : undefined}
              aria-describedby={emailExists ? 'email-error' : 'email-help'}
              required
              autoFocus
              className={emailExists ? INPUT_ERROR : INPUT_BASE}
            />
            {emailExists ? (
              <p id="email-error" className="text-sm text-red-600">
                An account with this email already exists.
              </p>
            ) : (
              <p id="email-help" className="text-sm text-zinc-500">
                We&apos;ll use this to sign you in.
              </p>
            )}
          </div>
          {emailExists ? (
            <p className="-mt-2 text-sm text-zinc-700">
              <Link href={{ pathname: '/sign-in' }} className={LINK}>
                Sign in instead →
              </Link>
            </p>
          ) : null}
          <button type="submit" className={PRIMARY_BTN}>
            Continue
          </button>
          <FooterLink prompt="Already have an account?" linkText="Log in" href="/sign-in" />
        </form>
      ) : (
        <form onSubmit={onCreateAccount} className="flex flex-col gap-5" noValidate>
          {/* Identity recap — read-only, click "Edit" to flip back. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex h-11 w-full items-center gap-2 rounded-md bg-zinc-100 px-3">
              <span className="flex-1 truncate text-sm text-zinc-900">{email}</span>
            </div>
            <button
              type="button"
              onClick={() => setStep('identity')}
              className="self-start text-xs text-zinc-700 hover:text-zinc-900 focus-visible:outline-none focus-visible:underline"
            >
              Edit
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-zinc-700">
              Password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                name="new-password"
                autoComplete="new-password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'pw-error' : 'pw-help'}
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
              <p id="pw-error" className="text-sm text-red-600">
                {passwordError}
              </p>
            ) : (
              <p id="pw-help" className="text-sm text-zinc-500">
                At least 8 characters.
              </p>
            )}
          </div>

          <button type="submit" className={PRIMARY_BTN} disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>

          <FooterLink prompt="Already have an account?" linkText="Log in" href="/sign-in" />
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
