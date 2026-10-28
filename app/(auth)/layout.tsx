import { type ReactNode } from 'react';

/**
 * Shared frame for the auth pages (sign-in, sign-up, reset-password,
 * reset-password/new). A white card centered on a tinted page background.
 *
 * Rewritten in plain Tailwind from the prodect-core original, which depended
 * on a custom CSS-token design system (--color-surface, --radius-card,
 * --shadow-elevated, etc.). The look here is "reasonable and consistent
 * with a bare Tailwind app" rather than a polished brand surface — when
 * you ship your real design system, restyle this layout (and the auth
 * pages) accordingly.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-x-clip bg-zinc-50 px-6 py-12 text-zinc-900 sm:px-10">
      <main className="w-full max-w-[28rem]">
        <div className="rounded-2xl bg-white px-6 py-10 shadow-xl sm:px-10">{children}</div>
      </main>
    </div>
  );
}
