import { type ReactNode } from 'react';
import { ProjectBackground } from '@/components/ProjectBackground';

/** The auth card, which motir.design.json's `backgrounds.login` gathers around. */
const AUTH_CARD_ID = 'auth-card';

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
 *
 * Behind the card it draws the project's `login` background from
 * motir.design.json (`none` draws nothing). `relative isolate` gives the frame
 * its own stacking context, so the background's `-z-10` canvas sits above the
 * page fill and below the card.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen w-full items-center justify-center overflow-x-clip bg-zinc-50 px-6 py-12 text-zinc-900 sm:px-10">
      <ProjectBackground area="login" focusId={AUTH_CARD_ID} />
      <main className="w-full max-w-[28rem]">
        <div id={AUTH_CARD_ID} className="rounded-2xl bg-white px-6 py-10 shadow-xl sm:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
