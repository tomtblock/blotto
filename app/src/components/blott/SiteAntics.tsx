'use client';

/*
 * The site-wide performers (Antics.tsx), mounted once in the root layout.
 * Not on the play route — nothing decorative competes with the fifteen-
 * second clock — and not on the dev/admin surfaces. The runner keeps clear
 * of the tab bar where one is present (every tabbed page uses h-16).
 */

import { usePathname } from 'next/navigation';
import { Peeker, Runner } from './Antics';

const QUIET_PREFIXES = ['/play', '/dev', '/admin', '/signin'];
const TABBED_PREFIXES = ['/pools', '/profile', '/wallet', '/rules', '/verify', '/custody', '/fair-play'];

export function SiteAntics() {
  const pathname = usePathname() ?? '/';
  if (QUIET_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const tabbed = TABBED_PREFIXES.some((p) => pathname.startsWith(p));
  return (
    <>
      <Runner bottom={tabbed ? 64 : 0} />
      <Peeker side={pathname === '/' ? 'right' : 'left'} />
    </>
  );
}
