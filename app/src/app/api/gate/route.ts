/*
 * POST /api/gate — exchange the code for the admission cookie.
 *
 * A refusal carries no reason: a wrong code, an empty body and an unconfigured
 * deployment all return the same 401, the same rule the packet service's
 * GENERIC_REJECTION follows. Nothing here is ever logged.
 */
import { NextResponse } from 'next/server';
import {
  GATE_COOKIE,
  GATE_COOKIE_MAX_AGE,
  constantTimeEqual,
} from '@/gate/gate';

function refused() {
  return NextResponse.json({ ok: false }, { status: 401 });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === 'string' ? body.code : '';

  const expected = process.env.GATE_CODE ?? '';
  const secret = process.env.GATE_COOKIE_SECRET ?? '';

  // Fail closed on an unconfigured deployment: no code admits anyone.
  if (expected === '' || secret === '') return refused();
  if (!constantTimeEqual(code, expected)) return refused();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: GATE_COOKIE_MAX_AGE,
  });
  return res;
}
