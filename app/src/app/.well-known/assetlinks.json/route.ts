/*
 * GET /.well-known/assetlinks.json — the Android package's identity, for the
 * mobile wallet's verifier (src/channel/android-app.ts says why).
 *
 * The verifier is strict about the response: `200`, content type EXACTLY
 * `application/json` (no charset), no redirect. It is a public document by
 * definition — it names a package and a certificate fingerprint, both
 * readable from the published package — so it is cacheable.
 */
import { assetLinks } from '@/channel/android-app';

export function GET() {
  return new Response(JSON.stringify(assetLinks()), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
