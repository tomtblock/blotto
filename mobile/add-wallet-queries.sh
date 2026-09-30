#!/bin/sh
# Adds the Android package-visibility declaration the wallet launch needs to
# the shell's AndroidManifest.xml. Idempotent: run it after every
# `webshell init`, and again after any regeneration.
#
# WHY (2026-09-30, found on an emulator). Since Android 11 an app cannot see
# or launch another app's intent unless it declares that intent in a
# `<queries>` block. The shell reaches the wallet app through the
# `solana-wallet://` scheme; without this block the launch is silently
# refused, and the page reports "Failed to connect to the wallet websocket"
# although the wallet is installed. `webshell init` (solana-mobile 0.5.0)
# writes no `<queries>` block. A browser needs none — Chrome is exempt as
# a browser — which is why the same page works in Chrome and not in the
# shell. docs/guide/MOBILE.md §3 and §9.
#
# Usage: mobile/add-wallet-queries.sh [path/to/AndroidManifest.xml]

set -eu

MANIFEST="${1:-$(dirname "$0")/blotto-cup/app/src/main/AndroidManifest.xml}"

if [ ! -f "$MANIFEST" ]; then
  echo "add-wallet-queries: no manifest at $MANIFEST (run webshell init first)" >&2
  exit 1
fi

if grep -q 'android:scheme="solana-wallet"' "$MANIFEST"; then
  echo "add-wallet-queries: already present in $MANIFEST"
  exit 0
fi

if ! grep -q '<application' "$MANIFEST"; then
  echo "add-wallet-queries: no <application> element in $MANIFEST; not touching it" >&2
  exit 1
fi

TMP="$MANIFEST.tmp.$$"
# Insert the block immediately before the <application ...> element, at the
# manifest's top level, where Android requires it.
awk '
  /<application/ && !done {
    print "    <queries>"
    print "        <intent>"
    print "            <action android:name=\"android.intent.action.VIEW\" />"
    print "            <data android:scheme=\"solana-wallet\" />"
    print "        </intent>"
    print "    </queries>"
    print ""
    done = 1
  }
  { print }
' "$MANIFEST" > "$TMP"
mv "$TMP" "$MANIFEST"
echo "add-wallet-queries: added the solana-wallet <queries> block to $MANIFEST"
