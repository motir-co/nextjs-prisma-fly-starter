import { type ReactNode } from 'react';

/**
 * Per-page content block inside the auth column. Renders the headline +
 * optional subhead, then the slotted body (form fields, buttons, footer
 * link). Spacing here is what gives every auth page the same vertical
 * rhythm — keep it here, not on individual pages.
 *
 * Plain Tailwind only; no design-token imports. See app/(auth)/layout.tsx
 * for the wrapping card frame.
 */
export function AuthShell({
  headline,
  subhead,
  children,
}: {
  headline: string;
  subhead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
          {headline}
        </h1>
        {subhead ? <p className="text-base text-zinc-500">{subhead}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Horizontal "OR" divider used to separate the Google button from the
 * email form on sign-in / sign-up.
 */
export function OrDivider() {
  return (
    <div
      className="flex items-center gap-4"
      role="separator"
      aria-orientation="horizontal"
      aria-label="or"
    >
      <span className="h-px flex-1 bg-zinc-200" aria-hidden />
      <span className="text-xs uppercase tracking-wider text-zinc-500">OR</span>
      <span className="h-px flex-1 bg-zinc-200" aria-hidden />
    </div>
  );
}

/**
 * Top-of-form inline error banner — used for OAuth errors and other
 * page-scoped failures that aren't tied to a single field.
 */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600"
    >
      <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-12a1 1 0 00-1 1v3a1 1 0 102 0V7a1 1 0 00-1-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
          />
        </svg>
      </span>
      <span>{children}</span>
    </div>
  );
}
