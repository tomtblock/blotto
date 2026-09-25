/**
 * The admin CLI (master prompt v3, E3): every operator instruction the
 * program gates on the admin key, plus the permissionless treasury deposit,
 * runnable two ways —
 *
 *   direct-signed  FEE_PAYER_KEYPAIR=/path/to/admin.json (devnet rehearsal:
 *                  the admin is a local keypair)
 *   --emit-proposal  print the instruction (accounts + base64 data) WITHOUT
 *                  signing or sending — the Squads seam: on mainnet the
 *                  admin is the Squads vault, and this output is what goes
 *                  into the proposal. Nothing in this script can sign for
 *                  a multisig, by design.
 *
 * Instruction bytes are hand-encoded against the program's wire contract
 * (Anchor global discriminators + Borsh args + the exact account orders in
 * programs/blotto_cup/src/instructions/) — the same encoding
 * backend/reveal/src/chain-web3.ts uses, which the LiteSVM suite pins.
 *
 * Money flags take LAMPORTS (integers) or exact decimal SOL strings parsed
 * in bigint — no float ever touches an amount.
 *
 * Run:  npx ts-node --transpile-only scripts/admin.ts <command> [flags]
 * Docs: docs/devnet-rehearsal.md (worked examples for every command).
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const N_TIERS = 7;
const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
import { resolveRpcUrl } from '../backend/_shared/src/cluster';
// The ratified tier table, from the same module the program's constants are
// mirrored into and `check-mirrors.py` pins. `set-open-tiers` compares the
// live account against it before opening a tier — see cmdSetOpenTiers.
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../backend/scoring/src/prizes';
/** The devnet fallback; the endpoint follows BLOTTO_CLUSTER / BLOTTO_RPC_URL (RPC_URL kept as an alias). */
const DEFAULT_RPC = resolveRpcUrl({ BLOTTO_CLUSTER: process.env.BLOTTO_CLUSTER, BLOTTO_RPC_URL: process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL });

const USAGE = `blotto-cup admin CLI

  npx ts-node --transpile-only scripts/admin.ts <command> [flags]

commands
  status                    read Config + platform treasury balance
  pools                     read every pool's state — the drain query the
                            D-E2/D-E4 runbook section records before an
                            upgrade (read-only; exits 1 while any pool is
                            Sealed, Scored or Refunding)
      [--upgrade-preflight] ALSO refuse while any pool is Open. Off by
                            default because a pool is Open almost always and
                            this is the ordinary status command. Required
                            before the R7-b program upgrade: a pool open
                            across that upgrade keeps the floor it opened
                            with while the site reads the shared constant,
                            so the two can disagree. See
                            docs/RUNBOOK_r7b-upgrade.md
      [--self-test]         drive the verdict through its fixtures and exit.
                            Touches no network
  init-config               one-time setup (admin = the signing key)
      --entry-signer <pubkey> --settlement-signer <pubkey> --keeper <pubkey>
      --ceilings <7 comma-separated lamport values>
      --min-platform <lamports | SOL decimal ending in "sol", e.g. 2sol>
  migrate-pool              PERMISSIONLESS. The one-shot Pool account growth
                            to the current layout (850 bytes): a pre-R7-b
                            pool (847) gets min_seats = 52, the floor its
                            players entered under, and mode; a pre-Phase-B
                            pool (849) gets mode alone, its floor kept. mode
                            is always easy — hard did not exist. Run it for
                            EVERY pool right after the Phase B upgrade —
                            until it has, every instruction touching that
                            pool fails on the short account. Self-disabling;
                            a pool already at the current layout is reported
                            and skipped
      --pool-id <u64>       one pool
      --all                 every pool 1..next_pool_id-1 that needs it, in
                            order, one transaction each
  migrate-config            the ONE-SHOT Phase B layout migration (2026-09-24):
                            grows the live Config (484 → 603 bytes) with the
                            hard ladder, every hard tier disabled. Takes no
                            argument (the 2026-09-07 keeper-seeding path is
                            retired). Run right after the upgrade, before
                            anything else — see docs/RUNBOOK_phase-b-window.md
  set-keeper                the ONLY key open_pool accepts (prompt v2 §A;
                            the 24 h liveness fallback was removed
                            2026-09-07). May not be the zero key
      --keeper <pubkey>
  set-pool-timing           the fill deadline for pools opened from now on
                            and the per-tier cooldown (never touches an
                            open pool); both in seconds, both > 0
      --fill-deadline <seconds> --cooldown <seconds>
  forfeit-escrow            ADMIN-signed since 2026-09-07: record that review
                            upheld a flag. Moves nothing — the share stays in
                            the pool's vault until pay_next_place
      --pool-id <u64> --player <pubkey>
  lift-sanctions-hold       ADMIN-signed: clear a sanctions hold a review
                            established was a false positive. The entry
                            returns to the ordinary path and the share is
                            released to the player by review or by the
                            seven-day safeguard. There is deliberately no
                            command to PLACE one — the crank does that from
                            a screening, never an operator by hand
      --pool-id <u64> --player <pubkey>
  set-open-tiers            which tiers may open pools (founder-owned). This
                            is the ONLY way a tier becomes openable, and it
                            is Squads-gated: the admin is the multisig vault,
                            so in practice you run it with --emit-proposal
                            and the signers approve it. Refuses to open a
                            tier whose on-chain price or pot disagrees with
                            the ratified table, and refuses to open more than
                            one additional tier per call. Closing is never
                            refused. See docs/RUNBOOK_open-tier.md
      --tiers <7 comma-separated 0/1, e.g. 1,0,0,0,0,0,0>
      [--mode easy|hard]    WHICH ladder (Phase B). Default easy
                            (set_open_tiers). hard sends set_hard_open_tiers,
                            the hard ladder's own switch, and refuses until
                            migrate-config has run
      [--dry-run]           run the checks, print current vs proposed, send
                            nothing
  set-paused                the kill switch: blocks register, and ONLY
                            register (reveal/payout/refund keep working, so
                            a pause never strands funds)
      --paused <true|false>
  set-vault-ceiling         one tier's gross-intake ceiling (D2)
      --tier <0-6> --ceiling <lamports | e.g. 6.4sol>
  set-kyc-threshold         KYC-at-claim switch (R3); 0 disables
      --above <lamports | e.g. 1sol>
  set-detection-hard-block  R11's full-escrow-tier switch
      --on <true|false>
  set-tier-economics        one tier's price and pot (founder-owned)
      --tier <0-6> --price <lamports|SOL> --pot <lamports|SOL>
  set-treasury-policy       the withdraw floor + open_pool requirement
      --reserve-pots <u8> --min-platform <lamports|SOL>
  register-signers          rotate the service signers. A settlement rotation
                            carries Config.keeper with it — open_pool accepts
                            no other key, so leaving it behind stops every new
                            pool opening (audit D-08)
      [--entry-signer <pubkey>] [--settlement-signer <pubkey>]
      [--keeper <pubkey>]     name a third key outright
      [--keep-keeper]         this deployment runs keeper and settlement as
                              different keys: leave Config.keeper alone
  seal-at-deadline          PERMISSIONLESS. Seal a pool whose fill deadline
                            has passed, by hand, when the daemon is down or
                            refusing it. Moves no lamports. The program checks
                            the state and the deadline, so a mistimed call is
                            refused
      --pool-id <u64>
  trigger-refund            PERMISSIONLESS. Put an unfilled pool past its
                            deadline into Refunding (or straight to Closed
                            with no entrants), returning the untouched pot to
                            the treasury. Each player's entry is then repaid
                            one at a time with the refund command below
      --pool-id <u64>
  refund                    PERMISSIONLESS. Repay one player's FULL entry from
                            the treasury, for a pool already in Refunding. Run
                            it once per entrant
      --pool-id <u64> --player <pubkey>
  fund-platform-wallet      permissionless treasury deposit
      --amount <lamports | e.g. 5sol>
  withdraw-platform         the ONE treasury exit (floor-gated on-chain)
      --amount <lamports | e.g. 1.5sol> --destination <pubkey>

global flags
  --rpc <url>              default ${DEFAULT_RPC} (or RPC_URL)
  --program <pubkey>       default ${DEFAULT_PROGRAM_ID} (or BLOTTO_PROGRAM_ID)
  --emit-proposal          print the instruction for a Squads proposal
                           instead of signing (no keypair needed)

env
  FEE_PAYER_KEYPAIR        path to the signing keypair JSON (direct mode)
  RPC_URL, BLOTTO_PROGRAM_ID  as above
`;

