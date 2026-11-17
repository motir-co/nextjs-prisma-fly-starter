import { getTranslations } from 'next-intl/server';
import { Card } from '@motir/design-system';
import { LocaleToggle } from '@/components/LocaleToggle';
import { ProjectBackground } from '@/components/ProjectBackground';

// The element ids the two backgrounds gather around (motir.design.json's
// `backgrounds.landing` and `backgrounds.hero`): the page's around the hero
// section, the hero's around the card that is its main control.
const HERO_SECTION_ID = 'home-hero';
const HERO_CARD_ID = 'home-hero-card';

export default async function Home() {
  const t = await getTranslations('home');

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center p-6">
      <ProjectBackground area="landing" focusId={HERO_SECTION_ID} />
      <section
        id={HERO_SECTION_ID}
        aria-labelledby="home-title"
        className="relative isolate flex w-full max-w-[44rem] justify-center overflow-hidden rounded-(--radius-card) border border-(--el-border-soft) bg-(--el-page-bg) px-4 py-12 sm:px-12 sm:py-16"
      >
        <ProjectBackground area="hero" focusId={HERO_CARD_ID} />
        <Card
          id={HERO_CARD_ID}
          data-surface="card"
          className="flex w-full max-w-[36rem] flex-col gap-6"
        >
          <div className="flex flex-col gap-3">
            <h1
              id="home-title"
              className="text-4xl font-semibold tracking-tight text-(--el-text) sm:text-5xl"
            >
              {t('title')}
            </h1>
            <p className="text-base text-(--el-text-muted)">
              {t.rich('editHint', {
                code: (chunks) => (
                  <code className="rounded-(--radius-control) bg-(--el-muted) px-1.5 py-0.5 font-mono text-(--el-text-secondary)">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-(--el-border-soft) pt-5">
            <a
              href="/tokens"
              className="text-sm font-medium text-(--el-link) underline-offset-2 hover:underline"
            >
              /tokens
            </a>
            <LocaleToggle />
          </div>
        </Card>
      </section>
    </main>
  );
}
