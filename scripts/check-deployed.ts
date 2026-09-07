/**
 * Does the DEPLOYED program match the source on this branch?
 *
 * Incident 2026-09-05: the devnet program at `5aawXay…` was nine days stale.
 * Commit 357a435 (27 Aug 21:19) removed `platform_wallet` from `init_config`
 * and added `treasury_min_platform_lamports`; the binary on chain was built at
 * 19:51 that day and never replaced. Everything downstream looked healthy —
 * `solana program show` named the right program id, the right authority and a
 * plausible deploy slot; `anchor build` reported "Finished". The mismatch only
 * surfaced when an `init_config` proposal, encoded from current source, was
 * simulated and came back `InstructionDidNotDeserialize`.
 *
 * Nothing in CI compared the deployed bytes to a commit, so nothing could have
 * caught it. This script is that comparison, and it is deliberately
 * behavioural rather than a build-hash match: it encodes each instruction's
 * arguments the way current source says they are shaped, simulates the call
 * against the live program, and fails on Anchor error 102
 * (`InstructionDidNotDeserialize`) — the program itself reporting that the
 * bytes it was handed are not the bytes it expects.
 *
 * WHAT THIS CATCHES: an argument added, removed, retyped or reordered in a way
 * that changes the encoded length — which is what every real drift so far has
 * looked like, tonight's included.
 *
 * WHAT IT DOES NOT CATCH: a reordering of two arguments of identical width
 * (swapping two `u64`s), which encodes to the same length and deserializes
 * cleanly. Nor does it check handler logic. It is a wire-contract check, not
 * an equivalence proof, and it is not a substitute for the LiteSVM suite.
 *
 * Simulation only — `sigVerify: false`, no signature, no state written, safe
 * to run against any cluster at any time.
 *
 * Run:  npx ts-node --transpile-only scripts/check-deployed.ts
 *       [--rpc <url>] [--program-id <base58>]
 * Exit: 0 when every instruction's wire contract matches, 1 otherwise.
 */

import { createHash } from 'crypto';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const N_TIERS = 7;
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const DEFAULT_RPC = 'https://api.devnet.solana.com';

/** Anchor's `InstructionDidNotDeserialize` — the one verdict that fails a run. */
const ERR_DID_NOT_DESERIALIZE = 102;

/** `Config::SPACE` in programs/blotto_cup/src/state.rs (8 + LEN) since the
 * 2026-09-07 upgrade; the pre-migration account is `CONFIG_SPACE_V1`. */
const CONFIG_SPACE = 484;
const CONFIG_SPACE_V1 = 380;

// ---------------------------------------------------------------------------
// Encoding helpers — the same wire contract scripts/admin.ts encodes against.
// ---------------------------------------------------------------------------

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
const u8b = (v: number): Buffer => Buffer.from([v]);
const boolb = (v: boolean): Buffer => Buffer.from([v ? 1 : 0]);

/**
 * One instruction's wire contract, as current source declares it.
 *
 * `args` carries REPRESENTATIVE values, not meaningful ones: the handler may
 * revert on a semantic check and that is a pass, because deserialization
 * already succeeded by then. Only error 102 fails.
 */
interface WireCheck {
  /** The snake_case instruction name — the Anchor discriminator preimage. */
  readonly name: string;
  /** Borsh-encoded arguments per programs/blotto_cup/src/lib.rs. */
  readonly args: Buffer;
  /** Source of truth for the shape, quoted so a reader can check it. */
  readonly signature: string;
}

/** Every admin instruction that takes arguments. All share the account pair
 *  `[admin (signer), config (mut)]` — `AdminOnly` and `AdminTreasury` are the
 *  same shape (programs/blotto_cup/src/instructions/admin.rs). */
