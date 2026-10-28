'use server';

import { cookies } from 'next/headers';
import { isLocale, type Locale } from '@/lib/i18n/locales';

// Persists the user's locale choice in the NEXT_LOCALE cookie (next-intl's
// default cookie name, matching i18n/request.ts). The client calls this from a
// transition and then router.refresh() so server components re-render with the
// new locale — the same UX as the theme toggle, but server-readable.
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // one year
    sameSite: 'lax',
  });
}
