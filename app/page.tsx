import { getTranslations } from 'next-intl/server';
import { Card } from '@motir/design-system';
import { LocaleToggle } from '@/components/LocaleToggle';

export default async function Home() {
  const t = await getTranslations('home');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card data-surface="card" className="flex w-full max-w-[36rem] flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight text-(--el-text) sm:text-5xl">
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
    </main>
  );
}
