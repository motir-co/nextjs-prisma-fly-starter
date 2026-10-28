// The single source of truth for the locale set. UI-free so it can be imported
// from anywhere — server components, client components, the `proxy`, and the
// `i18n/request.ts` request config — without dragging in React or next-intl.
//
// Adding a locale is a two-step change: drop a `messages/<code>.json` catalog in
// and add the code here (plus its dir + label). Everything else is locale-agnostic.

export const locales = ['en', 'zh'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

// Writing direction per locale. Both shipped locales are LTR today; this map is
// kept so a future RTL locale (e.g. 'fa', 'ar') only needs an entry here and the
// `<html dir>` in the root layout flips automatically — no structural change.
export const localeDir: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  zh: 'ltr',
};

// Endonyms (each language's name in its own script) for the locale switcher.
export const localeLabel: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
