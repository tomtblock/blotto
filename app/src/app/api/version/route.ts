/*
 * GET /api/version — which build this server is serving (D-E18).
 *
 * The one line the play page compares itself against before sealing an
 * entry (src/build/version.ts). The value is the SAME inlined constant the
 * browser bundle carries, so a page and the server that built it always
 * agree, and a page left open across a deploy does not. It is a public,
 * unauthenticated fact — the commit hash of an open-source deployment — and
 * carries nothing else.
 *
 * Never cached: a CDN copy of an old answer would make a fresh page read as
 * stale, or a stale one as fresh.
 */
import { NextResponse } from 'next/server';
import { BUILD_VERSION } from '@/build/version';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ version: BUILD_VERSION }, { headers: { 'cache-control': 'no-store' } });
}