// ---------------------------------------------------------------------------

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

/** "123" lamports, or an exact decimal SOL string suffixed "sol" — parsed
 * entirely in bigint (a fractional part beyond 9 places is an error). */
function parseAmount(raw: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]+))?sol$/i.exec(raw.trim());
  if (!m) {
    if (!/^[0-9]+$/.test(raw.trim())) {
      throw new Error(`amount must be integer lamports or "<decimal>sol": ${raw}`);
    }
    return BigInt(raw.trim());
  }
  const frac = m[2] ?? '';
  if (frac.length > 9) throw new Error(`more than 9 decimal places of SOL: ${raw}`);
  return BigInt(m[1]) * 1_000_000_000n + BigInt(frac.padEnd(9, '0') || '0');
}

interface Cli {
  command: string;
  flags: Map<string, string>;
  emitProposal: boolean;
}

/**
 * Flags that are SWITCHES rather than settings: present means on, and they
 * take no value.
 *
 * An allowlist rather than "a flag followed by another flag is a switch",
 * on purpose: the parser's `flag X needs a value` error is what catches
 * `--tiers --dry-run`, which would otherwise set an empty tier list and
 * send it. Only names listed here may be bare.
 *
 * `keep-keeper` is listed because it has always been READ as a switch
 * (`flags.get('keep-keeper') !== undefined`) and documented as one in the
 * usage block, but the parser had no way to accept a bare flag — so the
 * documented form threw and it could only be passed with a dummy value.
 */
const SWITCHES = new Set(['dry-run', 'keep-keeper', 'upgrade-preflight', 'self-test', 'all']);

