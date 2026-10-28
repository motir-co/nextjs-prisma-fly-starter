import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, isLocale } from '@/lib/i18n/locales';

// next-intl's per-request configuration (the "without i18n routing" setup). The
// active locale is read from the NEXT_LOCALE cookie — there is no `[locale]`
// route segment — so server components, server actions, and generateMetadata all
// resolve the same locale for the request. createNextIntlPlugin() in
// next.config.ts points at this file by default (./i18n/request.ts).
//
// Reading the cookie here opts request rendering into the dynamic path; the
// authed routes are already dynamic (session), so this is not a new cost there.
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    // Relative path (not the @/ alias) so the bundler can statically glob the
    // messages/ directory and code-split each catalog.
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
