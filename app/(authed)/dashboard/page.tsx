// SMOKE ROUTE — placeholder.
// Proves that the (authed) route group is gated by /proxy.ts and that
// server-side getSession() returns a populated session for an authenticated
// request. Replace with your real dashboard.

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getSession } from '@/lib/auth';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const t = await getTranslations('dashboard');
  const tc = await getTranslations('common');

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>{t('title')}</h1>
      <p>
        {t.rich('signedInAs', {
          email: session.user.email,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
      <pre style={{ background: '#f4f4f4', padding: 12, fontSize: 12 }}>
        {JSON.stringify(session, null, 2)}
      </pre>
      <form action="/api/auth/sign-out" method="post">
        <button type="submit">{tc('signOut')}</button>
      </form>
    </main>
  );
}
