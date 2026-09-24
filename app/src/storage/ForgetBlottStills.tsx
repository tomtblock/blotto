'use client';

/*
 * Mounted once in the root layout: on the first page load of a visit, drop
 * the retired Blott stills database (forget-blott-stills.ts). Renders
 * nothing. It can come out once devices that visited before 2026-09-24 have
 * had time to return; it costs one no-op call per visit until then.
 */

import { useEffect } from 'react';
import { forgetBlottStills } from './forget-blott-stills';

export function ForgetBlottStills() {
  useEffect(() => {
    forgetBlottStills();
  }, []);
  return null;
}
