'use client';

/*
 * The channel, as a React value (see channel.ts for what it is).
 *
 * Read through useSyncExternalStore with a SERVER snapshot of 'web': the
 * server has no user agent to read, so it renders every page as the web
 * page, the browser hydrates against that same markup, and only then
 * re-renders with the channel it actually is. A direct `navigator` read
 * during render would make the shell's first paint disagree with the
 * server's and React would refuse the hydration.
 */

import { useSyncExternalStore } from 'react';
import { channelOf, type Channel } from './channel';

// The user agent never changes within a page's life, so there is nothing to
// subscribe to; the store exists for its server/client snapshot split.
const subscribe = (): (() => void) => () => {};
const getSnapshot = (): Channel =>
  channelOf(typeof navigator === 'undefined' ? undefined : navigator.userAgent);
const getServerSnapshot = (): Channel => 'web';

/** The channel this page is shown on. 'web' on the server and during hydration. */
export function useChannel(): Channel {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
