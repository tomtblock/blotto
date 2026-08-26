// `commit_vrf_seed` instruction tests.
//
// Carried from the predecessor repository's `tests/commit-vrf-seed.ts`, with
// Collection renamed to Pool throughout and the pool set up by direct account
// mocking rather than by a launch instruction (see "Why the Pool is mocked" below).
//
// Verifies that `commit_vrf_seed` reads a *revealed* Switchboard On-Demand
// Randomness account and copies its 32-byte value into `Pool.vrf_seed`, write-once.
//
// Runner: Surfpool (the Anchor 1.0 default). Client: `@anchor-lang/core` — raw
// JSON-RPC for `surfnet_*` cheatcodes, manual account-data layouts, and error
// assertions that match on *failure occurring* rather than on a brittle Anchor
// error string.
//
// === Why the Randomness account is MOCKED ===
// Invoking Switchboard On-Demand for real (create -> commit -> oracle reveal)
// requires a live oracle network, which Surfpool does not run. So this suite
// fabricates a revealed `RandomnessAccountData` account directly via
// `surfnet_setAccount`, populating the exact zero-copy byte layout the on-chain SDK
// (`switchboard-on-demand` 0.12.1) expects. A devnet run against a real reveal is a
// later phase, not here.
//
// === Why the Pool account is MOCKED (new in Blotto Cup) ===
// `open_pool` does not exist yet — Phase 0 carried two instructions, not a whole
// program (see EXTRACTION-REPORT.md). The predecessor's version of this suite called
// `launch_collection` to create the account it then committed a seed into; there is
// no equivalent to call. So the Pool PDA is written directly with
// `surfnet_setAccount`, using the Borsh layout of `state::Pool` plus Anchor's 8-byte
// account discriminator.
//
// TODO(phase-1): replace `mockPool` with a real `open_pool` call once that
// instruction exists. The mock encodes the Pool layout in two places (here and in
// state.rs); a layout change that misses this file shows up as a deserialization
// failure, which is a loud enough failure mode for the interim but is not where this
// should end up.
//
// === The same-slot reveal+consume constraint ===
// `RandomnessAccountData::get_value(slot)` returns the revealed value ONLY when the
// passed slot equals the account's `reveal_slot`. On a live network the caller
// bundles the Switchboard `reveal` instruction with `commit_vrf_seed` so
// `clock.slot == reveal_slot`. Surfpool advances the slot on a wall-clock ticker, but
// the slot a transaction executes in equals the slot reported by `getSlot` at
// submission time. So the happy path reads the current slot, writes it into the
// mocked account's `reveal_slot`, and submits immediately; a short retry loop absorbs
// the rare case where the clock ticks between the read and execution.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { createHash } from "crypto";
import { expect } from "chai";

import { BlottoCup } from "../target/types/blotto_cup";

const { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

// System program — used as a non-Switchboard owner in the invalid-account case.
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
// Switchboard On-Demand mainnet program ID (source: switchboard-xyz/solana-sdk
// src/program_id.rs ON_DEMAND_MAINNET_PID). The handler accepts mainnet or devnet.
const SB_ON_DEMAND_MAINNET_PID = new PublicKey(
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
);

// Seed prefix — must mirror programs/blotto_cup/src/state.rs.
const POOL_SEED = Buffer.from("pool");

// `RandomnessAccountData` Anchor-style discriminator (source: switchboard-xyz/solana-sdk
// src/on_demand/accounts/randomness.rs). The account is `disc(8) || struct(400)`.
const RANDOMNESS_DISCRIMINATOR = Buffer.from([
  10, 66, 229, 135, 220, 239, 217, 114,
]);
// Field byte offsets in the account, from the #[repr(C)] struct (which follows the
// 8-byte discriminator). Within-struct offsets: authority 0, queue 32, seed_slothash
// 64, seed_slot 96, oracle 104, reveal_slot 136, value 144, _ebuf2 176, _ebuf1 272.
// Struct is 400 bytes; account = 8 + 400. Account offset = 8 + struct offset.
const RANDOMNESS_ACCOUNT_LEN = 8 + 400;
const OFF_SEED_SLOT = 8 + 96; // u64
const OFF_REVEAL_SLOT = 8 + 136; // u64
const OFF_VALUE = 8 + 144; // [u8; 32]

// Pool account layout — mirrors programs/blotto_cup/src/state.rs `Pool`.
// disc(8) || id: u64 || state: u8 (enum discriminant) || vrf_seed: [u8; 32] || bump: u8
const POOL_ACCOUNT_LEN = 8 + 8 + 1 + 32 + 1;
const POOL_OFF_VRF_SEED = 8 + 8 + 1;
// PoolState::Open is the first variant, so Borsh writes it as 0.
const POOL_STATE_OPEN = 0;

/// Anchor's account discriminator: the first 8 bytes of sha256("account:<Name>").
function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

describe("commit_vrf_seed", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = anchor.workspace.blottoCup as Program<BlottoCup>;

  // A monotonic pool id so each test gets its own Pool PDA and nothing leaks
  // between cases.
  let nextPoolId = 1n;

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

  // surfpool decodes `data` as a hex string.
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
  }

  function derivePoolPda(poolId: bigint): [anchor.web3.PublicKey, number] {
    const idLe = Buffer.alloc(8);
    idLe.writeBigUInt64LE(poolId);
    return PublicKey.findProgramAddressSync(
      [POOL_SEED, idLe],
      program.programId,
    );
  }

  /// Write a fresh, Open, seed-uncommitted Pool straight into the ledger.
  /// See "Why the Pool is mocked" at the top of this file.
  async function mockPool(): Promise<MockedPool> {
    const poolId = nextPoolId++;
    const [poolPda, bump] = derivePoolPda(poolId);

    const data = Buffer.alloc(POOL_ACCOUNT_LEN);
    accountDiscriminator("Pool").copy(data, 0);
    data.writeBigUInt64LE(poolId, 8);
    data.writeUInt8(POOL_STATE_OPEN, 16);
    // vrf_seed stays zero — the "uncommitted" sentinel the write-once guard reads.
    data.writeUInt8(bump, POOL_ACCOUNT_LEN - 1);

    await setAccount(poolPda, {
      lamports: 10_000_000,
      owner: program.programId.toBase58(),
      data,
    });

    return { poolId, poolPda };
  }

  // Build a revealed `RandomnessAccountData` account buffer.
  function buildRandomnessData(
    value: Buffer,
    revealSlot: bigint,
    seedSlot: bigint,
  ): Buffer {
    if (value.length !== 32) throw new Error("value must be 32 bytes");
    const buf = Buffer.alloc(RANDOMNESS_ACCOUNT_LEN);
    RANDOMNESS_DISCRIMINATOR.copy(buf, 0);
    buf.writeBigUInt64LE(seedSlot, OFF_SEED_SLOT);
    buf.writeBigUInt64LE(revealSlot, OFF_REVEAL_SLOT);
    value.copy(buf, OFF_VALUE);
    // authority / queue / seed_slothash / oracle / ebufs left zero — the handler
    // does not read them.
    return buf;
  }

  // Submit one commit_vrf_seed.
  async function commitVrfSeed(
    pool: MockedPool,
    randomnessAccount: anchor.web3.PublicKey,
    signer: anchor.web3.Keypair,
  ): Promise<string> {
    return program.methods
      .commitVrfSeed(new anchor.BN(pool.poolId.toString()))
      .accountsPartial({
        pool: pool.poolPda,
        randomnessAccount,
        signer: signer.publicKey,
      })
      .signers([signer])
      .rpc();
  }

  async function fetchVrfSeed(
    poolPda: anchor.web3.PublicKey,
  ): Promise<Buffer> {
    const info = await connection.getAccountInfo(poolPda);
    if (!info) throw new Error("pool account missing");
    return Buffer.from(
      info.data.subarray(POOL_OFF_VRF_SEED, POOL_OFF_VRF_SEED + 32),
    );
  }

  // Mock a *revealed* randomness account and commit it. Switchboard's `get_value`
  // accepts the value only when `clock.slot == reveal_slot`, and the execution slot
  // equals the slot `getSlot` reports at submission. So each attempt reads the
  // current slot, writes it into `reveal_slot`, and submits immediately; a fresh
  // signer per attempt keeps signatures distinct (a reverted attempt leaves vrf_seed
  // at zero, so retrying is safe).
  async function mockPoolAndCommit(): Promise<{
    pool: MockedPool;
    randomness: anchor.web3.Keypair;
    value: Buffer;
  }> {
    const pool = await mockPool();
    const randomness = Keypair.generate();
    // Deterministic, clearly non-zero 32-byte value for exact assertion.
    const value = Buffer.from(
      Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff),
    );

    let committed = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 10 && !committed; attempt++) {
      const slot = await connection.getSlot();
      const data = buildRandomnessData(
        value,
        BigInt(slot),
        BigInt(Math.max(slot - 1, 0)),
      );
      await setAccount(randomness.publicKey, {
        lamports: 10_000_000,
        owner: SB_ON_DEMAND_MAINNET_PID.toBase58(),
        data,
      });
      try {
        const signer = Keypair.generate();
        await airdrop(signer.publicKey, 1);
        await commitVrfSeed(pool, randomness.publicKey, signer);
        committed = true;
      } catch (e) {
        lastErr = e; // clock ticked between read and execution — re-read and retry
      }
    }
    if (!committed) {
      throw new Error(
        `commit_vrf_seed never landed in its reveal slot: ${lastErr}`,
      );
    }
    return { pool, randomness, value };
  }

  // ---- tests -------------------------------------------------------------

  it("(a) happy path: writes the revealed 32-byte seed into Pool.vrf_seed", async () => {
    const { pool, value } = await mockPoolAndCommit();

    const seed = await fetchVrfSeed(pool.poolPda);
    expect(seed.equals(value), "vrf_seed must equal the revealed value").to.be
      .true;
    expect(seed.equals(Buffer.alloc(32)), "vrf_seed must not be zero").to.be
      .false;
  });

  it("(b) double-commit rejection: a second commit_vrf_seed fails (write-once)", async () => {
    const { pool, randomness } = await mockPoolAndCommit();

    // The second commit reuses the same accounts. The write-once guard fires
    // before the oracle account is even read. Match on failure occurring, not on
    // the error string.
    const signer = Keypair.generate();
    await airdrop(signer.publicKey, 1);

    let threw = false;
    try {
      await commitVrfSeed(pool, randomness.publicKey, signer);
    } catch {
      threw = true;
    }
    expect(threw, "second commit_vrf_seed must fail").to.be.true;

    // The seed remains committed (non-zero) from the first successful commit.
    const seed = await fetchVrfSeed(pool.poolPda);
    expect(
      seed.equals(Buffer.alloc(32)),
      "vrf_seed must remain committed (non-zero) after the rejected re-commit",
    ).to.be.false;
  });

  it("(c) invalid randomness account: wrong owner is rejected", async () => {
    const pool = await mockPool();
    const randomness = Keypair.generate();

    // Correct discriminator and a plausible value, but owned by the System Program
    // rather than Switchboard. The handler's owner check rejects before any
    // deserialization, so no slot matching is needed here.
    const value = Buffer.from(Array.from({ length: 32 }, () => 0x11));
    const data = buildRandomnessData(value, 1n, 0n);
    await setAccount(randomness.publicKey, {
      lamports: 10_000_000,
      owner: SYSTEM_PROGRAM_ID.toBase58(),
      data,
    });

    const signer = Keypair.generate();
    await airdrop(signer.publicKey, 1);

    let threw = false;
    try {
      await commitVrfSeed(pool, randomness.publicKey, signer);
    } catch {
      threw = true;
    }
    expect(threw, "commit with a non-Switchboard-owned account must fail").to.be
      .true;

    // The pool seed stays at the zero placeholder — nothing was committed.
    const seed = await fetchVrfSeed(pool.poolPda);
    expect(
      seed.equals(Buffer.alloc(32)),
      "vrf_seed must remain the zero placeholder after a rejected commit",
    ).to.be.true;
  });
});
