# `mobile/` — the Android app for the Solana dApp Store

This folder holds the **Android package** that opens the deployed Blotto Cup site inside Solana
Mobile's WebView shell. It contains no copy of the product: every screen, rule and number a player
meets comes from the site the shell opens, so the site and the app are always the same build
(decision `D-E18`). **Change the web app and the phone has the change on the next deploy; nothing
here is rebuilt for it.**

The complete manual — what differs on a phone, the build, the signing key, testing, change
control, the store submission — is **[`docs/guide/MOBILE.md`](../docs/guide/MOBILE.md)**. This
file is the short way in.

## Run the app on an emulator — the two roles

**Only a package signed with the store key works past sign-in.** A mobile wallet verifies which app
is asking by checking the package's signing certificate against the fingerprint the site publishes
at `/.well-known/assetlinks.json`; a package signed with any other key can sign in but no signature
after it completes (manual §2 item 9, §9). So there are two roles, and most people are the first.

### 1. Tester: you have the package, not the key

1. Get `app-release.apk` from the key holder (it is not secret — the store will publish it).
2. Android Studio → *Device Manager* → a Pixel with **Google Play**, **Android 15 (API 35)**. One
   emulator at a time. Start it, sign into Play, install **Phantom**, switch it to
   **Testnet mode → Solana devnet**, fund the address from the devnet faucet.
3. `adb install -r app-release.apk`, then open **Blotto Cup** from the app drawer.
4. Sign in → a pool → the board → seal. The full script, what to expect at each tap and how to
   read Phantom's log are in the manual, **§5**.

### 2. Key holder: generate, patch, build

Once per machine: Node 24, Android Studio with the SDK, and its bundled JDK on the path (manual §3
"Prerequisites"). Then, from this folder:

```bash
npx solana-mobile@0.5.0 webshell init blotto-cup --url https://www.blotto.gg --app-name "Blotto Cup" --application-id gg.blotto.app --keystore-path <outside the repository>/blotto-dappstore.jks --keystore-alias blotto
./patch-shell.sh                                  # the two patches the shell needs; idempotent
npx solana-mobile@0.5.0 webshell build blotto-cup # prompts for the key passwords if unset
adb install -r blotto-cup/app/build/outputs/apk/release/app-release.apk
```

Every line, what each does and what can go wrong: manual **§3**. Share the `.apk`; never the
`.jks`. The key's rules are **§4**.

## What is here

| Path | What it is |
|---|---|
| `patch-shell.sh` | The two patches the generated project needs before a wallet app works with it — the Android 11+ `<queries>` block, and the wallet launched with `startActivityForResult` so the wallet can verify the app. `webshell init` (0.5.0) writes neither. Run after every `init` |
| `webshell.env.example` | The two environment variable names the build reads (key passwords). Names only |
| `.gitignore` | Refuses the signing key, its passwords, build output and machine-local files |
| `blotto-cup/` | The generated Android project (solana-mobile 0.5.0, both patches applied), committed 2026-09-30. `twa-manifest.json` names the key holder's keystore path, so `webshell build blotto-cup` works there without flags; on another machine pass `--keystore-path` and `--keystore-alias` (manual §3) |

The signing key is **never** in this folder or anywhere in the repository. Nothing in `mobile/`
is built by CI; the standing-rules and language gates still read every committed file here.
