'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { locales, localeLabel, type Locale } from '@/lib/i18n/locales';
import { setLocale } from '@/lib/i18n/actions';

// Minimal locale switcher for the plain starter — a native <select>. Writes the
// NEXT_LOCALE cookie via the setLocale server action inside a transition, then
// router.refresh() re-renders server components in the new locale (no full
// reload). The design starter / prodect-core ship a styled version of this.
export function LocaleToggle() {
  const current = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="Language"
      value={current}
      disabled={isPending}
      onChange={(event) => {
        const next = event.target.value as Locale;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {localeLabel[locale]}
        </option>
      ))}
    </select>
  );
}