function parseArgs(argv: string[]): Cli {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  let emitProposal = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--emit-proposal') {
      emitProposal = true;
      continue;
    }
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    if (SWITCHES.has(a.slice(2))) {
      flags.set(a.slice(2), 'on');
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag ${a} needs a value`);
    }
    flags.set(a.slice(2), value);
    i++;
  }
  return { command: command ?? '', flags, emitProposal };
}

function need(cli: Cli, name: string): string {
  const v = cli.flags.get(name);
  if (v === undefined) throw new Error(`--${name} is required (see --help)`);
  return v;
}

// ---------------------------------------------------------------------------

class Pdas {
  constructor(private readonly programId: PublicKey) {}
  private pda(seeds: Buffer[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }
  config(): PublicKey {
    return this.pda([Buffer.from('config')]);
  }
  platform(): PublicKey {
    return this.pda([Buffer.from('platform')]);
  }
  pool(id: bigint): PublicKey {
    return this.pda([Buffer.from('pool'), u64le(id)]);
  }
  vault(id: bigint): PublicKey {
    return this.pda([Buffer.from('vault'), u64le(id)]);
  }
  entry(pool: PublicKey, player: PublicKey): PublicKey {
    return this.pda([Buffer.from('entry'), pool.toBuffer(), player.toBuffer()]);
  }
}

interface Ctx {
  connection: Connection;
  programId: PublicKey;
  pdas: Pdas;
  cli: Cli;
}

/** Direct mode signs and sends; --emit-proposal prints the Squads payload. */
async function deliver(ctx: Ctx, ixs: TransactionInstruction[], signerRole: string): Promise<void> {
  if (ctx.cli.emitProposal) {
    for (const ix of ixs) {
      console.log(
        JSON.stringify(
          {
            note: `signer role: ${signerRole} — the Squads vault executes this`,
            programId: ix.programId.toBase58(),
            accounts: ix.keys.map((k) => ({
              pubkey: k.pubkey.toBase58(),
              isSigner: k.isSigner,
              isWritable: k.isWritable,
            })),
            dataBase64: ix.data.toString('base64'),
          },
          null,
          2
        )
      );
    }
    return;
  }
  const path = process.env.FEE_PAYER_KEYPAIR;
  if (!path) {
    throw new Error(
      'FEE_PAYER_KEYPAIR is not set. Point it at the signing keypair JSON, or use --emit-proposal.'
    );
  }
  const signer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[])
  );
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(ctx.connection, tx, [signer], {
    commitment: 'confirmed',
  });
  console.log(`confirmed: ${sig}`);
}

/** The signer account every instruction lists first. In direct mode it is
 * the FEE_PAYER_KEYPAIR's pubkey; in proposal mode the Squads vault, passed
 * as --admin (required — nothing is guessed). */
function signerPubkey(cli: Cli): PublicKey {
  if (cli.emitProposal) {
    const admin = cli.flags.get('admin');
    if (!admin) {
      throw new Error('--emit-proposal needs --admin <squads-vault-pubkey> for the signer slot');
    }
    return new PublicKey(admin);
  }
  const path = process.env.FEE_PAYER_KEYPAIR;
  if (!path) {
    throw new Error('FEE_PAYER_KEYPAIR is not set (or use --emit-proposal with --admin).');
  }
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[])
  ).publicKey;
}

// ---------------------------------------------------------------------------

async function cmdStatus(ctx: Ctx): Promise<void> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) {
    console.log('config: NOT INITIALISED (run init-config)');
    return;
  }
  const d = info.data;
  // Config layout since D-A1 v2 (state.rs, LEN-asserted; chain-web3.ts
  // reads the same offsets).
  const openTiers: number[] = [];
  const prices: bigint[] = [];
  const pots: bigint[] = [];
  for (let t = 0; t < N_TIERS; t++) {
    openTiers.push(d[105 + t]);
    prices.push(d.readBigUInt64LE(168 + 8 * t));
    pots.push(d.readBigUInt64LE(224 + 8 * t));
  }
  const platform = await ctx.connection.getAccountInfo(ctx.pdas.platform(), 'confirmed');
  if (d.length === CONFIG_SPACE_V2) {
    console.log(
      'config: PRE-PHASE-B LAYOUT (484 bytes) — after the Phase B upgrade every other ' +
        'instruction fails until `migrate-config` runs (docs/RUNBOOK_phase-b-window.md)'
    );
  } else if (d.length === CONFIG_SPACE_V1) {
    console.log(
      'config: the ORIGINAL 380-byte layout — no current program can grow it (the 2026-09-07 ' +
        'migration is retired)'
    );
  } else if (d.length !== CONFIG_SPACE) {
    console.log(`config: ${d.length} bytes on chain; source says Config::SPACE = ${CONFIG_SPACE}`);
  }
  console.log(`admin:             ${new PublicKey(d.subarray(8, 40)).toBase58()}`);
  console.log(`entry signer:      ${new PublicKey(d.subarray(40, 72)).toBase58()}`);
  console.log(`settlement signer: ${new PublicKey(d.subarray(72, 104)).toBase58()}`);
  console.log(`paused:            ${d[104] !== 0}`);
  console.log(`open tiers:        [${openTiers.join(', ')}]`);
  console.log(`tier prices:       [${prices.join(', ')}] lamports`);
  console.log(`tier pots:         [${pots.join(', ')}] lamports`);
  console.log(`reserve pots:      ${d[280]}`);
  console.log(`min platform:      ${d.readBigUInt64LE(281)} lamports`);
  console.log(`reserved:          ${d.readBigUInt64LE(289)} lamports`);
  console.log(`refundable:        ${d.readBigUInt64LE(297)} lamports`);
  // Audit 2026-09-11, D-21: both of these are published on chain precisely so
  // the operative policy is public, both have a `set-` command here, and until
  // 2026-09-12 nothing in this repository could read either one back — while
  // the operating manual said this command showed them. An operator could set
  // a switch and had no way to confirm it had taken.
  console.log(`kyc threshold:     ${d.readBigUInt64LE(306)} lamports (0 = off)`);
  console.log(`detection block:   ${d[314] !== 0} (R11's full-escrow-tier switch)`);
  console.log(`next pool id:      ${d.readBigUInt64LE(315)}`);
  if (d.length >= CONFIG_SPACE_V2) {
    // The 2026-09-07 tail (keeper 380, fill_deadline_seconds 412,
    // cooldown_seconds 420, tier_next_open_at 428).
    const nextOpen: bigint[] = [];
    for (let t = 0; t < N_TIERS; t++) nextOpen.push(d.readBigInt64LE(428 + 8 * t));
    console.log(`keeper:            ${new PublicKey(d.subarray(380, 412)).toBase58()}`);
    console.log(`fill deadline:     ${d.readBigInt64LE(412)} s`);
    console.log(`cooldown:          ${d.readBigInt64LE(420)} s`);
    console.log(`tier next open at: [${nextOpen.join(', ')}] (unix s; 0 = never settled)`);
  }
  if (d.length >= CONFIG_SPACE) {
    // The Phase B tail (hard_open_tiers 484, hard_active_pool_by_tier 491,
    // hard_tier_next_open_at 547) — the hard ladder.
    const hardOpen: number[] = [];
    const hardActive: bigint[] = [];
    const hardNext: bigint[] = [];
    for (let t = 0; t < N_TIERS; t++) {
      hardOpen.push(d[484 + t]);
      hardActive.push(d.readBigUInt64LE(491 + 8 * t));
      hardNext.push(d.readBigInt64LE(547 + 8 * t));
    }
    console.log(`hard open tiers:   [${hardOpen.join(', ')}]`);
    console.log(`hard live pools:   [${hardActive.join(', ')}] (0 = none)`);
    console.log(`hard next open at: [${hardNext.join(', ')}] (unix s)`);
  }
  console.log(`platform balance:  ${BigInt(platform?.lamports ?? 0)} lamports`);
}

/** `Config::SPACE` since Phase B (state.rs, 2026-09-24): 603. `CONFIG_SPACE_V2`
 * is the 2026-09-07..Phase-B size the live devnet account holds until
 * `migrate-config` runs; `CONFIG_SPACE_V1` the original, which nothing can
 * grow any more. */
const CONFIG_SPACE = 603;
const CONFIG_SPACE_V2 = 484;
const CONFIG_SPACE_V1 = 380;

/** `Pool::SPACE` since Phase B (state.rs) — 850; 849 from R7-b until then
 * (`min_seats` present, `mode` absent) and 847 before R7-b. `migrate-pool`
 * tells them apart by length; the program grows either old size. */
const POOL_SPACE = 850;

/* The drain verdict and its fixtures live in their own module so CI can run
 * them with no dependencies at all — this file imports @solana/web3.js and the
 * standing-rules lane installs no workspace. See scripts/drain-verdict.ts. */
import {
  POOL_STATES,
  drainVerdict,
  selfTestDrainVerdict,
  type PoolRow,
} from './drain-verdict';

/** Read-only: every pool 1..next_pool_id−1 by fixed offsets (state.rs since
 * D-A1 v2 — the same offsets chain-web3.ts::getPool and the LiteSVM readers
 * pin: id 8 | tier 16 | entry 17 | pot 25 | entrants 33 | opened_at 35 |
 * fill_deadline 43 | state 51), then the drain verdict, timestamped so the
 * output can be kept as the record the runbook asks for. */
async function cmdPools(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.get('self-test') !== undefined) {
    process.exitCode = selfTestDrainVerdict();
    return;
  }
  const upgradePreflight = ctx.cli.flags.get('upgrade-preflight') !== undefined;
  const cfg = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!cfg) {
    console.log('config: NOT INITIALISED (run init-config)');
    return;
  }
  const next = cfg.data.readBigUInt64LE(315);
  console.log(`drain query at ${new Date().toISOString()} — program ${ctx.programId.toBase58()}`);
  console.log('id    tier  mode  state      entrants  pot_lamports     fill_deadline (unix)');
  const rows: PoolRow[] = [];
  const tally = new Map<string, number>();
  for (let id = 1n; id < next; id++) {
    const info = await ctx.connection.getAccountInfo(ctx.pdas.pool(id), 'confirmed');
    if (!info) {
      console.log(`${id.toString().padEnd(5)} (no account — gap in the id sequence)`);
      continue;
    }
    const d = info.data;
    const state = POOL_STATES[d[51]] ?? `unknown(${d[51]})`;
    // `mode` is the last byte since Phase B (offset 849); a pool at an
    // older size has none and played easy.
    const mode = d.length > 849 ? (d[849] === 1 ? 'hard' : 'easy') : 'easy';
    tally.set(state, (tally.get(state) ?? 0) + 1);
    rows.push({ id, state });
    console.log(
      `${id.toString().padEnd(5)} ${String(d[16]).padEnd(5)} ${mode.padEnd(5)} ${state.padEnd(10)} ` +
        `${String(d.readUInt16LE(33)).padEnd(9)} ${d.readBigUInt64LE(25).toString().padEnd(16)} ` +
        `${d.readBigInt64LE(43)}`
    );
  }
  console.log(
    `pools: ${next - 1n} — ` +
      [...tally.entries()].map(([s, n]) => `${s} ${n}`).join(', ')
  );
  const verdict = drainVerdict(rows, upgradePreflight);
  for (const line of verdict.lines) console.log(line);
  if (verdict.blocked) process.exitCode = 1;
}

