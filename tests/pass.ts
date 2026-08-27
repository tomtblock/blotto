// Character pass tests — Collection creation with a permanent freeze, bare member
// mint, and the negative case that makes the whole design worth having: a minted
// pass cannot be transferred.
//
// Carried from the predecessor repository's `tests/create-collection-asset.ts` and
// `tests/freeze-propagation.ts`, merged into one suite because Blotto Cup has one
// object to test rather than two, and **with the unfreeze cases deleted**.
//
// === What was dropped, and why ===
// The predecessor's freeze suite had three cases: attach the freeze, THAW it at the
// end of a collection's launch lifecycle, and reject a thaw before that point. Only
// the first is carried. The instruction that did the thawing was not extracted, and
// there is no thaw path in this program — the character pass is non-transferable for
// the life of the asset (PID §3, §8.4). A test asserting that something can be
// unfrozen would be asserting the opposite of the requirement.
//
// === What was added ===
// Case (d), the transfer-rejection probe. The predecessor deliberately did NOT do
// this: minting a member into a program-owned Core Collection needed a
// Collection-PDA-signed mint that only its `pack_open` provided, so it read the
// plugin flag instead and leaned on the devnet Q-016 run for propagation. Blotto Cup
// carries `mint_pass`, so the whole loop is available here — mint a real pass, try to
// move it, assert it will not move. That is the assertion the legal position
// actually rests on, and it should not live only in an archived devnet report.
//
// Per `docs/reference/q-016-verification-note.md`, a frozen-member transfer fails
// with **`InvalidAuthority` (`0x9`)**, not `AssetIsFrozen` (`0xa`) — the freeze plugin
// force-rejects inside the lifecycle validator. The assertion below matches on
// failure occurring and, where the logs are available, on that signature.
//
// === Why the Pool is mocked ===
// `open_pool` does not exist yet (see EXTRACTION-REPORT.md); Phase 0 carried
// instructions, not a program. The Pool PDA is written directly via
// `surfnet_setAccount`. TODO(phase-1): replace `mockPool` with a real `open_pool`
// call. The helper is shared in shape with tests/vrf.ts.
//
// Runner: Surfpool. The program is driven via `@anchor-lang/core`; the Core
// Collection and Asset are deserialized with the official
// `@metaplex-foundation/mpl-core` SDK (1.10.0) over a `@metaplex-foundation/umi`
// instance pointed at the local Surfpool RPC. The mpl-core program is loaded from
// the genesis fixture in Anchor.toml, so the suite runs offline.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import {
  fetchAssetV1,
  fetchCollectionV1,
  mplCore,
  transferV1,
} from "@metaplex-foundation/mpl-core";
import { createHash } from "crypto";
import { expect } from "chai";

import { BlottoCup } from "../target/types/blotto_cup";

const { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

// Metaplex Core program ID (source: docs/reference/q-016-verification-note.md;
// matches the `address` constraint on `mpl_core_program` in pass.rs).
const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);

// Seed prefixes — must mirror programs/blotto_cup/src/state.rs.
const POOL_SEED = Buffer.from("pool");
const PASS_COLLECTION_SEED = Buffer.from("pass_collection");

// Pool account layout — mirrors state.rs `Pool`.
// disc(8) || id: u64 || state: u8 || vrf_seed: [u8; 32] || bump: u8
const POOL_ACCOUNT_LEN = 8 + 8 + 1 + 32 + 1;
const POOL_OFF_STATE = 8 + 8;
const POOL_OFF_VRF_SEED = 8 + 8 + 1;
const POOL_STATE_OPEN = 0;
const POOL_STATE_SEALED = 1;

/// Anchor's account discriminator: the first 8 bytes of sha256("account:<Name>").
function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