function adminChecks(somePubkey: PublicKey): WireCheck[] {
  return [
    {
      name: 'set_paused',
      signature: 'paused: bool',
      args: boolb(false),
    },
    {
      name: 'rotate_entry_signer',
      signature: 'new_signer: Pubkey',
      args: somePubkey.toBuffer(),
    },
    {
      name: 'set_settlement_signer',
      signature: 'new_signer: Pubkey',
      args: somePubkey.toBuffer(),
    },
    {
      name: 'set_open_tiers',
      signature: 'open_tiers: [bool; N_TIERS]',
      args: Buffer.concat(Array.from({ length: N_TIERS }, () => boolb(true))),
    },
    {
      name: 'set_vault_ceiling',
      signature: 'tier: u8, ceiling_lamports: u64',
      args: Buffer.concat([u8b(0), u64le(6_400_000_000n)]),
    },
    {
      name: 'set_kyc_threshold',
      signature: 'above_lamports: u64',
      args: u64le(0n),
    },
    {
      name: 'set_detection_hard_block',
      signature: 'on: bool',
      args: boolb(false),
    },
    {
      name: 'set_tier_economics',
      signature: 'tier: u8, price_lamports: u64, pot_lamports: u64',
      args: Buffer.concat([u8b(0), u64le(100_000_000n), u64le(4_000_000_000n)]),
    },
    {
      name: 'set_treasury_policy',
      signature: 'reserve_pots: u8, min_platform_lamports: u64',
      args: Buffer.concat([u8b(1), u64le(500_000_000n)]),
    },
    // 2026-09-07 upgrade (prompt v2 §A / §B).
    {
      name: 'set_keeper',
      signature: 'new_keeper: Pubkey',
      args: somePubkey.toBuffer(),
    },
    {
      name: 'set_pool_timing',
      signature: 'fill_deadline_seconds: i64, cooldown_seconds: i64',
      args: Buffer.concat([i64le(43_200n), i64le(300n)]),
    },
  ];
}

function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

/** `migrate_config(keeper)` — its own account list (admin mut, config as an
 *  UncheckedAccount, the System Program). A live post-migration account
 *  reverts with ConfigAlreadyMigrated, which is a pass here. */
function migrateConfigCheck(keeper: PublicKey): WireCheck {
  return {
    name: 'migrate_config',
    signature: 'keeper: Pubkey',
    args: keeper.toBuffer(),
  };
}

/** `pay_next_place` — the widest argument shape the upgrade adds. Account
 *  validation fails long after the arguments deserialize (the placeholder
 *  Entries do not exist), which is a pass for a wire-contract check. */
function payNextPlaceCheck(): WireCheck {
  const step = Buffer.concat([Buffer.alloc(32, 1), boolb(true)]);
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(2);
  const group = Buffer.alloc(2);
  group.writeUInt16LE(2);
  return {
    name: 'pay_next_place',
    signature:
      'pool_id: u64, rank: u8, amount: u64, proof: Vec<ProofStep { sibling: [u8; 32], ' +
      'sibling_on_right: bool }>, group_size: u16, takes_remainder: bool',
    args: Buffer.concat([u64le(1n), u8b(1), u64le(0n), proofLen, step, step, group, boolb(true)]),
  };
}

/** `init_config`'s own account list — it creates the Config PDA, so it takes
 *  the platform PDA and the System Program too (InitConfig in admin.rs). */
function initConfigCheck(entrySigner: PublicKey, settlementSigner: PublicKey): WireCheck {
  // Launch ceilings in lamports (price × 64 per tier; tier 0 = 6.4 SOL) —
  // integers, never a float-rounded SOL figure.
  const ceilings = [
    6_400_000_000n,
    32_000_000_000n,
    48_000_000_000n,
    64_000_000_000n,
    160_000_000_000n,
    320_000_000_000n,
    480_000_000_000n,
  ].map(u64le);
  return {
    name: 'init_config',
    signature:
      'entry_signer: Pubkey, settlement_signer: Pubkey, keeper: Pubkey, ' +
      'vault_ceiling_lamports: [u64; N_TIERS], treasury_min_platform_lamports: u64',
    args: Buffer.concat([
      entrySigner.toBuffer(),
      settlementSigner.toBuffer(),
      settlementSigner.toBuffer(),
      ...ceilings,
      u64le(500_000_000n),
    ]),
  };
}

// ---------------------------------------------------------------------------