async function cmdInitConfig(ctx: Ctx): Promise<void> {
  const entrySigner = new PublicKey(need(ctx.cli, 'entry-signer'));
  const settlementSigner = new PublicKey(need(ctx.cli, 'settlement-signer'));
  const keeper = new PublicKey(need(ctx.cli, 'keeper'));
  const ceilings = need(ctx.cli, 'ceilings')
    .split(',')
    .map((v) => parseAmount(v));
  if (ceilings.length !== N_TIERS) {
    throw new Error(`--ceilings must list exactly ${N_TIERS} values`);
  }
  const minPlatform = parseAmount(need(ctx.cli, 'min-platform'));
  const admin = signerPubkey(ctx.cli);
  const ceilingsBuf = Buffer.concat(ceilings.map(u64le));
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: admin, isSigner: true, isWritable: true },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
          disc('init_config'),
          entrySigner.toBuffer(),
          settlementSigner.toBuffer(),
          keeper.toBuffer(),
          ceilingsBuf,
          u64le(minPlatform),
        ]),
      }),
    ],
    'the account becoming admin'
  );
}

/** `migrate_config()` — admin-signed, one-shot; the admin pays the rent
 * top-up (hence `isWritable` on the signer). The Phase B (V2 → V3) growth:
 * no argument. Refused by the program once the account is 603 bytes, and
 * refused for the original 380-byte layout. */
async function cmdMigrateConfig(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.has('keeper')) {
    throw new Error(
      'migrate-config takes no --keeper since Phase B: the migration preserves the keeper ' +
        'already in the account (rotate it with set-keeper)'
    );
  }
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) throw new Error('config: NOT INITIALISED (run init-config)');
  console.log(`config: ${info.data.length} bytes on chain`);
  if (info.data.length >= CONFIG_SPACE) {
    console.log(`config: already at the current layout (${CONFIG_SPACE}) — nothing to do`);
    return;
  }
  if (info.data.length !== CONFIG_SPACE_V2) {
    throw new Error(
      `config is ${info.data.length} bytes; the Phase B migration grows exactly ${CONFIG_SPACE_V2}`
    );
  }
  const admin = signerPubkey(ctx.cli);
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: admin, isSigner: true, isWritable: true },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: disc('migrate_config'),
      }),
    ],
    'admin'
  );
}

