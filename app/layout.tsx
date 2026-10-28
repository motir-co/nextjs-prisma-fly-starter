import type { Metadata } from 'next';
import {
  Fraunces,
  IBM_Plex_Mono,
  Inter,
  JetBrains_Mono,
  Source_Serif_4,
  Space_Grotesk,
} from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import {
  buildThemeInitScript,
  HandDrawnFilter,
  ImmersiveTilt,
  resolveAxesToApplied,
  ThemeProvider,
  ToastProvider,
} from '@motir/design-system';
import { localeDir, type Locale } from '@/lib/i18n/locales';
import './globals.css';

/**
 * Variable fonts loaded via Next.js's self-hosting font loader for Motir's
 * TYPE axis (Axis 3). Each font is exposed as a `--font-*-SOURCE` CSS variable
 * — the RAW face. `@motir/design-system/theme.css` composes the role token off
 * it (`--font-sans: var(--font-sans-source, <system fallbacks>)`) and each
 * `[data-type='…']` block re-points a role at a different `-source` var. That
 * indirection is what the type axis requires: the loader variable MUST be the
 * `-source` name — naming it the bare role token (`--font-sans`) leaves every
 * `var(--font-*-source)` reference unresolved and the whole UI silently falls
 * back to system faces.
 *
 * The base three (sans / serif / mono) dress the default `motir` type pairing;
 * the other three feed the non-default pairings (mono-technical / grotesk /
 * editorial) and only pay their download weight when that pairing is selected.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-sans-source', display: 'swap' });
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif-source',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-source',
  display: 'swap',
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono-technical-source',
  display: 'swap',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk-source',
  display: 'swap',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-editorial-source',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Next.js + Prisma + Vercel + Neon starter',
  description:
    'Production-ready starter with the discovered gotchas baked in: postinstall prisma generate, DATABASE_URL_UNPOOLED for migrations, Prisma 7 conditional config, Node 22+. Skinned with the Motir 3-axis design system.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale comes from the NEXT_LOCALE cookie (resolved in i18n/request.ts), so
  // <html lang/dir> is correct on the first byte — no client flash. Messages are
  // passed to the provider explicitly because cookie/no-routing mode does not
  // auto-supply them to client components.
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();

  // The DEFAULT design: the registry defaults (Colour `motir` · Style
  // `warm-editorial` · Type `motir`). A fresh scaffold has no server-side
  // appearance store — the anonymous path — so the three server-resolvable axes
  // render straight onto <html> for a designed first paint, and the FOUC init
  // script below reconciles any localStorage choice the visitor has made.
  // (When a real product wires user appearance persistence, swap `null` for the
  // user's stored `AppliedAppearanceDto` here and in ThemeProvider, exactly as
  // motir-core does.)
  const applied = resolveAxesToApplied({});

  return (
    <html
      lang={locale}
      dir={localeDir[locale]}
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${ibmPlexMono.variable} ${spaceGrotesk.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
      data-style={applied.styleId}
      data-palette={applied.paletteId}
      data-type={applied.typeId}
    >
      <head>
        {/*
          FOUC prevention: run before React hydrates to apply the visitor's
          saved appearance to <html>. `data-theme` (light/dark) in particular
          resolves from `system` via matchMedia on the client, so it can only be
          set here. Anonymous path — the script reads localStorage and falls
          back to the registry defaults baked into the package.

          Safety: `buildThemeInitScript(null)` is a static, compile-time string
          (no per-request/user input flows into it) with `<` escaped. This is
          the standard theme-init pattern (next-themes, shadcn/ui) and is
          XSS-safe because the content is fixed.
        */}
        <script dangerouslySetInnerHTML={{ __html: buildThemeInitScript(null) }} />
      </head>
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider initialPreference={null} signedIn={false}>
            {/* Pointer-parallax engine for the 3D / Immersive style — inert for
                every other style and under reduced motion. */}
            <ImmersiveTilt />
            {/* Hidden SVG roughen filter for the Hand-Drawn / Indie style —
                referenced by the token CSS only under that style, inert
                otherwise. */}
            <HandDrawnFilter />
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