interface Verdict {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Simulate one instruction and decide whether its ARGUMENTS deserialized. */
async function checkOne(
  connection: Connection,
  programId: PublicKey,
  check: WireCheck,
  keys: TransactionInstruction['keys'],
  payer: PublicKey
): Promise<Verdict> {
  const ix = new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([disc(check.name), check.args]),
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message()
  );

  const res = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  });

  const err = res.value.err;
  const logs = res.value.logs ?? [];

  // Anchor prints the code before returning it; either route identifies 102.
  const custom =
    err &&
    typeof err === 'object' &&
    'InstructionError' in err &&
    Array.isArray((err as { InstructionError: unknown[] }).InstructionError)
      ? (err as { InstructionError: [number, unknown] }).InstructionError[1]
      : undefined;
  const code =
    custom && typeof custom === 'object' && 'Custom' in custom
      ? (custom as { Custom: number }).Custom
      : undefined;

  if (code === ERR_DID_NOT_DESERIALIZE) {
    return {
      name: check.name,
      ok: false,
      detail: `DEPLOYED PROGRAM REJECTED THE ARGUMENTS (Anchor 102) — source says: ${check.signature}`,
    };
  }

  // Anything else means the bytes were understood. The handler may then revert
  // on a semantic check (wrong admin, account already in use, an out-of-range
  // tier); that is a pass for a wire-contract check.
  if (err === null) {
    return { name: check.name, ok: true, detail: 'accepted and executed in simulation' };
  }
  const reason = logs.find((l) => l.includes('Error Message:')) ?? JSON.stringify(err);
  return {
    name: check.name,
    ok: true,
    detail: `arguments accepted; reverted later — ${reason.replace(/^Program log: /, '').trim()}`,
  };
}

/**
 * Prove the detector still detects.
 *
 * A check that can only pass is worth nothing — it is the same shape as the
 * faults this script exists to catch (a step reporting success while doing
 * nothing). So every run first hands the program a deliberately malformed
 * `set_paused`: a 32-byte argument where source says one byte. That MUST come
 * back as Anchor 102. If it does not, the detector is broken and every verdict
 * below it is meaningless, so the run fails loudly rather than reporting green.
 */
async function canary(
  connection: Connection,
  programId: PublicKey,
  keys: TransactionInstruction['keys'],
  payer: PublicKey
): Promise<Verdict> {
  const wrong: WireCheck = {
    name: 'set_paused',
    signature: 'DELIBERATELY WRONG — 32 bytes where source says bool',
    args: Buffer.alloc(32, 7),
  };
  const seen = await checkOne(connection, programId, wrong, keys, payer);
  // checkOne reports ok=false exactly when it saw 102, which is what we want.
  return {
    name: 'detector canary',
    ok: !seen.ok,
    detail: seen.ok
      ? 'MALFORMED ARGUMENTS WERE NOT REJECTED — this script is not detecting drift; treat every result below as unproven'
      : 'malformed arguments correctly rejected (Anchor 102) — the detector works',
  };
}

/** The Config account's size is its own statement about the deployed layout. */
async function checkConfigAccount(
  connection: Connection,
  config: PublicKey
): Promise<Verdict | null> {
  const info = await connection.getAccountInfo(config, 'confirmed');
  if (info === null) return null;
  const ok = info.data.length === CONFIG_SPACE;
  return {
    name: 'Config account layout',
    ok,
    detail: ok
      ? `${info.data.length} bytes — matches Config::SPACE`
      : info.data.length === CONFIG_SPACE_V1
        ? `${info.data.length} bytes — the PRE-MIGRATION layout: run \`admin.ts migrate-config\` (runbook step 3b)`
        : `${info.data.length} bytes on chain, source says Config::SPACE = ${CONFIG_SPACE}`,
  };
}

/** A flag, then an environment variable, then the default — skipping any that
 *  is absent OR EMPTY. `??` would keep an empty string, and CI passes exactly
 *  that when an optional secret is unset, which fails as an unparseable URL
 *  rather than falling back. */
function flag(name: string, envVar: string | undefined, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const fromArgv = i >= 0 ? process.argv[i + 1] : undefined;
  return fromArgv?.trim() || envVar?.trim() || fallback;
}