async function cmdSetKeeper(ctx: Ctx): Promise<void> {
  const keeper = new PublicKey(need(ctx.cli, 'keeper'));
  await deliver(ctx, [adminOnlyIx(ctx, 'set_keeper', keeper.toBuffer())], 'admin');
}

/**
 * A `u64` pool id from the command line. Rejects anything that is not a plain
 * decimal integer rather than letting `BigInt` throw its own message, because
 * the operator reading the refusal is mid-recovery on a stuck pool.
 */
function parsePoolId(raw: string): bigint {
  const text = raw.trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Error(`--pool-id must be a whole number, got ${JSON.stringify(raw)}`);
  }
  const id = BigInt(text);
  if (id > 0xffffffffffffffffn) throw new Error(`--pool-id does not fit a u64: ${text}`);
  return id;
}

/** Seconds as an integer string; the program refuses 0 (InvalidTiming). */
function parseSeconds(raw: string, flag: string): bigint {
  if (!/^[0-9]+$/.test(raw.trim())) throw new Error(`--${flag} must be integer seconds, got ${raw}`);
  const v = BigInt(raw.trim());
  if (v <= 0n) throw new Error(`--${flag} must be greater than zero`);
  return v;
}

async function cmdSetPoolTiming(ctx: Ctx): Promise<void> {
  const fill = parseSeconds(need(ctx.cli, 'fill-deadline'), 'fill-deadline');
  const cooldown = parseSeconds(need(ctx.cli, 'cooldown'), 'cooldown');
  const i64le = (v: bigint): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(v);
    return b;
  };
  await deliver(
    ctx,
    [adminOnlyIx(ctx, 'set_pool_timing', Buffer.concat([i64le(fill), i64le(cooldown)]))],
    'admin'
  );
}

/** `forfeit_escrow(pool_id)` — admin-signed since 2026-09-07 (prompt v2
 * §E.2): review upheld a flag. The vault is listed read-only and the
 * treasury not at all: nothing moves, the share waits for `pay_next_place`. */
async function cmdForfeitEscrow(ctx: Ctx): Promise<void> {
  const poolIdRaw = need(ctx.cli, 'pool-id');
  if (!/^[0-9]+$/.test(poolIdRaw)) throw new Error(`--pool-id must be an integer, got ${poolIdRaw}`);
  const poolId = BigInt(poolIdRaw);
  const player = new PublicKey(need(ctx.cli, 'player'));
  const pool = ctx.pdas.pool(poolId);
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: false },
          { pubkey: pool, isSigner: false, isWritable: false },
          { pubkey: ctx.pdas.vault(poolId), isSigner: false, isWritable: false },
          { pubkey: ctx.pdas.entry(pool, player), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('forfeit_escrow'), u64le(poolId)]),
      }),
    ],
    'admin'
  );
}

/**
 * Lift a sanctions hold (Phase 2 Stage F). Admin-signed, like
 * `forfeit-escrow` and for the same reason: taking a hold OFF a wallet a
 * published list matched is a multi-party act, and on mainnet this is a
 * Squads proposal that leaves a record of who cleared it.
 *
 * Its counterpart, `place_sanctions_hold`, is settlement-signed and has NO
 * command here on purpose. A hold is what a screening produced; an operator
 * placing one by hand would be withholding a prize on a judgement nobody
 * screened, which is exactly what the published sentence promises we do not
 * do. Nothing here moves a lamport either way.
 */
async function cmdLiftSanctionsHold(ctx: Ctx): Promise<void> {
  const poolIdRaw = need(ctx.cli, 'pool-id');
  if (!/^[0-9]+$/.test(poolIdRaw)) throw new Error(`--pool-id must be an integer, got ${poolIdRaw}`);
  const poolId = BigInt(poolIdRaw);
  const player = new PublicKey(need(ctx.cli, 'player'));
  const pool = ctx.pdas.pool(poolId);
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: false },
          { pubkey: pool, isSigner: false, isWritable: false },
          { pubkey: ctx.pdas.entry(pool, player), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('lift_sanctions_hold'), u64le(poolId)]),
      }),
    ],
    'admin'
  );
}

