import type { MetadataRoute } from 'next';
import { COPY } from '@/copy';

/*
 * The web app manifest (2026-09-28, D-E18).
 *
 * Two readers. A browser on a phone uses it to offer "add to home screen"
 * and to draw the installed page without browser chrome. Solana Mobile's
 * `webshell init --manifest` reads it to seed the Android shell's name,
 * icon and start URL, so the shell in `mobile/` and the site cannot drift
 * on those three: this file is the one source.
 *
 * The icon is public/icon.png, 512², the store's own icon size.
 * PHASE-N-REVIEW: that file is the mascot on the brand ground, generated
 * as a stand-in; the icon is art direction and the founder replaces it
 * before any store listing (docs/guide/MOBILE.md).
 *
 * The colours are the same literals layout.tsx pins for the theme-color
 * meta tag; keep both in step with --color-base in src/styles/tokens.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: COPY.shell.title,
    short_name: COPY.shell.title,
    description: COPY.shell.metaDescription,
    start_url: '/',
    display: 'standalone',
    background_color: '#5E1B40',
    theme_color: '#5E1B40',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
  };
}
