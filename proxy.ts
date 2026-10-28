import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

// Optimistic cookie-presence check on every incoming request to a
// protected route: if no session cookie is present, bounce to /sign-in.
// This is the pattern Better-Auth recommends — full session validation
// (a DB call) is too expensive to run on every request. Each protected
// page/route still re-checks the session server-side via `getSession()`
// for actual enforcement.
//
// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
// (https://nextjs.org/docs/messages/middleware-to-proxy). The exported
// function is now `proxy`, and Proxy defaults to the Node.js runtime
// rather than Edge — Better-Auth's `getSessionCookie` works in both.
//
// The matcher below targets the /app/(authed)/* route group. The (authed)
// segment is a Next.js route group — it groups files but doesn't add a
// URL segment — so its children are matched by their actual URL paths.
// We list those URL paths in `config.matcher` rather than trying to match
// the route-group name.
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Every URL that maps to a file under /app/(authed)/* must be listed
  // here. As new authed routes are added, append them to this list.
  matcher: ['/dashboard/:path*'],
};