/** AdminOnly-struct instructions share this account order. */
function adminOnlyIx(ctx: Ctx, name: string, args: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    keys: [
      { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
      { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([disc(name), args]),
  });
}

/**
 * `set-open-tiers` — the ONLY way a tier becomes openable, and the last
 * guard before a pool can be funded at the wrong prize.
 *
 * TWO REFUSALS WERE ADDED ON 2026-09-13 (founder instruction 2026-09-12
 * §2.5), both about the same failure, which the devnet rehearsal runbook
 * describes at §E2 and which the pre-flight of the same day confirmed by
 * reading the account:
 *
 *   Six tiers on devnet still carry their PRE-D-E1 pots — tier 1 reads
 *   25.6 SOL where the ratified table says 20. `open_pool` funds a vault
 *   from the treasury at whatever `Config` says, and a prize once published
 *   cannot be un-published. `open_tiers` is the only thing holding that
 *   back, so the command that lifts it is the right place to check.
 *
 * So: this refuses to enable a tier whose live pot or price disagrees with
 * the source table, and it refuses to enable more than one additional tier
 * in a single call — `1,1,1,1,1,1,1` is one keystroke away from
 * `1,0,0,0,0,0,0` and would open six mispriced tiers at once.
 *
 * `--dry-run` prints the comparison and sends nothing. Both refusals apply
 * to a real send AND to `--emit-proposal`, because the proposal is the thing
 * a signer will approve without re-deriving any of this.
 *
 * Disabling is never refused. Closing a tier cannot publish a wrong prize,
 * and an operator closing a tier under pressure must not be argued with.
 */
async function cmdSetOpenTiers(ctx: Ctx): Promise<void> {
  const tiers = need(ctx.cli, 'tiers')
    .split(',')
    .map((v) => {
      if (v !== '0' && v !== '1') throw new Error(`--tiers entries must be 0 or 1, got ${v}`);
      return v === '1' ? 1 : 0;
    });
  if (tiers.length !== N_TIERS) throw new Error(`--tiers must list exactly ${N_TIERS} values`);
  // Phase B: which ladder. The hard ladder has its own instruction so a
  // proposal drafted against the easy setter keeps its payload.
  const modeFlag = ctx.cli.flags.get('mode') ?? 'easy';
  if (modeFlag !== 'easy' && modeFlag !== 'hard') {
    throw new Error(`--mode must be easy or hard, got ${modeFlag}`);
  }
  const hard = modeFlag === 'hard';

  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) throw new Error('config: NOT INITIALISED (run init-config)');
  const d = info.data;
  if (hard && d.length < CONFIG_SPACE) {
    throw new Error(
      `REFUSED — the live Config is ${d.length} bytes and carries no hard ladder; run ` +
        '`migrate-config` after the Phase B upgrade first (docs/RUNBOOK_phase-b-window.md)'
    );
  }
  const current: number[] = [];
  const livePrice: bigint[] = [];
  const livePot: bigint[] = [];
  for (let t = 0; t < N_TIERS; t++) {
    // Easy at 105; the hard switch at 484 (state.rs, the Phase B tail).
    current.push(hard ? d[484 + t] : d[105 + t]);
    livePrice.push(d.readBigUInt64LE(168 + 8 * t));
    livePot.push(d.readBigUInt64LE(224 + 8 * t));
  }

  const opening = tiers.map((v, t) => v === 1 && current[t] !== 1).reduce<number[]>(
    (acc, isOpening, t) => (isOpening ? [...acc, t] : acc),
    []
  );
  const closing = tiers
    .map((v, t) => v === 0 && current[t] === 1)
    .reduce<number[]>((acc, isClosing, t) => (isClosing ? [...acc, t] : acc), []);

  console.log(`config:   ${ctx.pdas.config().toBase58()}`);
  console.log(`ladder:   ${modeFlag} (${hard ? 'set_hard_open_tiers' : 'set_open_tiers'})`);
  console.log(`current:  [${current.join(', ')}]`);
  console.log(`proposed: [${tiers.join(', ')}]`);
  console.log(`opening:  ${opening.length === 0 ? '(none)' : opening.join(', ')}`);
  console.log(`closing:  ${closing.length === 0 ? '(none)' : closing.join(', ')}`);

  if (opening.length > 1) {
    throw new Error(
      `REFUSED — this call would open ${opening.length} additional tiers at once ` +
        `(${opening.join(', ')}). Open one tier per call, each with its own ` +
        'proposal and its own verification. (docs/RUNBOOK_open-tier.md)'
    );
  }

  // Every tier being OPENED must already carry the ratified economics. A
  // tier already open is not re-checked: this command is not the place to
  // discover that, and refusing here would block an operator trying to
  // CLOSE something.
  const wrong: string[] = [];
  for (const t of opening) {
    if (livePrice[t] !== TIER_ENTRY_LAMPORTS[t]) {
      wrong.push(
        `tier ${t}: price on chain ${livePrice[t]} lamports, source table ${TIER_ENTRY_LAMPORTS[t]}`
      );
    }
    if (livePot[t] !== TIER_POT_LAMPORTS[t]) {
      wrong.push(
        `tier ${t}: pot on chain ${livePot[t]} lamports, source table ${TIER_POT_LAMPORTS[t]}`
      );
    }
  }
  if (wrong.length > 0) {
    throw new Error(
      'REFUSED — a tier being opened does not carry the ratified economics:\n  ' +
        wrong.join('\n  ') +
        '\n\nThe next pool in that tier would be funded from the treasury at the ' +
        'figure above and would publish it as the prize. Run `set-tier-economics` ' +
        'for that tier first, confirm with `status`, then run this again. ' +
        '(docs/RUNBOOK_open-tier.md)'
    );
  }

  if (ctx.cli.flags.get('dry-run') !== undefined) {
    console.log('\ndry run: checks passed, nothing sent.');
    return;
  }
  await deliver(
    ctx,
    [adminOnlyIx(ctx, hard ? 'set_hard_open_tiers' : 'set_open_tiers', Buffer.from(tiers))],
    'admin'
  );
}

/** Strict boolean flag — anything but "true"/"false" is an error rather
 * than a silent falsy, because these flags gate money and the kill switch. */
function parseBool(raw: string, flag: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`--${flag} must be true or false, got ${raw}`);
}

/** Tier index shared by the per-tier setters. */
function parseTier(raw: string): number {
  const t = Number(raw);
  if (!Number.isInteger(t) || t < 0 || t >= N_TIERS) {
    throw new Error(`--tier must be an integer 0-${N_TIERS - 1}, got ${raw}`);
  }
  return t;
}

/** The kill switch (R-roadmap 1.1). Blocks `register` only. */
async function cmdSetPaused(ctx: Ctx): Promise<void> {
  const paused = parseBool(need(ctx.cli, 'paused'), 'paused');
  await deliver(ctx, [adminOnlyIx(ctx, 'set_paused', Buffer.from([paused ? 1 : 0]))], 'admin');
}

async function cmdSetVaultCeiling(ctx: Ctx): Promise<void> {
  const tier = parseTier(need(ctx.cli, 'tier'));
  const ceiling = parseAmount(need(ctx.cli, 'ceiling'));
  await deliver(
    ctx,
    [adminOnlyIx(ctx, 'set_vault_ceiling', Buffer.concat([Buffer.from([tier]), u64le(ceiling)]))],
    'admin'
  );
}

async function cmdSetKycThreshold(ctx: Ctx): Promise<void> {
  const above = parseAmount(need(ctx.cli, 'above'));
  await deliver(ctx, [adminOnlyIx(ctx, 'set_kyc_threshold', u64le(above))], 'admin');
}

async function cmdSetDetectionHardBlock(ctx: Ctx): Promise<void> {
  const on = parseBool(need(ctx.cli, 'on'), 'on');
  await deliver(
    ctx,
    [adminOnlyIx(ctx, 'set_detection_hard_block', Buffer.from([on ? 1 : 0]))],
    'admin'
  );
}