async function main(): Promise<void> {
  const rpc = flag('rpc', process.env.BLOTTO_RPC_URL, DEFAULT_RPC);
  const programId = new PublicKey(
    flag('program-id', process.env.BLOTTO_PROGRAM_ID, DEFAULT_PROGRAM_ID)
  );
  const connection = new Connection(rpc, 'confirmed');

  const account = await connection.getAccountInfo(programId, 'confirmed');
  if (account === null) {
    console.error(`no program at ${programId.toBase58()} on ${rpc}`);
    process.exitCode = 1;
    return;
  }
  if (!account.executable) {
    console.error(`${programId.toBase58()} exists but is not executable`);
    process.exitCode = 1;
    return;
  }

  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
  const platform = PublicKey.findProgramAddressSync([Buffer.from('platform')], programId)[0];

  // Use the REAL admin when Config exists, so `has_one = admin` passes and any
  // failure is unambiguously about the arguments rather than authorisation.
  const configInfo = await connection.getAccountInfo(config, 'confirmed');
  const admin =
    configInfo && configInfo.data.length >= 40
      ? new PublicKey(configInfo.data.subarray(8, 40))
      : programId; // Config absent: init_config is the meaningful check anyway.

  console.log(`program : ${programId.toBase58()}`);
  console.log(`cluster : ${rpc}`);
  console.log(`config  : ${configInfo ? 'initialised' : 'NOT initialised'}`);
  console.log(`admin   : ${configInfo ? admin.toBase58() : '(unknown — Config absent)'}\n`);

  const verdicts: Verdict[] = [];

  const adminKeys: TransactionInstruction['keys'] = [
    { pubkey: admin, isSigner: true, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
  ];

  // First, and always: prove this script can still tell a mismatch apart.
  verdicts.push(await canary(connection, programId, adminKeys, admin));

  for (const check of adminChecks(admin)) {
    verdicts.push(await checkOne(connection, programId, check, adminKeys, admin));
  }

  const init = initConfigCheck(admin, admin);
  verdicts.push(
    await checkOne(
      connection,
      programId,
      init,
      [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: platform, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      admin
    )
  );

  verdicts.push(
    await checkOne(
      connection,
      programId,
      migrateConfigCheck(admin),
      [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      admin
    )
  );

  // pay_next_place: settlement signer, config, pool, vault, from, to,
  // to_player, system program — placeholders where no real account is
  // needed for the ARGUMENTS to deserialize.
  const poolPda = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), u64le(1n)],
    programId
  )[0];
  const vaultPda = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), u64le(1n)],
    programId
  )[0];
  const settlement =
    configInfo && configInfo.data.length >= 104
      ? new PublicKey(configInfo.data.subarray(72, 104))
      : admin;
  verdicts.push(
    await checkOne(
      connection,
      programId,
      payNextPlaceCheck(),
      [
        { pubkey: settlement, isSigner: true, isWritable: false },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: PublicKey.unique(), isSigner: false, isWritable: true },
        { pubkey: PublicKey.unique(), isSigner: false, isWritable: true },
        { pubkey: PublicKey.unique(), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      settlement
    )
  );

  const layout = await checkConfigAccount(connection, config);
  if (layout !== null) verdicts.push(layout);

  const width = Math.max(...verdicts.map((v) => v.name.length));
  for (const v of verdicts) {
    console.log(`${v.ok ? 'ok  ' : 'FAIL'}  ${v.name.padEnd(width)}  ${v.detail}`);
  }

  const failed = verdicts.filter((v) => !v.ok);
  console.log();
  if (failed.length === 0) {
    console.log(
      `every instruction's wire contract matches this branch (${verdicts.length} checked).`
    );
    return;
  }
  console.error(
    `THE DEPLOYED PROGRAM DOES NOT MATCH THIS BRANCH — ${failed.length} of ${verdicts.length} failed.\n` +
      `Rebuild and redeploy before running anything against it:\n` +
      `  anchor build\n` +
      `  solana program deploy target/deploy/blotto_cup.so --program-id ${programId.toBase58()} ...\n` +
      `See docs/devnet-rehearsal-runbook.md (recovery notes) for the 2026-09-05 incident.`
  );
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