describe("character pass (create_pass_collection + mint_pass)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = anchor.workspace.blottoCup as Program<BlottoCup>;

  const umi = createUmi(connection.rpcEndpoint).use(mplCore());

  let nextPoolId = 1000n; // offset from tests/vrf.ts so the two suites never collide

  // ---- low-level helpers -------------------------------------------------

  async function rpc(method: string, params: unknown[]): Promise<any> {
    const res = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(`${method} failed: ${JSON.stringify(json.error)}`);
    }
    return json.result;
  }

  async function setAccount(
    pubkey: anchor.web3.PublicKey,
    fields: { lamports: number; owner: string; data: Buffer },
  ): Promise<void> {
    await rpc("surfnet_setAccount", [
      pubkey.toBase58(),
      {
        lamports: fields.lamports,
        owner: fields.owner,
        data: fields.data.toString("hex"),
        executable: false,
      },
    ]);
  }

  async function airdrop(
    pubkey: anchor.web3.PublicKey,
    sol: number,
  ): Promise<void> {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // ---- pool setup --------------------------------------------------------

  interface MockedPool {
    poolId: bigint;
    poolPda: anchor.web3.PublicKey;
    passCollectionPda: anchor.web3.PublicKey;
  }

  function derivePdas(poolId: bigint): {
    poolPda: anchor.web3.PublicKey;
    bump: number;
    passCollectionPda: anchor.web3.PublicKey;
  } {
    const idLe = Buffer.alloc(8);
    idLe.writeBigUInt64LE(poolId);
    const [poolPda, bump] = PublicKey.findProgramAddressSync(
      [POOL_SEED, idLe],
      program.programId,
    );
    const [passCollectionPda] = PublicKey.findProgramAddressSync(
      [PASS_COLLECTION_SEED, poolPda.toBuffer()],
      program.programId,
    );
    return { poolPda, bump, passCollectionPda };
  }

  /// Write a Pool straight into the ledger. `seeded` controls whether vrf_seed is
  /// committed — `mint_pass` requires a committed seed, `create_pass_collection`
  /// does not.
  async function mockPool(
    opts: { state?: number; seeded?: boolean } = {},
  ): Promise<MockedPool> {
    const { state = POOL_STATE_OPEN, seeded = true } = opts;
    const poolId = nextPoolId++;
    const { poolPda, bump, passCollectionPda } = derivePdas(poolId);

    const data = Buffer.alloc(POOL_ACCOUNT_LEN);
    accountDiscriminator("Pool").copy(data, 0);
    data.writeBigUInt64LE(poolId, 8);
    data.writeUInt8(state, POOL_OFF_STATE);
    if (seeded) {
      // Any non-zero value satisfies the committed-seed guard. The class this would
      // produce is cosmetic and read by nothing in scoring (PID §8.4), so the
      // specific bytes are irrelevant to every assertion in this file.
      Buffer.alloc(32, 0xab).copy(data, POOL_OFF_VRF_SEED);
    }
    data.writeUInt8(bump, POOL_ACCOUNT_LEN - 1);

    await setAccount(poolPda, {
      lamports: 10_000_000,
      owner: program.programId.toBase58(),
      data,
    });

    return { poolId, poolPda, passCollectionPda };
  }

  // ---- instruction wrappers ----------------------------------------------

  async function createPassCollection(
    pool: MockedPool,
    name: string,
    uri: string,
    payer: anchor.web3.Keypair,
  ): Promise<string> {
    return program.methods
      .createPassCollection(new anchor.BN(pool.poolId.toString()), name, uri)
      .accountsPartial({
        signer: payer.publicKey,
        pool: pool.poolPda,
        passCollection: pool.passCollectionPda,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
  }

  async function mintPass(
    pool: MockedPool,
    player: anchor.web3.Keypair,
    passAsset: anchor.web3.Keypair,
    classIndex: number,
  ): Promise<string> {
    return program.methods
      .mintPass(new anchor.BN(pool.poolId.toString()), classIndex)
      .accountsPartial({
        player: player.publicKey,
        pool: pool.poolPda,
        passAsset: passAsset.publicKey,
        passCollection: pool.passCollectionPda,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player, passAsset])
      .rpc();
  }

  /// A pool with its pass Collection already created, plus a funded player.
  async function poolWithCollection(): Promise<{
    pool: MockedPool;
    player: anchor.web3.Keypair;
  }> {
    const pool = await mockPool();
    const payer = Keypair.generate();
    await airdrop(payer.publicKey, 5);
    await createPassCollection(
      pool,
      "Blotto Cup Pass",
      "https://example.invalid/pass.json",
      payer,
    );
    const player = Keypair.generate();
    await airdrop(player.publicKey, 5);
    return { pool, player };
  }

  // ---- tests -------------------------------------------------------------

  it("(a) create_pass_collection attaches PermanentFreezeDelegate { frozen: true }, authority = UpdateAuthority (Pool PDA)", async () => {
    const pool = await mockPool();
    // A fresh funded signer exercises the permissionless path — nobody privileged
    // needs to create the Collection, because the update authority is fixed to the
    // Pool PDA regardless of who pays.
    const payer = Keypair.generate();
    await airdrop(payer.publicKey, 5);

    const name = "Blotto Cup Pass";
    const uri = "https://example.invalid/pass.json";
    await createPassCollection(pool, name, uri, payer);

    // 1. The Collection PDA exists and is owned by the mpl-core program.
    const acct = await connection.getAccountInfo(pool.passCollectionPda);
    expect(acct, "pass_collection account must exist").to.not.be.null;
    expect(
      acct!.owner.equals(MPL_CORE_PROGRAM_ID),
      "pass_collection must be owned by the mpl-core program",
    ).to.be.true;

    // 2. Deserialize via the mpl-core SDK and assert the contract fields.
    const core = await fetchCollectionV1(
      umi,
      publicKey(pool.passCollectionPda.toBase58()),
    );
    expect(
      core.updateAuthority.toString(),
      "update authority must be the Pool PDA, never a human",
    ).to.equal(pool.poolPda.toBase58());
    expect(core.name, "name must match the arg").to.equal(name);
    expect(core.uri, "uri must match the arg").to.equal(uri);

    // 3. The freeze plugin is attached and reads frozen: true, with authority
    //    UpdateAuthority — which resolves to the Pool PDA above. That resolution is
    //    the precondition that makes the freeze trustless: only a Pool-PDA-signed
    //    CPI could ever mutate it, and this program contains no such instruction.
    const pfd = (core as any).permanentFreezeDelegate;
    expect(pfd, "PermanentFreezeDelegate must be attached").to.not.be.undefined;
    expect(pfd.frozen, "the freeze plugin must read frozen: true at create").to.be
      .true;
    expect(
      pfd.authority?.type,
      "the freeze plugin authority must be UpdateAuthority",
    ).to.equal("UpdateAuthority");
  });

  it("(b) double-create rejection: a second create_pass_collection fails (account already exists)", async () => {
    const pool = await mockPool();
    const payer = Keypair.generate();
    await airdrop(payer.publicKey, 5);

    await createPassCollection(
      pool,
      "Blotto Cup Pass",
      "https://example.invalid/pass.json",
      payer,
    );

    // The second create reuses the same accounts. The mpl-core create CPI fails
    // because the Collection account is already initialized — that is the write-once
    // guard. Match on failure occurring, not on the error string.
    const second = Keypair.generate();
    await airdrop(second.publicKey, 5);

    let threw = false;
    try {
      await createPassCollection(
        pool,
        "Blotto Cup Pass",
        "https://example.invalid/pass.json",
        second,
      );
    } catch {
      threw = true;
    }
    expect(threw, "second create_pass_collection must fail").to.be.true;
  });

  it("(c) non-Open rejection: create_pass_collection on a sealed pool rejects", async () => {
    const pool = await mockPool({ state: POOL_STATE_SEALED });
    const payer = Keypair.generate();
    await airdrop(payer.publicKey, 5);

    let threw = false;
    try {
      await createPassCollection(
        pool,
        "Blotto Cup Pass",
        "https://example.invalid/pass.json",
        payer,
      );
    } catch {
      threw = true;
    }
    expect(threw, "create_pass_collection on a non-Open pool must fail").to.be
      .true;
  });

  it("(d) mint_pass mints a bare member owned by the player, inheriting the collection freeze", async () => {
    const { pool, player } = await poolWithCollection();
    const passAsset = Keypair.generate();

    await mintPass(pool, player, passAsset, 0);

    const asset = await fetchAssetV1(
      umi,
      publicKey(passAsset.publicKey.toBase58()),
    );

    expect(asset.owner.toString(), "the player must own the pass").to.equal(
      player.publicKey.toBase58(),
    );
    expect(
      asset.updateAuthority.type,
      "the pass must belong to the pool's Collection",
    ).to.equal("Collection");
    expect(
      asset.updateAuthority.address?.toString(),
      "the pass must be a member of THIS pool's Collection",
    ).to.equal(pool.passCollectionPda.toBase58());

    // Minted BARE. No member-level plugins — non-transferability is inherited from
    // the Collection-level freeze, and attaching a member plugin post-mint panics in
    // mpl-core 1.10 (see the module doc on pass.rs). If this assertion ever fails,
    // something has started attaching plugins at the member level and the reason it
    // must not needs re-reading before the test is changed.
    expect(
      (asset as any).permanentFreezeDelegate,
      "the member must be minted bare — no member-level freeze plugin",
    ).to.be.undefined;
  });

  it("(e) a minted pass CANNOT be transferred — the collection freeze holds", async () => {
    // This is the case the product's legal position rests on (PID §8.2, §8.4): the
    // pass is a prize of no value because it is soulbound, so there is no market for
    // it and no competitive effect. If this test ever passes a transfer, the
    // three-element analysis in PID §8.2 no longer holds and that is a counsel
    // question, not a test to update.
    const { pool, player } = await poolWithCollection();
    const passAsset = Keypair.generate();
    await mintPass(pool, player, passAsset, 0);

    // Drive the transfer through the mpl-core SDK as the asset's own owner — the
    // most favourable possible case for the attacker. Per the Q-016 devnet run the
    // freeze also holds against a granted TransferDelegate, so the owner path is the
    // strictly weaker requirement and the one worth pinning here.
    const ownerSigner = umi.eddsa.createKeypairFromSecretKey(player.secretKey);
    const umiAsOwner = createUmi(connection.rpcEndpoint)
      .use(mplCore())
      .use(keypairIdentity(ownerSigner));

    const recipient = Keypair.generate();

    let threw = false;
    let message = "";
    try {
      await transferV1(umiAsOwner, {
        asset: publicKey(passAsset.publicKey.toBase58()),
        collection: publicKey(pool.passCollectionPda.toBase58()),
        newOwner: publicKey(recipient.publicKey.toBase58()),
      }).sendAndConfirm(umiAsOwner);
    } catch (e) {
      threw = true;
      message = String(e);
    }

    expect(threw, "transferring a frozen pass must fail").to.be.true;

    // The freeze rejection surfaces as InvalidAuthority (0x9), NOT AssetIsFrozen
    // (0xa) — the plugin force-rejects inside the lifecycle validator. See
    // docs/reference/q-016-verification-note.md. The check is a soft one because
    // error surfacing differs between the SDK, the RPC and the simulator; the hard
    // assertion is that the transfer failed at all, above.
    const looksLikeFreeze =
      /0x9\b/.test(message) ||
      /InvalidAuthority/i.test(message) ||
      /permanent_freeze_delegate/i.test(message) ||
      /frozen/i.test(message);
    expect(
      looksLikeFreeze,
      `transfer must fail for freeze reasons; got: ${message}`,
    ).to.be.true;

    // And the pass has not moved.
    const asset = await fetchAssetV1(
      umi,
      publicKey(passAsset.publicKey.toBase58()),
    );
    expect(
      asset.owner.toString(),
      "the pass must still belong to the original player",
    ).to.equal(player.publicKey.toBase58());
  });

  it("(f) mint_pass against a pool with no committed VRF seed rejects", async () => {
    // A class drawn from a zero seed is not a draw. The guard exists so a pass can
    // never be minted before the pool's randomness is committed.
    const pool = await mockPool({ seeded: false });
    const payer = Keypair.generate();
    await airdrop(payer.publicKey, 5);
    await createPassCollection(
      pool,
      "Blotto Cup Pass",
      "https://example.invalid/pass.json",
      payer,
    );

    const player = Keypair.generate();
    await airdrop(player.publicKey, 5);
    const passAsset = Keypair.generate();

    let threw = false;
    try {
      await mintPass(pool, player, passAsset, 0);
    } catch {
      threw = true;
    }
    expect(threw, "mint_pass without a committed VRF seed must fail").to.be.true;
  });

  it("(g) the program contains no path that can thaw a pass", async () => {
    // A structural assertion rather than a behavioural one: the guarantee is the
    // ABSENCE of an instruction, and absence cannot be probed by calling something.
    // The program's IDL is the complete list of what can be invoked, so read it.
    //
    // The equivalent greps — for `frozen: false` and `UpdateCollectionPluginV1` in
    // programs/blotto_cup/ — are documented on pass.rs. This is the runtime half.
    const names: string[] = (program.idl.instructions ?? []).map(
      (ix: { name: string }) => ix.name,
    );

    expect(names, "the IDL must list the carried instructions").to.include(
      "mint_pass",
    );

    const suspicious = names.filter((n) =>
      /thaw|unfreeze|update_collection_plugin|set_frozen/i.test(n),
    );
    expect(
      suspicious,
      `no instruction may exist that could thaw a pass; found: ${suspicious.join(", ")}`,
    ).to.be.empty;
  });
});
