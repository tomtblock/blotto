/*
 * Host-aware admission for the pre-launch gate (proxy, formerly middleware) (see src/gate/gate.ts).
 *
 * Runs before every non-asset request. On a gated host an unadmitted visitor is
 * redirected to /gate; on any other host — the Vercel alias, previews, local —
 * the request is untouched.
 *
 * Fails CLOSED: with GATE_COOKIE_SECRET unset, no cookie can ever match, so a
 * misconfigured deployment locks the door rather than leaving it open.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GATE_COOKIE, gatedHosts, normalizeHost } from '@/gate/gate';

export function proxy(req: NextRequest) {
  const host = normalizeHost(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
  );
  if (!gatedHosts(process.env.GATE_HOSTS).has(host)) {
    return NextResponse.next();
  }

  const secret = process.env.GATE_COOKIE_SECRET ?? '';
  const admitted = secret !== '' && req.cookies.get(GATE_COOKIE)?.value === secret;

  const { pathname, search } = req.nextUrl;
  const isGateSurface = pathname === '/gate' || pathname === '/api/gate';

  let res: NextResponse;
  if (admitted || isGateSurface) {
    res = NextResponse.next();
  } else {
    const url = req.nextUrl.clone();
    url.pathname = '/gate';
    url.search =
      pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    res = NextResponse.redirect(url);
  }

  // A gated domain must not enter a search index while it is gated.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|woff|woff2)$).*)',
  ],
};
