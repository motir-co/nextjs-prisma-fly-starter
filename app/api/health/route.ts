// The health route every deploy waits on before it sends traffic (MOTIR-9810 ·
// MOTIR-9811; `healthCheck.path` in motir.hosting.json, which the Fly
// Machine's health check polls).
//
// It reports that the PROCESS serves requests — not that the database is
// reachable. A suspended serverless database, or a preview without Google
// credentials, must not mark a good release as broken. So this file is a LEAF:
// it imports nothing from the app's own modules, least of all `lib/auth` or
// `lib/db`, which throw at module load when their variables are missing.

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}
