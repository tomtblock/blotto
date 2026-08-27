# Step report — the custody disclosure page (`step/c13-custody-page`, C13)

**Status: delivered.** Item C13 of the 2026-08-27 master build prompt (D-C)
— the LAST item of the ordered list.

**Stacks on the re-key** (`step/rekey-program-id`), which stacks on C12.

## What was built

- **`config/custody.json`** — the founder-owned values: program id
  (committed at the new `5aaw…` id), upgrade authority, multisig threshold
  / member count / timelock hours, and the holder of each operational key.
  Everything except the program id ships `null`.
- **`app/src/app/custody/`** — the public page, generated entirely from
  that config plus architecture facts (what each key CAN and CANNOT do —
  fixed by the program, stated as mechanics per the D-B7 lexicon). A null
  config value renders an explicit *"not yet set"* — the page never
  invents a number, and the threshold renders "n of m" only when BOTH
  halves are set (a partial config cannot produce "3 of null").
- **The key inventory** (seven rows): admin multisig (switches and signer
  rotation — cannot move money), entry signer (admits entrants — cannot
  pay itself), settlement signer (drives settlement — cannot choose
  amounts or recipients; the program validates every payout list), the
  per-pool sealing keys (export-locked until seal), the platform wallet
  (the 20% at seal + forfeits — nothing from an open pool), the
  publishing wallet (pays for permanent storage — cannot alter results),
  and the reviewer wallets (signed public decisions — release to the
  entrant or forfeit to the platform, never to themselves).

## Judgement calls

1. **The page is not yet linked from the tab bar.** Where it surfaces
   (footer, rules-tab link, nav) is founder-owned placement; the route
   `/custody` is live and the rules tab's verify posture suggests linking
   it from there once the founder picks the spot.
2. **The pool-sealing row's holder derives from the settlement signer's
   provisioning state** — the per-pool keys exist only once custody is
   provisioned, so before that the row honestly reads "not yet set".

## Tests

App 180 vitest (4 new): the program id comes from config and matches the
committed value; unset multisig values are null; every inventory row
carries real can/cannot mechanics; the n-of-m guard. Typecheck, lint,
production build (the `/custody` route prerenders) and all three gates
clean.

## For the founder

`config/custody.json` is yours. As provisioning completes, fill in: the
upgrade authority (the Squads vault address), threshold + member count +
timelock, and each key's holder ("Turnkey sub-org", the wallet addresses).
The page updates on the next deploy; until then every unset value says
"not yet set" in public — which is itself the honest disclosure.
