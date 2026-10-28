// Next.js instrumentation hook (Next 13.4+).
//
// Runs ONCE per Node.js server boot, before any handler runs. The default
// build does nothing; the only side effect is when E2E_TEST_OAUTH=1 is set,
// in which case we install an undici MockAgent (via lib/test-oauth-mock)
// that intercepts outbound HTTPS calls to Google's OAuth token endpoint
// and returns a synthetic id_token. That lets Playwright drive the real
// Better-Auth callback handler end-to-end without ever leaving localhost.
//
// Why dynamic import to a separate module: Next compiles instrumentation.ts
// for BOTH Node and Edge runtimes. A static `import 'undici'` or
// `import 'node:crypto'` at the top of this file would make the Edge
// bundler emit "node module in edge runtime" errors. Dynamic-importing the
// node-only helper from inside an `if (NEXT_RUNTIME === 'nodejs')` block
// hides those imports from the edge analysis entirely.
//
// Production safety: the env-gate keeps this code path completely dormant
// outside the Playwright run — `register()` returns immediately if
// E2E_TEST_OAUTH !== '1'.

export async function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if (process.env['E2E_TEST_OAUTH'] !== '1') return;

  const { installGoogleTokenMock } = await import('@/lib/test-oauth-mock');
  installGoogleTokenMock();

  // eslint-disable-next-line no-console -- instrumentation boot is the right place for this signal
  console.log('[INSTRUMENT] E2E_TEST_OAUTH active — Google token endpoint mocked.');
}