/** One tier per call — the D2 precedent, for Squads proposal readability.
 * The program rejects a pot that is not a multiple of 1024 (the band table
 * divides in 1024ths; an off-grid pot would strand a residue in the vault),
 * so mirror that check here rather than burning a proposal on it. */
async function cmdSetTierEconomics(ctx: Ctx): Promise<void> {
  const tier = parseTier(need(ctx.cli, 'tier'));
  const price = parseAmount(need(ctx.cli, 'price'));
  const pot = parseAmount(need(ctx.cli, 'pot'));
  if (price <= 0n) throw new Error('--price must be greater than zero');
  if (pot <= 0n || pot % 1024n !== 0n) {
    throw new Error(`--pot must be greater than zero and a multiple of 1024 lamports, got ${pot}`);
  }
  await deliver(
    ctx,
    [
      adminOnlyIx(
        ctx,
        'set_tier_economics',
        Buffer.concat([Buffer.from([tier]), u64le(price), u64le(pot)])
      ),
    ],
    'admin'
  );
}

/** The floor `withdraw_platform` may never breach, and the balance
 * `open_pool` demands before it funds a pot. */
async function cmdSetTreasuryPolicy(ctx: Ctx): Promise<void> {
  const reserve = Number(need(ctx.cli, 'reserve-pots'));
  if (!Number.isInteger(reserve) || reserve < 0 || reserve > 255) {
    throw new Error(`--reserve-pots must fit a u8, got ${reserve}`);
  }
  const minPlatform = parseAmount(need(ctx.cli, 'min-platform'));
  await deliver(
    ctx,
    [
      adminOnlyIx(
        ctx,
        'set_treasury_policy',
        Buffer.concat([Buffer.from([reserve]), u64le(minPlatform)])
      ),
    ],
    'admin'
  );
}

/**
 * Rotate the service signers.
 *
 * D-08 (audit 2026-09-11): `Config.keeper` is a THIRD key, and it is the only
 * one `open_pool` accepts. The daemon holds one keypair and uses it as both
 * the settlement signer and the keeper, so rotating the settlement signer
 * alone left the keeper pointing at the retired key — and no new pool could
 * open until somebody noticed and ran `set-keeper` separately. That is a
 * quiet outage during a key rotation, which is exactly when nobody is looking
 * for one.
 *
 * So a settlement rotation now carries the keeper with it by default, in the
 * SAME transaction, and `--keep-keeper` is the explicit way to say the two
 * keys are genuinely different on this deployment. Naming the keeper
 * outright still wins over both.
 */
async function cmdRegisterSigners(ctx: Ctx): Promise<void> {
  const entry = ctx.cli.flags.get('entry-signer');
  const settlement = ctx.cli.flags.get('settlement-signer');
  const keeper = ctx.cli.flags.get('keeper');
  const keepKeeper = ctx.cli.flags.get('keep-keeper') !== undefined;
  if (!entry && !settlement && !keeper) {
    throw new Error('pass --entry-signer and/or --settlement-signer and/or --keeper');
  }
  if (keeper && keepKeeper) {
    throw new Error('--keeper and --keep-keeper contradict each other; pass one');
  }
  const ixs: TransactionInstruction[] = [];
  if (entry) {
    ixs.push(adminOnlyIx(ctx, 'rotate_entry_signer', new PublicKey(entry).toBuffer()));
  }
  if (settlement) {
    ixs.push(adminOnlyIx(ctx, 'set_settlement_signer', new PublicKey(settlement).toBuffer()));
  }
  // The keeper the caller named, or the settlement key it follows.
  const keeperKey = keeper ?? (settlement && !keepKeeper ? settlement : undefined);
  if (keeperKey) {
    ixs.push(adminOnlyIx(ctx, 'set_keeper', new PublicKey(keeperKey).toBuffer()));
    if (!keeper) {
      console.log(
        `note: the keeper follows the settlement signer to ${keeperKey}. ` +
          'Pass --keep-keeper if this deployment runs them as different keys, ' +
          'or --keeper <pubkey> to name a third.'
      );
    }
  } else if (settlement) {
    console.log(
      'note: --keep-keeper given, so Config.keeper is UNCHANGED. Confirm with ' +
        '`admin.ts status` that it still names a key the operator holds — ' +
        'open_pool accepts no other.'
    );
  }
  await deliver(ctx, ixs, 'admin');
}

/**
 * The three permissionless settlement instructions, by hand (audit
 * 2026-09-11, D-06).
 *
 * The runbook's recovery notes say of a stuck pool "send it by hand — it is
 * permissionless", and then give a READ-ONLY command. Nothing in this
 * repository could send `seal_at_deadline`, `trigger_refund` or `refund`
 * outside the settlement daemon. So the documented recovery for a daemon that
 * is down, wedged, or refusing a particular pool was a procedure with no tool
 * behind it.
 *
 * All three are permissionless on chain: the signer pays the fee and decides
 * nothing. The program checks the pool's state and its deadlines, so a
 * mistimed call is refused rather than acted on — which is what makes it safe
 * to put these in an operator's hands.
 *
 * `--emit-proposal` works on them like every other command here, though none
 * of them needs the multisig: they are not admin instructions.
 */
/**
 * `migrate-pool` — the one-shot Pool account growth, once per existing pool.
 *
 * Anchor refuses a short account, so until this runs against a pool EVERY
 * instruction touching it fails — `pay_next_place` and `release_escrow`
 * included, on pools that are already Paid. Two old sizes exist on devnet
 * (state.rs): 847 (pre-R7-b, 2026-09-12 — gets `min_seats` = 52, the floor
 * those players entered under, never the new 40, then `mode`) and 849
 * (pre-Phase-B, 2026-09-24 — gets `mode` alone, floor kept). `mode` is
 * always easy: hard did not exist when those pools opened.
 *
 * Permissionless and self-disabling: it writes known constants into one
 * PDA-checked account and refuses anything already at the current layout.
 * `--all` walks every pool 1..next_pool_id−1 and sends one transaction per
 * pool that needs it — the Phase B window has dozens.
 */
