# Fix: a failed entry must not bar a wallet from the pool

**Status:** specified, NOT applied. The change lives in `app/` and `backend/`, which are outside the
battle test's source boundary. This document is the patch, ready for a product PR the founder
ratifies.

**The defect:** `DRIFT.md` §H6 · **Founder-facing:** `REPORT.md` §2 F-4 · **Decision:** F-24.

---

## What is wrong, in one paragraph

A player's sealed allocation is stored before the entry service is asked for permission
(`app/src/entry/submit.ts:99-100`). The store refuses a second, *different* allocation for a seat
that already has one. A replay is always different, because the salt is fresh. No delete path
exists. So any failure after the seal — a refused packet, a dismissed wallet prompt, a closed
laptop, a dropped connection — bars that wallet from that pool permanently, having paid nothing.
The player is shown a generic refusal that says "trying again will not change the answer", which is
true for a reason nobody can discover.

**Funding the accounts does not fix this.** A dry signing quota was the trigger on 2026-09-16; it is
one cause among many. Every other cause survives a fully funded platform.

---

## Why the existing protection is right, and what it is actually protecting against

`backend/packet/src/ciphertexts.ts` gate 3 exists because the ciphertext write happens before the
chain's duplicate check (audit D-01). Without it, a player who starts a second run destroys their
own **paid** entry: the chain holds `battles_hash` from the first run, the store would hold the
second run's bytes, and at reveal the two would not match — so the entry is scored all losses, as
the published lost-ciphertext rule says.

Note what gate 2 already guarantees: only the wallet itself can write its own ciphertext, because
the write is signature-verified against the player's key. So this is not protection from an
attacker. It is protection from the player's own second run.

**The protection is aimed at the right harm and uses the wrong test.** It asks "does a ciphertext
already exist?" when the question that matters is "**has this seat been paid for yet?**" Those
coincide only after the register lands. Before it, they are opposites: a stored ciphertext with no
registered seat is an *abandoned attempt*, and replacing it harms nobody.

---

## The fix — three parts, in order of importance

### 1. Gate the overwrite on whether the seat is registered (backend) — the actual fix

`acceptCiphertext` already has the means: it queries the indexer's Postgres through
`PoolIdResolver` for the pool's id and state. The same database holds the `entries` projection,
keyed by pool and player (`backend/indexer/src/read-api.ts:286`). One more indexed read on a
connection the service already holds.

Replace gate 3 in `backend/packet/src/ciphertexts.ts`:

```ts
  // ---- 3. no overwrite of a PAID seat ------------------------------------
  // What must never be overwritten is a seat the chain has already accepted:
  // the chain holds that run's battles_hash, and replacing the ciphertext
  // under it scores the entry all losses. A ciphertext with NO registered
  // seat is an abandoned attempt — replacing it harms nobody, and refusing
  // it bars that wallet from the pool for good (DRIFT.md §H6).
  //
  // Fails CLOSED: if the seat lookup cannot answer, refuse the overwrite.
  // The cost of a wrong refusal is one retry; the cost of a wrong allowance
  // is a player's paid entry.
  const existing = await store.get(pool.id, submission.player);
  if (existing && !sameBytes(existing.ciphertext, submission.ciphertext)) {
    const seated = await seats.isRegistered(pool.id, submission.player);
    if (seated !== false) {
      return { status: 409, body: { error: 'already sealed' } };
    }
  }
```

with a resolver alongside `PgPoolIdResolver`, same shape, same fail-closed posture:

```ts
export interface SeatResolver {
  /** True when an Entry exists for this pool and player, false when it does
   * not, null when the projection could not answer. Never guesses. */
  isRegistered(poolId: bigint, player: string): Promise<boolean | null>;
}

export class PgSeatResolver implements SeatResolver {
  constructor(private readonly db: Queryable) {}
  async isRegistered(poolId: bigint, player: string): Promise<boolean | null> {
    try {
      const r = await this.db.query(
        'SELECT 1 FROM entries WHERE pool = $1 AND player = $2 LIMIT 1',
        [poolId.toString(), player]
      );
      return r.rowCount > 0;
    } catch {
      return null; // caller refuses — see the fail-closed note above
    }
  }
}
```

**The residual race, named rather than hidden.** The `entries` projection lags the chain by the
indexer's catch-up time. A player who registers and then re-seals inside that window would be
allowed an overwrite that harms them. It requires deliberate action, by the wallet holder, against
their own entry, in a seconds-wide window — and the outcome is the documented all-losses rule with
its operator alert, not a silent loss. Weighed against permanently barring every player who has a
transient failure, this is the better trade by a wide margin. An implementation that wants the race
closed too should read the `Entry` PDA over RPC instead of the projection; that is authoritative and
costs one `getAccountInfo`, but adds a chain dependency to a service that currently has none.

**Test to add:** a ciphertext may be replaced while no Entry row exists, and may not once one does.

### 2. Ask permission before sealing (app) — narrows the window

`app/src/entry/submit.ts:99-100`, swap the two calls:

```ts
  const packet = await services.requestPacket(input.pool, input.player);
  await services.putCiphertext(input.pool, input.player, ciphertext);
```

This closes the exact sequence that struck on 2026-09-16, where the gate refused *after* the seal.
It does **not** close the window between the ciphertext write and the register, which is why it is
second and not first. Ship it with part 1, not instead of it.

### 3. Let a wallet ask whether it is sealed (backend + app) — makes it detectable

The lockout is not only irreversible, it is **invisible**. There is no way for a player, an
operator, or a support agent to discover that a wallet is barred. `battle-test/scripts/preflight.ts`
runs every check that can be run from outside and still reported GO for two wallets that were
already barred, because the question cannot be asked.

Add a wallet-authenticated read — the wallet signs the same canonical message it signs to write, so
this respects "no public reader of the sealed boxes" exactly:

```
POST /ciphertexts/status  { pool, player, signature }  →  200 { sealed: boolean } | 403
```

It returns a boolean and never the ciphertext. Once it exists, `preflight.ts` gains the check it is
missing, and the app can tell a returning player the truth instead of a generic refusal.

### 4. While the lockout can still happen: say something true (app)

`app/src/copy/index.ts` renders the same `entryRefused` copy for a 409 `already sealed` as for a
genuine eligibility refusal. A player who failed mid-entry is told they are not allowed to enter.
`EntryServiceError` already carries `stage` and `status`, so the app can distinguish them without
the service leaking anything: a 409 at the `ciphertext` stage is not an eligibility decision and
must not be dressed as one.

---

## Verification

1. **Reproduce first.** Seal for a wallet on an open pool, do not register, then seal again with
   different bytes: `409 already sealed` today. (`battle-test` measured exactly this on 2026-09-16 —
   first seal `204`, identical bytes `204`, different bytes `409`.)
2. With part 1 applied, the same sequence returns `204` and the wallet can still enter.
3. Register the seat, then attempt an overwrite: `409`, protection intact.
4. Kill the packet service mid-entry, then retry the entry: it succeeds.
5. Point the seat resolver at a broken database: overwrites are refused, not allowed.

## What this is worth

On devnet it cost a pool and an evening. On mainnet a single entry-service blip does not merely fail
the entries in flight: it bars every player who reached the seal from that pool for good, silently,
and can leave the pool unable to fill with players who would gladly have paid. It converts a
ten-minute incident into permanent damage and a queue of players who cannot be helped, because there
is not even a way to confirm what happened to them.
