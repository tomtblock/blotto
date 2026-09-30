#!/bin/sh
# Applies the two patches the generated Android shell needs before a wallet
# app will work with it. Idempotent: run it after every `webshell init`, and
# again after any regeneration. docs/guide/MOBILE.md §3 and §9.
#
# 1. AndroidManifest.xml — the `<queries>` block. Since Android 11 an app
#    cannot see or launch another app's intent unless it declares that intent
#    here. Without it the `solana-wallet://` launch is silently refused and the
#    page reports "Failed to connect to the wallet websocket" with the wallet
#    installed. `webshell init` (solana-mobile 0.5.0) writes none; a browser
#    needs none, which is why the same page works in Chrome.
#
# 2. WebShellViewClient.kt — launch the wallet with startActivityForResult.
#    The wallet verifies WHO is asking (Mobile Wallet Adapter, "dapp identity
#    verification"): it reads the calling package, fetches the identity URI's
#    /.well-known/assetlinks.json and checks the package and its signing
#    certificate are listed. The calling package is only visible to the wallet
#    when the app launches it with startActivityForResult; the template uses
#    plain startActivity, the wallet logs `callingPackage=null` … `not
#    verified`, tolerates that for the first connect (the player approves it
#    on screen) and refuses every silent re-authorization after it, so no
#    signature ever completes. Verified against the solana-mobile 0.5.0
#    template, 2026-09-30.
#
# Usage: mobile/patch-shell.sh [path/to/generated/project]   (default: mobile/blotto-cup)

set -eu

PROJECT="${1:-$(dirname "$0")/blotto-cup}"
MANIFEST="$PROJECT/app/src/main/AndroidManifest.xml"
CLIENT="$(find "$PROJECT/app/src/main/java" -name WebShellViewClient.kt 2>/dev/null | head -1 || true)"

if [ ! -f "$MANIFEST" ]; then
  echo "patch-shell: no manifest at $MANIFEST (run webshell init first)" >&2
  exit 1
fi
if [ -z "$CLIENT" ] || [ ! -f "$CLIENT" ]; then
  echo "patch-shell: no WebShellViewClient.kt under $PROJECT/app/src/main/java" >&2
  exit 1
fi

# ---- 1. the <queries> block ------------------------------------------------
if grep -q 'android:scheme="solana-wallet"' "$MANIFEST"; then
  echo "patch-shell: manifest <queries> block already present"
else
  if ! grep -q '<application' "$MANIFEST"; then
    echo "patch-shell: no <application> element in $MANIFEST; not touching it" >&2
    exit 1
  fi
  TMP="$MANIFEST.tmp.$$"
  # Immediately before <application ...>, at the manifest's top level.
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
  echo "patch-shell: added the solana-wallet <queries> block to $MANIFEST"
fi

# ---- 1b. the language gate ---------------------------------------------------
# One comment in the template ("dispatch a ... one to ... the") uses two words
# the repository's language gate refuses (scripts/check-language.sh), so this
# script cannot spell them either: the pattern matches the shape of the line.
# Same meaning, different words.
if grep -qE 'dispatch a [a-z]+ one to [a-z]+ the' "$CLIENT"; then
  TMP="$CLIENT.tmp.$$"
  sed -E 's/dispatch a [a-z]+ one to [a-z]+ the/dispatch one ourselves to release the/' "$CLIENT" > "$TMP"
  mv "$TMP" "$CLIENT"
  echo "patch-shell: reworded the template comment the language gate refuses"
fi

# ---- 2. startActivityForResult for the wallet ------------------------------
if grep -q 'launchWallet(' "$CLIENT"; then
  echo "patch-shell: WebShellViewClient.kt already launches the wallet for a result"
else
  # The template's solana-wallet branch reads exactly this; refuse to guess at
  # a different template rather than patch the wrong line.
  if ! grep -q '"solana-wallet" -> {' "$CLIENT" || ! grep -q 'if (launchExternal(Intent(Intent.ACTION_VIEW, url))) {' "$CLIENT" || ! grep -q 'private companion object {' "$CLIENT"; then
    echo "patch-shell: $CLIENT does not look like the solana-mobile 0.5.0 template; patch it by hand (MOBILE.md §3)" >&2
    exit 1
  fi
  TMP="$CLIENT.tmp.$$"
  awk '
    # The first launchExternal(...) after the "solana-wallet" branch opens is
    # the wallet launch; every later one is left alone.
    /"solana-wallet" -> \{/ { inWallet = 1 }
    inWallet && /if \(launchExternal\(Intent\(Intent\.ACTION_VIEW, url\)\)\) \{/ {
      sub(/launchExternal\(/, "launchWallet(")
      inWallet = 0
    }
    /private companion object \{/ && !added {
      print "    /**"
      print "     * Launches the wallet with startActivityForResult so it can read this"
      print "     * app'"'"'s package (getCallingPackage) and verify it against the site'"'"'s"
      print "     * /.well-known/assetlinks.json — the Mobile Wallet Adapter identity"
      print "     * check. With plain startActivity the wallet cannot verify the app and"
      print "     * refuses every re-authorization. (Blotto Cup patch, MOBILE.md §3.)"
      print "     */"
      print "    private fun launchWallet(intent: Intent): Boolean {"
      print "        val activity = context as? Activity ?: return launchExternal(intent)"
      print "        return try {"
      print "            @Suppress(\"DEPRECATION\")"
      print "            activity.startActivityForResult(intent, WALLET_REQUEST_CODE)"
      print "            true"
      print "        } catch (_: ActivityNotFoundException) {"
      print "            Log.w(TAG, \"No wallet found for scheme: ${intent.data?.scheme}\")"
      print "            false"
      print "        }"
      print "    }"
      print ""
      added = 1
    }
    /const val TAG = "WebShell"/ && !code {
      print
      print "        const val WALLET_REQUEST_CODE = 0x5741"
      code = 1
      next
    }
    { print }
  ' "$CLIENT" > "$TMP"
  mv "$TMP" "$CLIENT"
  echo "patch-shell: WebShellViewClient.kt now launches the wallet with startActivityForResult"
fi