async function cmdMigratePool(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.get('all') !== undefined) {
    const cfg = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
    if (!cfg) throw new Error('config: NOT INITIALISED (run init-config)');
    const next = cfg.data.readBigUInt64LE(315);
    let sent = 0;
    for (let id = 1n; id < next; id++) {
      const done = await migrateOnePool(ctx, id);
      if (done) sent++;
    }
    console.log(`migrate-pool --all: ${sent} pool(s) migrated, ${next - 1n - BigInt(sent)} already current`);
    return;
  }
  await migrateOnePool(ctx, parsePoolId(need(ctx.cli, 'pool-id')));
}

/** One pool; true when a migration was sent (or emitted), false when none was needed. */
async function migrateOnePool(ctx: Ctx, poolId: bigint): Promise<boolean> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.pool(poolId), 'confirmed');
  if (!info) throw new Error(`pool ${poolId}: no account at ${ctx.pdas.pool(poolId).toBase58()}`);
  // Said before sending, because the on-chain refusal is a bare error code
  // and an operator working through a list of pools needs to tell "already done"
  // from "wrong pool".
  console.log(`pool ${poolId}: ${info.data.length} bytes on chain`);
  if (info.data.length >= POOL_SPACE) {
    console.log(`pool ${poolId}: already at the current layout (${POOL_SPACE}) — nothing to do`);
    return false;
  }
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: true },
          { pubkey: ctx.pdas.pool(poolId), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('migrate_pool'), u64le(poolId)]),
      }),
    ],
    'any signer (permissionless)'
  );
  return true;
}

async function cmdSealAtDeadline(ctx: Ctx): Promise<void> {
  const poolId = parsePoolId(need(ctx.cli, 'pool-id'));
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.pool(poolId), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([disc('seal_at_deadline'), u64le(poolId)]),
      }),
    ],
    'any signer (permissionless)'
  );
}

async function cmdTriggerRefund(ctx: Ctx): Promise<void> {
  const poolId = parsePoolId(need(ctx.cli, 'pool-id'));
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.pool(poolId), isSigner: false, isWritable: true },
          // The untouched pot returns vault → treasury at trigger. The rent
          // cushion stays in the vault, which is what keeps the account alive.
          { pubkey: ctx.pdas.vault(poolId), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('trigger_refund'), u64le(poolId)]),
      }),
    ],
    'any signer (permissionless)'
  );
}

async function cmdRefund(ctx: Ctx): Promise<void> {
  const poolId = parsePoolId(need(ctx.cli, 'pool-id'));
  const player = new PublicKey(need(ctx.cli, 'player'));
  const pool = ctx.pdas.pool(poolId);
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: pool, isSigner: false, isWritable: true },
          // D-A1 revised: the FULL entry price back, from the treasury.
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.entry(pool, player), isSigner: false, isWritable: true },
          { pubkey: player, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('refund'), u64le(poolId)]),
      }),
    ],
    'any signer (permissionless)'
  );
}

async function cmdFundPlatformWallet(ctx: Ctx): Promise<void> {
  const amount = parseAmount(need(ctx.cli, 'amount'));
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          // Permissionless: the funder is whoever signs.
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: true },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: false },
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('fund_platform_wallet'), u64le(amount)]),
      }),
    ],
    'any funder'
  );
}

async function cmdWithdrawPlatform(ctx: Ctx): Promise<void> {
  const amount = parseAmount(need(ctx.cli, 'amount'));
  const destination = new PublicKey(need(ctx.cli, 'destination'));
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: false },
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('withdraw_platform'), u64le(amount)]),
      }),
    ],
    'admin'
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.command || cli.command === '--help' || cli.command === 'help') {
    console.log(USAGE);
    return;
  }
  const programId = new PublicKey(
    cli.flags.get('program') ?? process.env.BLOTTO_PROGRAM_ID ?? DEFAULT_PROGRAM_ID
  );
  const ctx: Ctx = {
    connection: new Connection(cli.flags.get('rpc') ?? process.env.RPC_URL ?? DEFAULT_RPC, {
      commitment: 'confirmed',
    }),
    programId,
    pdas: new Pdas(programId),
    cli,
  };
  switch (cli.command) {
    case 'status':
      return cmdStatus(ctx);
    case 'pools':
      return cmdPools(ctx);
    case 'init-config':
      return cmdInitConfig(ctx);
    case 'migrate-config':
      return cmdMigrateConfig(ctx);
    case 'set-keeper':
      return cmdSetKeeper(ctx);
    case 'set-pool-timing':
      return cmdSetPoolTiming(ctx);
    case 'forfeit-escrow':
      return cmdForfeitEscrow(ctx);
    case 'lift-sanctions-hold':
      return cmdLiftSanctionsHold(ctx);
    case 'set-open-tiers':
      return cmdSetOpenTiers(ctx);
    case 'set-paused':
      return cmdSetPaused(ctx);
    case 'set-vault-ceiling':
      return cmdSetVaultCeiling(ctx);
    case 'set-kyc-threshold':
      return cmdSetKycThreshold(ctx);
    case 'set-detection-hard-block':
      return cmdSetDetectionHardBlock(ctx);
    case 'set-tier-economics':
      return cmdSetTierEconomics(ctx);
    case 'set-treasury-policy':
      return cmdSetTreasuryPolicy(ctx);
    case 'seal-at-deadline':
      return cmdSealAtDeadline(ctx);
    case 'migrate-pool':
      return cmdMigratePool(ctx);
    case 'trigger-refund':
      return cmdTriggerRefund(ctx);
    case 'refund':
      return cmdRefund(ctx);
    case 'register-signers':
      return cmdRegisterSigners(ctx);
    case 'fund-platform-wallet':
      return cmdFundPlatformWallet(ctx);
    case 'withdraw-platform':
      return cmdWithdrawPlatform(ctx);
    default:
      console.error(`unknown command: ${cli.command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
