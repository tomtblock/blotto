/**
 * The admin CLI (master prompt v3, E3): every operator instruction the
 * program gates on the admin key, plus the permissionless treasury deposit,
 * runnable two ways —
 *
 *   direct-signed  FEE_PAYER_KEYPAIR=/path/to/admin.json (devnet rehearsal:
 *                  the admin is a local keypair)
 *   --emit-proposal  print the instruction (accounts + base64 data) WITHOUT
 *                  signing or sending — the Squads seam: the admin is the
 *                  Squads vault, and this output is what goes into the
 *                  proposal. Nothing in this script can sign for a multisig,
 *                  by design; `scripts/squads-v3.ts` executes the emitted
 *                  payload through a Squads v3 multisig with a member key.
 *                  In this mode stdout carries ONLY the JSON payload (every
 *                  diagnostic goes to stderr), so it can be redirected to a
 *                  file and handed to squads-v3.ts unedited.
 *
 * Instruction bytes are hand-encoded against the program's wire contract
 * (Anchor global discriminators + Borsh args + the exact account orders in
 * programs/blotto_cup/src/instructions/) — the same encoding
 * backend/reveal/src/chain-web3.ts uses, which the LiteSVM suite pins.
 * Accounts are DECODED through the shared layouts in backend/_shared/src
 * (config-account, pool-account, pool-type-account), never by a second copy
 * of the offsets, apart from the handful of Config fields the shared view
 * does not carry (the three keys, the ceilings, the KYC and detection
 * switches), whose offsets are commented where they are read.
 *
 * Money flags take LAMPORTS (integers) or exact decimal SOL strings parsed
 * in bigint — no float ever touches an amount.
 *
 * Run:  npx ts-node --transpile-only scripts/admin.ts <command> [flags]
 * Docs: docs/guide/OPERATING-MANUAL.md §3–§5, docs/guide/DEVNET-REHEARSAL.md.
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

import { resolveRpcUrl } from '../backend/_shared/src/cluster';
import { base58Encode } from '../backend/_shared/src/blotto-events';
import {
  CONFIG_SPACE,
  CONFIG_SPACE_V1,
  CONFIG_SPACE_V2,
  CONFIG_SPACE_V3,
  N_TIERS,
  decodeConfigAccount,
  type ConfigAccountView,
} from '../backend/_shared/src/config-account';
import {
  POOL_OFFSETS,
  POOL_SPACE,
  decodePoolHead,
  type PoolHead,
} from '../backend/_shared/src/pool-account';
import {
  POOL_TYPE_SPACE,
  compareAddressBytes,
  decodePoolTypeAccount,
  poolTypeSeeds,
  type PoolTypeView,
} from '../backend/_shared/src/pool-type-account';
// The ratified tier prices and the Ladder's launch tables (D-E19), from the
// module the program's constants are mirrored into and `check-mirrors.py`
// pins. The guards below compare the live accounts against these before
// anything is opened, enabled or priced.
import {
  LADDER_TABLES,
  MAX_PAID_PLACES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  assertPrizeTable,
  isPoolCapacity,
  prizePoolFor,
  type PoolCapacity,
} from '../backend/scoring/src/prizes';

/* The drain verdict and its fixtures live in their own module so CI can run
 * them with no dependencies at all — this file imports @solana/web3.js and the
 * standing-rules lane installs no workspace. See scripts/drain-verdict.ts. */
import {
  POOL_STATES,
  drainVerdict,
  selfTestDrainVerdict,
  type PoolRow,
} from './drain-verdict';

const DEFAULT_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
/** The devnet fallback; the endpoint follows BLOTTO_CLUSTER / BLOTTO_RPC_URL (RPC_URL kept as an alias). */
const DEFAULT_RPC = resolveRpcUrl({ BLOTTO_CLUSTER: process.env.BLOTTO_CLUSTER, BLOTTO_RPC_URL: process.env.BLOTTO_RPC_URL ?? process.env.RPC_URL });

/** `Pool::SPACE_V1` — the pre-R7-b size (847). The shared decoder refuses it
 * (no reader has met one since devnet migrated); `migrate-pool` still grows
 * it, and `pools` still lists it by the one offset every layout shares. */
const POOL_SPACE_V1 = 847;

/** sha256("account:PoolType")[..8] — wire contract; pinned in pool-type-account's tests. */
const POOL_TYPE_DISCRIMINATOR = Buffer.from('23bee6af4b720965', 'hex');

const MODE_NAMES = ['easy', 'hard'] as const;

const USAGE = `blotto-cup admin CLI

  npx ts-node --transpile-only scripts/admin.ts <command> [flags]

commands
  status                    read Config, every pool type and the treasury
  pools                     read every pool's state — the drain query the
                            D-E2/D-E4 runbook section records before an
                            upgrade (read-only; exits 1 while any pool is
                            Sealed, Scored or Refunding)
      [--upgrade-preflight] ALSO refuse while any pool is Open. Off by
                            default because a pool is Open almost always and
                            this is the ordinary status command. See
                            docs/guide/OPERATING-MANUAL.md §4
      [--self-test]         drive the verdict through its fixtures and exit.
                            Touches no network
  init-config               one-time setup (admin = the signing key)
      --entry-signer <pubkey> --settlement-signer <pubkey> --keeper <pubkey>
      --ceilings <7 comma-separated lamport values>
      --min-platform <lamports | SOL decimal ending in "sol", e.g. 2sol>
  migrate-pool              PERMISSIONLESS. The one-shot Pool account growth
                            to the current layout (${POOL_SPACE} bytes). A
                            pre-Ladder pool is written as what its players
                            entered under: 64 seats, one paid place. Run it
                            for EVERY pool right after an upgrade that grew
                            Pool — until it has, every instruction touching
                            that pool fails on the short account.
                            Self-disabling; a current pool is skipped
      --pool-id <u64>       one pool
      --all                 every pool 1..next_pool_id-1 that needs it, in
                            order, one transaction each
  migrate-config            the ONE-SHOT Config growth to the Ladder layout
                            (${CONFIG_SPACE_V3} or ${CONFIG_SPACE_V2} -> ${CONFIG_SPACE} bytes; enabled_pool_types
                            starts at 0). Run right after the upgrade, before
                            anything else — see docs/guide/OPERATING-MANUAL.md
  set-keeper                the ONLY key open_pool accepts. May not be the
                            zero key
      --keeper <pubkey>
  set-pool-timing           the fill deadline for pools opened from now on
                            and the per-type cooldown (never touches an open
                            pool); both in seconds, both > 0
      --fill-deadline <seconds> --cooldown <seconds>
  forfeit-escrow            ADMIN-signed: record that review upheld a flag.
                            Moves nothing — the share stays in the pool's
                            vault (a multi-place pool holds it until the
                            "field moves up" payout ships)
      --pool-id <u64> --player <pubkey>
  lift-sanctions-hold       ADMIN-signed: clear a sanctions hold a review
                            established was a false positive. There is
                            deliberately no command to PLACE one
      --pool-id <u64> --player <pubkey>
  set-open-tiers            which tiers may open pools (founder-owned) — the
                            tier-level R6 master switch. A pool type opens
                            only if its tier is open for its mode AND the
                            type is enabled. Refuses to open a tier whose
                            on-chain price disagrees with the ratified table
                            or any of whose enabled pool types carries stale
                            or non-launch economics, and refuses to open more
                            than one additional tier per call. Closing is
                            never refused. See docs/guide/OPERATING-MANUAL.md
      --tiers <7 comma-separated 0/1, e.g. 1,0,0,0,0,0,0>
      [--mode easy|hard]    WHICH ladder. Default easy (set_open_tiers);
                            hard sends set_hard_open_tiers
      [--dry-run]           run the checks, print current vs proposed, send
                            nothing
  init-pool-type            create the pool type for (mode, tier, capacity),
                            disabled and without a table (D-E19). The admin
                            pays its rent
      --mode easy|hard --tier <0-6> --capacity <8|16|32|64> [--dry-run]
  set-pool-type-economics   the table, minimum field and prize pool the NEXT
                            pool of a type opens with. Defaults to the LAUNCH
                            table and minimum field for the capacity and the
                            LIVE tier price; prints the computed prize pool.
                            Refuses a --pot that disagrees with it, and a
                            non-launch table unless --table names it
      --mode easy|hard --tier <0-6> --capacity <8|16|32|64>
      [--table <multiples, rank 1 first, e.g. 3,2>]  explicit non-launch table
      [--min-seats <n>]     explicit non-launch minimum field
      [--pot <lamports|SOL>] must equal the computed prize pool
      [--dry-run]
  set-pool-type-enabled     switch a pool type on or off. Enabling refuses
                            unless its economics are set, current at the live
                            price, and the launch table (or --accept-non-launch).
                            Disabling is never refused and never touches a
                            pool already taking entries
      --mode easy|hard --tier <0-6> --capacity <8|16|32|64> --enabled <true|false>
      [--accept-non-launch] [--dry-run]
  ladder-launch             the full ordered instruction set that brings a
                            launch grid live: migrate-config while Config is
                            pre-Ladder, then per pool type init -> economics
                            -> enable, skipping any step the chain already
                            reflects. Prints the plan; with --emit-proposal
                            emits it as ONE JSON array (for squads-v3.ts).
                            Sends nothing
      --tier <0-6> --modes <easy,hard> --capacities <8,16,32,64>
  set-paused                the kill switch: blocks register, and ONLY
                            register (reveal/payout/refund keep working, so
                            a pause never strands funds)
      --paused <true|false>
  set-vault-ceiling         one tier's gross-intake ceiling (D2): price x the
                            pool's capacity must fit under it at open_pool
      --tier <0-6> --ceiling <lamports | e.g. 6.4sol>
  set-kyc-threshold         KYC-at-claim switch (R3); 0 disables
      --above <lamports | e.g. 1sol>
  set-detection-hard-block  R11's full-escrow-tier switch
      --on <true|false>
  set-tier-economics        one tier's price and its 64-player reference
                            prize pool (founder-owned). Since D-E19 the tier
                            figure funds no pool; a PRICE change makes every
                            pool type of the tier stale until
                            set-pool-type-economics restates it
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
                            refusing it. Moves no lamports
      --pool-id <u64>
  trigger-refund            PERMISSIONLESS. Put an unfilled pool past its
                            deadline into Refunding (or straight to Closed
                            with no entrants), returning the untouched prize
                            pool to the treasury. Passes the pool's own type
      --pool-id <u64>
  refund                    PERMISSIONLESS. Repay one player's FULL entry from
                            the treasury, for a pool already in Refunding
      --pool-id <u64> --player <pubkey>
  fund-platform-wallet      permissionless treasury deposit
      --amount <lamports | e.g. 5sol>
  withdraw-platform         the ONE treasury exit (floor-gated on-chain;
                            passes every enabled pool type, ascending)
      --amount <lamports | e.g. 1.5sol> --destination <pubkey>

global flags
  --rpc <url>              default ${DEFAULT_RPC} (or RPC_URL)
  --program <pubkey>       default ${DEFAULT_PROGRAM_ID} (or BLOTTO_PROGRAM_ID)
  --emit-proposal          print the instruction for a Squads proposal
                           instead of signing (no keypair needed); stdout is
                           then JSON only
  --admin <vault pubkey>   the signer slot under --emit-proposal (required);
                           admin commands refuse unless it is Config.admin

env
  FEE_PAYER_KEYPAIR        path to the signing keypair JSON (direct mode)
  RPC_URL, BLOTTO_PROGRAM_ID  as above
`;

// ---------------------------------------------------------------------------
// Output. Under --emit-proposal stdout is reserved for the JSON payload, so
// every human line goes to stderr; otherwise both go to stdout as before.
// ---------------------------------------------------------------------------

let say: (...parts: unknown[]) => void = (...parts) => console.log(...parts);

// ---------------------------------------------------------------------------

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** Every instruction this CLI encodes, so an emitted payload names itself. */
const ENCODED_NAMES = [
  'init_config',
  'migrate_config',
  'migrate_pool',
  'set_keeper',
  'set_pool_timing',
  'forfeit_escrow',
  'lift_sanctions_hold',
  'set_open_tiers',
  'set_hard_open_tiers',
  'set_paused',
  'set_vault_ceiling',
  'set_kyc_threshold',
  'set_detection_hard_block',
  'set_tier_economics',
  'set_treasury_policy',
  'rotate_entry_signer',
  'set_settlement_signer',
  'seal_at_deadline',
  'trigger_refund',
  'refund',
  'fund_platform_wallet',
  'withdraw_platform',
  'init_pool_type',
  'set_pool_type_economics',
  'set_pool_type_enabled',
] as const;

const NAME_BY_DISC = new Map(ENCODED_NAMES.map((n) => [disc(n).toString('hex'), n]));

function instructionName(data: Buffer): string {
  return NAME_BY_DISC.get(data.subarray(0, 8).toString('hex')) ?? 'unknown';
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function u16le(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
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

/** Lamports as an exact SOL decimal — integer arithmetic, trailing zeros trimmed. */
function sol(lamports: bigint): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
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
 */
const SWITCHES = new Set([
  'dry-run',
  'keep-keeper',
  'upgrade-preflight',
  'self-test',
  'all',
  'accept-non-launch',
]);

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
  /** `["ptype", [mode], [tier], capacity u16 LE]` — the shared seeds, which
   * also refuse a coordinate the program would refuse. */
  poolType(mode: number, tier: number, capacity: number): PublicKey {
    return this.pda(poolTypeSeeds(mode, tier, capacity).map((s) => Buffer.from(s)));
  }
}

interface Ctx {
  connection: Connection;
  programId: PublicKey;
  pdas: Pdas;
  cli: Cli;
}

/** One instruction with what a reviewer needs to recognise it. */
interface Step {
  ix: TransactionInstruction;
  /** One line a signer can check against the payload. */
  summary?: string;
  /** Instructions sharing a group are executed together (squads-v3.ts). */
  group?: string;
}

function emitted(ix: TransactionInstruction, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    instruction: instructionName(ix.data),
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    dataBase64: ix.data.toString('base64'),
  };
}

/**
 * Admin commands name the admin in their signer slot. Before printing a
 * proposal or sending, compare it with the admin the live Config records:
 * a proposal built for the wrong vault is refused by the program
 * (`has_one = admin`) only after every signer has approved it.
 */
async function assertAdminSigner(ctx: Ctx, ixs: TransactionInstruction[]): Promise<void> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info || info.data.length < 40) return; // init-config, or nothing to compare against
  const admin = new PublicKey(info.data.subarray(8, 40)); // `admin` is the first field after the discriminator
  for (const ix of ixs) {
    const signer = ix.keys.find((k) => k.isSigner)?.pubkey;
    if (!signer || !signer.equals(admin)) {
      throw new Error(
        `REFUSED — the signer slot names ${signer?.toBase58() ?? '(none)'} but Config.admin is ` +
          `${admin.toBase58()}. The program would refuse this (has_one = admin) after every ` +
          'signer had approved it. Pass --admin <the vault Config names>.'
      );
    }
  }
}

/** Direct mode signs and sends; --emit-proposal prints the Squads payload. */
async function deliver(ctx: Ctx, ixs: TransactionInstruction[], signerRole: string): Promise<void> {
  if (signerRole === 'admin') await assertAdminSigner(ctx, ixs);
  if (ctx.cli.emitProposal) {
    for (const ix of ixs) {
      console.log(
        JSON.stringify(
          emitted(ix, { note: `signer role: ${signerRole} — the Squads vault executes this` }),
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
  say(`confirmed: ${sig}`);
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
// Reading the chain — through the shared decoders.
// ---------------------------------------------------------------------------

interface LiveConfig {
  raw: Buffer;
  view: ConfigAccountView;
  admin: PublicKey;
}

/** Config, decoded. `null` when it does not exist; throws (by name) on a
 * layout the shared decoder refuses — the 380-byte original, or any size no
 * reader knows. */
async function readConfig(ctx: Ctx): Promise<LiveConfig | null> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) return null;
  return {
    raw: info.data,
    view: decodeConfigAccount(info.data),
    admin: new PublicKey(info.data.subarray(8, 40)),
  };
}

async function needConfig(ctx: Ctx): Promise<LiveConfig> {
  const cfg = await readConfig(ctx);
  if (!cfg) throw new Error('config: NOT INITIALISED (run init-config)');
  return cfg;
}

/** The pool-type instructions read Config as the Ladder layout. */
function needLadderConfig(cfg: LiveConfig, what: string): void {
  if (!cfg.view.ladderPresent) {
    throw new Error(
      `REFUSED — the live Config is ${cfg.raw.length} bytes, the pre-Ladder layout; ${what} ` +
        `reads it as the Ladder layout (${CONFIG_SPACE} bytes) and would fail. Run ` +
        '`migrate-config` after the Ladder upgrade first (or use `ladder-launch`, which ' +
        'puts it first). docs/guide/OPERATING-MANUAL.md §4'
    );
  }
}

/** The vault ceilings (D2) — not in the shared view; `vault_ceiling_lamports` at 112 (7 × u64). */
function vaultCeiling(cfg: LiveConfig, tier: number): bigint {
  return cfg.raw.readBigUInt64LE(112 + 8 * tier);
}

function tierOpenFor(view: ConfigAccountView, mode: number, tier: number): boolean {
  return mode === 1 ? view.hardOpenTiers[tier] : view.openTiers[tier];
}

interface LivePoolType {
  address: PublicKey;
  view: PoolTypeView;
}

/** Every PoolType account of this program, by size and discriminator. */
async function readAllPoolTypes(ctx: Ctx): Promise<LivePoolType[]> {
  const accounts = await ctx.connection.getProgramAccounts(ctx.programId, {
    commitment: 'confirmed',
    filters: [
      { dataSize: POOL_TYPE_SPACE },
      { memcmp: { offset: 0, bytes: base58Encode(POOL_TYPE_DISCRIMINATOR) } },
    ],
  });
  const out: LivePoolType[] = [];
  for (const { pubkey, account } of accounts) {
    const view = decodePoolTypeAccount(account.data, `pool type ${pubkey.toBase58()}`);
    // A pool type can only live at its own PDA (init_pool_type is the only
    // creator); say so loudly if one ever does not.
    const expected = ctx.pdas.poolType(view.mode, view.tier, view.capacity);
    if (!expected.equals(pubkey)) {
      throw new Error(
        `pool type ${pubkey.toBase58()} records (${view.mode}, ${view.tier}, ${view.capacity}) ` +
          `whose PDA is ${expected.toBase58()} — refusing to read further`
      );
    }
    out.push({ address: pubkey, view });
  }
  out.sort(
    (a, b) => a.view.mode - b.view.mode || a.view.tier - b.view.tier || a.view.capacity - b.view.capacity
  );
  return out;
}

async function readPoolType(ctx: Ctx, mode: number, tier: number, capacity: number): Promise<LivePoolType | null> {
  const address = ctx.pdas.poolType(mode, tier, capacity);
  const info = await ctx.connection.getAccountInfo(address, 'confirmed');
  if (!info) return null;
  return { address, view: decodePoolTypeAccount(info.data, `pool type ${address.toBase58()}`) };
}

/** The 16-byte on-chain form of a table: its multiples, zero-padded. */
function padTable(table: readonly number[]): number[] {
  return [...table, ...new Array<number>(MAX_PAID_PLACES - table.length).fill(0)];
}

function tableValue(rawTable: readonly number[], price: bigint): bigint {
  return rawTable.reduce((acc, m) => acc + BigInt(m) * price, 0n);
}

/** How a pool type's stored economics stand against the launch table at today's price. */
function economicsState(t: PoolTypeView, price: bigint): 'unset' | 'stale' | 'launch' | 'non-launch' {
  if (t.paidPlaces === 0 || t.potLamports === 0n || t.minSeats === 0) return 'unset';
  if (tableValue(t.prizeTable, price) !== t.potLamports) return 'stale';
  if (!isPoolCapacity(t.capacity)) return 'non-launch';
  const launch = padTable(LADDER_TABLES[t.capacity]);
  const same =
    launch.every((m, i) => m === t.prizeTable[i]) && t.minSeats === MIN_FIELD_BY_CAPACITY[t.capacity];
  return same ? 'launch' : 'non-launch';
}

function tableText(rawTable: readonly number[], paid: number): string {
  return paid === 0 ? '(none)' : rawTable.slice(0, paid).join(',');
}

function unixText(t: bigint): string {
  if (t === 0n) return '0 (never)';
  return `${t} (${new Date(Number(t) * 1000).toISOString()})`;
}

// ---------------------------------------------------------------------------
// Argument parsing shared by the pool-type commands.
// ---------------------------------------------------------------------------

function parseMode(raw: string): number {
  const v = raw.trim().toLowerCase();
  if (v === 'easy' || v === '0') return 0;
  if (v === 'hard' || v === '1') return 1;
  throw new Error(`--mode must be easy or hard, got ${raw}`);
}

function parseCapacity(raw: string): PoolCapacity {
  const t = raw.trim();
  const n = /^[0-9]+$/.test(t) ? Number(t) : NaN;
  if (!isPoolCapacity(n)) {
    throw new Error(`--capacity must be one of ${POOL_CAPACITIES.join(', ')}, got ${raw}`);
  }
  return n;
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
  const t = /^[0-9]+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(t) || t < 0 || t >= N_TIERS) {
    throw new Error(`--tier must be an integer 0-${N_TIERS - 1}, got ${raw}`);
  }
  return t;
}

function parseU16(raw: string, flag: string): number {
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) throw new Error(`--${flag} must be a whole number, got ${raw}`);
  const n = Number(t);
  if (n > 0xffff) throw new Error(`--${flag} does not fit a u16: ${raw}`);
  return n;
}

/** A prize table as whole multiples, rank 1 first, e.g. "3,2". */
function parseTable(raw: string): number[] {
  const parts = raw.split(',').map((p) => p.trim());
  const table = parts.map((p) => {
    if (!/^[0-9]+$/.test(p)) throw new Error(`--table entries must be whole numbers, got "${p}"`);
    return Number(p);
  });
  assertPrizeTable(table);
  return table;
}

function poolTypeLabel(mode: number, tier: number, capacity: number): string {
  return `${MODE_NAMES[mode]} / tier ${tier} / ${capacity} players`;
}

// ---------------------------------------------------------------------------

async function cmdStatus(ctx: Ctx): Promise<void> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) {
    say('config: NOT INITIALISED (run init-config)');
    return;
  }
  const d = info.data;
  if (d.length === CONFIG_SPACE_V1) {
    say(
      'config: the ORIGINAL 380-byte layout — no current program can grow it (the 2026-09-07 ' +
        'migration is retired). Nothing below can be read.'
    );
    process.exitCode = 1;
    return;
  }
  let view: ConfigAccountView;
  try {
    view = decodeConfigAccount(d);
  } catch (e) {
    say(`config: CANNOT DECODE — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  if (d.length === CONFIG_SPACE) {
    say(`config:            ${d.length} bytes — the Ladder layout (D-E19)`);
  } else if (d.length === CONFIG_SPACE_V3) {
    say(
      `config:            ${d.length} bytes — PRE-LADDER LAYOUT. The Ladder program reads ` +
        `${CONFIG_SPACE}: once it is deployed, every instruction that reads Config fails until ` +
        '`migrate-config` runs (docs/guide/OPERATING-MANUAL.md §4). enabled_pool_types is not ' +
        'on this account yet, and no pool type can exist.'
    );
  } else if (d.length === CONFIG_SPACE_V2) {
    say(
      `config:            ${d.length} bytes — PRE-PHASE-B LAYOUT (no hard ladder, no pool-type ` +
        `count). \`migrate-config\` grows it straight to ${CONFIG_SPACE}.`
    );
  }
  const price = view.tierPriceLamports;
  say(`admin:             ${new PublicKey(d.subarray(8, 40)).toBase58()}`);
  say(`entry signer:      ${new PublicKey(d.subarray(40, 72)).toBase58()}`);
  say(`settlement signer: ${new PublicKey(d.subarray(72, 104)).toBase58()}`);
  say(`keeper:            ${view.keeper}`);
  say(`paused:            ${view.paused}`);
  say(`open tiers (easy): [${view.openTiers.map(Number).join(', ')}]`);
  say(
    `open tiers (hard): [${view.hardOpenTiers.map(Number).join(', ')}]` +
      (view.hardLadderPresent ? '' : ' (no hard ladder on this layout)')
  );
  say(`tier prices:       [${price.join(', ')}] lamports`);
  say(
    `tier pots:         [${view.tierPotLamports.join(', ')}] lamports — the 64-player reference ` +
      'figure; since D-E19 no pool is funded from it'
  );
  const ceilings: bigint[] = [];
  for (let t = 0; t < N_TIERS; t++) ceilings.push(vaultCeiling({ raw: d, view, admin: PublicKey.default }, t));
  say(`vault ceilings:    [${ceilings.join(', ')}] lamports (price x capacity must fit)`);
  say(`reserve pots:      ${view.treasuryReservePots}`);
  say(`min platform:      ${view.treasuryMinPlatformLamports} lamports`);
  say(`reserved:          ${view.platformReserved} lamports`);
  say(`refundable:        ${view.platformRefundable} lamports`);
  // Audit 2026-09-11, D-21: both are published on chain so the operative
  // policy is public, both have a `set-` command here; read them back.
  say(`kyc threshold:     ${d.readBigUInt64LE(306)} lamports (0 = off)`);
  say(`detection block:   ${d[314] !== 0} (R11's full-escrow-tier switch)`);
  say(`next pool id:      ${view.nextPoolId}`);
  say(`fill deadline:     ${view.fillDeadlineSeconds} s`);
  say(`cooldown:          ${view.cooldownSeconds} s`);
  say(
    `enabled pool types: ${view.ladderPresent ? view.enabledPoolTypes : '(not on this layout)'}` +
      ' (Config.enabled_pool_types)'
  );
  // The per-(mode, tier) slots predate D-E19; open_pool reads each pool
  // type's own slot now. Shown so a stale value is recognisable as legacy.
  say(
    `legacy tier slots: easy [${view.activePoolByTier.join(', ')}], hard [${view.hardActivePoolByTier.join(', ')}]` +
      ' — pre-Ladder, no longer read by open_pool'
  );

  const types = await readAllPoolTypes(ctx);
  say('');
  if (types.length === 0) {
    say('pool types:        none on chain');
  } else {
    const enabledCount = types.filter((t) => t.view.enabled).length;
    say(
      `pool types:        ${types.length} on chain, ${enabledCount} enabled` +
        (view.ladderPresent && enabledCount !== view.enabledPoolTypes
          ? ` — DISAGREES with Config.enabled_pool_types = ${view.enabledPoolTypes}; open_pool and ` +
            'withdraw_platform will refuse (PoolTypeListIncomplete) until this is understood'
          : '')
    );
    say(
      'mode  tier  cap  enabled  live  min  paid  economics   table                                  prize pool (SOL)  live pool  next open (unix)'
    );
    for (const { view: t } of types) {
      const live = t.enabled && t.tier < N_TIERS && tierOpenFor(view, t.mode, t.tier);
      const p = price[t.tier] ?? 0n;
      say(
        `${(MODE_NAMES[t.mode] ?? `?${t.mode}`).padEnd(5)} ${String(t.tier).padEnd(5)} ${String(t.capacity).padEnd(4)} ` +
          `${(t.enabled ? 'yes' : 'no').padEnd(8)} ${(live ? 'yes' : 'no').padEnd(5)} ` +
          `${String(t.minSeats).padEnd(4)} ${String(t.paidPlaces).padEnd(5)} ${economicsState(t, p).padEnd(11)} ` +
          `${tableText(t.prizeTable, t.paidPlaces).padEnd(38)} ${sol(t.potLamports).padEnd(17)} ` +
          `${(t.activePool === 0n ? '-' : String(t.activePool)).padEnd(10)} ${unixText(t.nextOpenAt)}`
      );
    }
    say(
      'live = enabled AND the tier is open for that mode. economics: launch = the D-E19 table at ' +
        "today's price; stale = the price moved since it was set (open_pool refuses)."
    );
  }
  const platform = await ctx.connection.getAccountInfo(ctx.pdas.platform(), 'confirmed');
  say(`\nplatform balance:  ${BigInt(platform?.lamports ?? 0)} lamports`);
}

/** Read-only: every pool 1..next_pool_id−1 through the shared head decoder,
 * then the drain verdict, timestamped so the output can be kept as the
 * record the runbook asks for. */
async function cmdPools(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.get('self-test') !== undefined) {
    process.exitCode = selfTestDrainVerdict();
    return;
  }
  const upgradePreflight = ctx.cli.flags.get('upgrade-preflight') !== undefined;
  const cfg = await readConfig(ctx);
  if (!cfg) {
    say('config: NOT INITIALISED (run init-config)');
    return;
  }
  const next = cfg.view.nextPoolId;
  say(`drain query at ${new Date().toISOString()} — program ${ctx.programId.toBase58()}`);
  say('id    tier  mode  cap  min  paid  state      entrants  prize_pool_lamports  fill_deadline (unix)  layout');
  const rows: PoolRow[] = [];
  const tally = new Map<string, number>();
  const ids: bigint[] = [];
  for (let id = 1n; id < next; id++) ids.push(id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const infos = await ctx.connection.getMultipleAccountsInfo(
      batch.map((id) => ctx.pdas.pool(id)),
      'confirmed'
    );
    batch.forEach((id, k) => {
      const info = infos[k];
      if (!info) {
        say(`${id.toString().padEnd(5)} (no account — gap in the id sequence)`);
        return;
      }
      const d = info.data;
      let head: PoolHead | null = null;
      try {
        head = decodePoolHead(d, `pool ${id}`);
      } catch {
        head = null;
      }
      // The state byte sits at the same offset in every layout, so the drain
      // verdict never depends on the decoder knowing the size.
      const state = head?.state ?? POOL_STATES[d[POOL_OFFSETS.state]] ?? `unknown(${d[POOL_OFFSETS.state]})`;
      tally.set(state, (tally.get(state) ?? 0) + 1);
      rows.push({ id, state });
      const layout =
        d.length === POOL_SPACE ? `${d.length}` : `${d.length} — run migrate-pool`;
      if (head) {
        say(
          `${id.toString().padEnd(5)} ${String(head.tier).padEnd(5)} ${(MODE_NAMES[head.mode] ?? '?').padEnd(5)} ` +
            `${String(head.capacity).padEnd(4)} ${String(head.minSeats).padEnd(4)} ${String(head.paidPlaces).padEnd(5)} ` +
            `${state.padEnd(10)} ${String(head.entrants).padEnd(9)} ${head.potLamports.toString().padEnd(20)} ` +
            `${head.fillDeadline.toString().padEnd(21)} ${layout}`
        );
      } else {
        say(
          `${id.toString().padEnd(5)} ${String(d[POOL_OFFSETS.tier]).padEnd(5)} ?     ?    ?    ?     ` +
            `${state.padEnd(10)} ${String(d.readUInt16LE(POOL_OFFSETS.entrants)).padEnd(9)} ` +
            `${d.readBigUInt64LE(POOL_OFFSETS.potLamports).toString().padEnd(20)} ` +
            `${d.readBigInt64LE(POOL_OFFSETS.fillDeadline).toString().padEnd(21)} ${layout} (decoder refuses this size)`
        );
      }
    });
  }
  say(`pools: ${next - 1n} — ` + [...tally.entries()].map(([s, n]) => `${s} ${n}`).join(', '));
  const verdict = drainVerdict(rows, upgradePreflight);
  for (const line of verdict.lines) say(line);
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
 * top-up (hence `isWritable` on the signer). No argument. */
function migrateConfigIx(ctx: Ctx, admin: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc('migrate_config'),
  });
}

/** The Ladder growth (D-E19): 603 → 605, or 484 → 605 through both tails.
 * Refused by the program once the account is 605 bytes, and refused for the
 * original 380-byte layout. */
async function cmdMigrateConfig(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.has('keeper')) {
    throw new Error(
      'migrate-config takes no --keeper: the migration preserves the keeper already in the ' +
        'account (rotate it with set-keeper)'
    );
  }
  const info = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!info) throw new Error('config: NOT INITIALISED (run init-config)');
  say(`config: ${info.data.length} bytes on chain`);
  if (info.data.length >= CONFIG_SPACE) {
    say(`config: already at the current layout (${CONFIG_SPACE}) — nothing to do`);
    return;
  }
  if (info.data.length !== CONFIG_SPACE_V3 && info.data.length !== CONFIG_SPACE_V2) {
    throw new Error(
      `config is ${info.data.length} bytes; the migration grows exactly ${CONFIG_SPACE_V3} ` +
        `(pre-Ladder) or ${CONFIG_SPACE_V2} (pre-Phase-B)`
    );
  }
  say(`config: grows ${info.data.length} -> ${CONFIG_SPACE}; enabled_pool_types starts at 0`);
  await deliver(ctx, [migrateConfigIx(ctx, signerPubkey(ctx.cli))], 'admin');
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

/** `forfeit_escrow(pool_id)` — admin-signed: review upheld a flag. The vault
 * is listed read-only and the treasury not at all: nothing moves. */
async function cmdForfeitEscrow(ctx: Ctx): Promise<void> {
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
 * published list matched is a multi-party act. Its counterpart,
 * `place_sanctions_hold`, is settlement-signed and has NO command here on
 * purpose. Nothing here moves a lamport either way.
 */
async function cmdLiftSanctionsHold(ctx: Ctx): Promise<void> {
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
 * `set-open-tiers` — the tier-level R6 master switch, and since D-E19 the
 * last guard before every ENABLED pool type of a tier becomes live.
 *
 * Refuses to open a tier when (founder instruction 2026-09-12 §2.5, carried
 * into the Ladder):
 *   - its on-chain price disagrees with the ratified table — every prize of
 *     the tier is a multiple of that price;
 *   - any enabled pool type of (mode, tier) carries economics that are stale
 *     at the live price, or are not the launch table — `open_pool` funds a
 *     vault at the pool type's stored figure and publishes it;
 *   - more than one additional tier would open in one call — `1,1,1,1,1,1,1`
 *     is one keystroke away from `1,0,0,0,0,0,0`.
 *
 * `--dry-run` prints the comparison and sends nothing. The refusals apply to
 * a real send AND to `--emit-proposal`. Disabling is never refused.
 */
async function cmdSetOpenTiers(ctx: Ctx): Promise<void> {
  const tiers = need(ctx.cli, 'tiers')
    .split(',')
    .map((v) => {
      if (v !== '0' && v !== '1') throw new Error(`--tiers entries must be 0 or 1, got ${v}`);
      return v === '1' ? 1 : 0;
    });
  if (tiers.length !== N_TIERS) throw new Error(`--tiers must list exactly ${N_TIERS} values`);
  const modeFlag = ctx.cli.flags.get('mode') ?? 'easy';
  const mode = parseMode(modeFlag);
  const hard = mode === 1;

  const cfg = await needConfig(ctx);
  const v = cfg.view;
  if (hard && !v.hardLadderPresent) {
    throw new Error(
      `REFUSED — the live Config is ${cfg.raw.length} bytes and carries no hard ladder; run ` +
        '`migrate-config` first (docs/guide/OPERATING-MANUAL.md)'
    );
  }
  const current = (hard ? v.hardOpenTiers : v.openTiers).map((b) => (b ? 1 : 0));
  const opening = tiers.flatMap((x, t) => (x === 1 && current[t] !== 1 ? [t] : []));
  const closing = tiers.flatMap((x, t) => (x === 0 && current[t] === 1 ? [t] : []));

  say(`config:   ${ctx.pdas.config().toBase58()}`);
  say(`ladder:   ${MODE_NAMES[mode]} (${hard ? 'set_hard_open_tiers' : 'set_open_tiers'})`);
  say(`current:  [${current.join(', ')}]`);
  say(`proposed: [${tiers.join(', ')}]`);
  say(`opening:  ${opening.length === 0 ? '(none)' : opening.join(', ')}`);
  say(`closing:  ${closing.length === 0 ? '(none)' : closing.join(', ')}`);

  if (opening.length > 1) {
    throw new Error(
      `REFUSED — this call would open ${opening.length} additional tiers at once ` +
        `(${opening.join(', ')}). Open one tier per call, each with its own ` +
        'proposal and its own verification. (docs/guide/OPERATING-MANUAL.md)'
    );
  }

  const wrong: string[] = [];
  if (opening.length > 0 && !v.ladderPresent) {
    wrong.push(
      `Config is ${cfg.raw.length} bytes (pre-Ladder): this CLI tracks the Ladder program, which ` +
        'opens pools per pool type — run migrate-config and configure the pool types first'
    );
  }
  const types = opening.length > 0 && v.ladderPresent ? await readAllPoolTypes(ctx) : [];
  for (const t of opening) {
    if (v.tierPriceLamports[t] !== TIER_ENTRY_LAMPORTS[t]) {
      wrong.push(
        `tier ${t}: price on chain ${v.tierPriceLamports[t]} lamports, ratified table ${TIER_ENTRY_LAMPORTS[t]}`
      );
    }
    const enabled = types.filter((x) => x.view.mode === mode && x.view.tier === t && x.view.enabled);
    if (enabled.length === 0) {
      say(
        `note:     tier ${t} has no enabled ${MODE_NAMES[mode]} pool type — opening it opens nothing ` +
          'until set-pool-type-enabled'
      );
    }
    for (const x of enabled) {
      const state = economicsState(x.view, v.tierPriceLamports[t]);
      if (state !== 'launch') {
        wrong.push(
          `${poolTypeLabel(mode, t, x.view.capacity)}: economics are ${state} ` +
            `(table ${tableText(x.view.prizeTable, x.view.paidPlaces)}, minimum ${x.view.minSeats}, ` +
            `prize pool ${x.view.potLamports} lamports)`
        );
      } else {
        say(
          `live on open: ${poolTypeLabel(mode, t, x.view.capacity)} — prize pool ${sol(x.view.potLamports)} SOL`
        );
      }
    }
  }
  if (wrong.length > 0) {
    throw new Error(
      'REFUSED — a tier being opened does not carry the ratified economics:\n  ' +
        wrong.join('\n  ') +
        '\n\nThe next pool of that tier would be funded from the treasury at the figure ' +
        'above and would publish it as the prize. Fix it first (set-tier-economics, then ' +
        'set-pool-type-economics for each type), confirm with `status`, then run this again. ' +
        '(docs/guide/OPERATING-MANUAL.md)'
    );
  }

  if (ctx.cli.flags.get('dry-run') !== undefined) {
    say('\ndry run: checks passed, nothing sent.');
    return;
  }
  await deliver(
    ctx,
    [adminOnlyIx(ctx, hard ? 'set_hard_open_tiers' : 'set_open_tiers', Buffer.from(tiers))],
    'admin'
  );
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
 * Mirrors the program's checks (D-E19 retired the 1024-lamport grid): both
 * figures positive, the reference pot no larger than the 64-player minimum
 * field's entries. Names every pool type a price change would make stale. */
async function cmdSetTierEconomics(ctx: Ctx): Promise<void> {
  const tier = parseTier(need(ctx.cli, 'tier'));
  const price = parseAmount(need(ctx.cli, 'price'));
  const pot = parseAmount(need(ctx.cli, 'pot'));
  if (price <= 0n) throw new Error('--price must be greater than zero');
  if (pot <= 0n) throw new Error('--pot must be greater than zero');
  const minField64 = BigInt(MIN_FIELD_BY_CAPACITY[64]);
  if (pot > minField64 * price) {
    throw new Error(
      `--pot ${pot} exceeds the 64-player minimum field's entries (${minField64} x ${price}); ` +
        'the program refuses it (PotExceedsMinimumField)'
    );
  }
  const reference = prizePoolFor(LADDER_TABLES[64], price);
  if (pot !== reference) {
    say(`note: the 64-player launch table at this price is ${reference} lamports; --pot is ${pot}`);
  }
  const cfg = await readConfig(ctx);
  if (cfg && cfg.view.tierPriceLamports[tier] !== price && cfg.view.ladderPresent) {
    const stale = (await readAllPoolTypes(ctx)).filter((t) => t.view.tier === tier && t.view.paidPlaces > 0);
    if (stale.length > 0) {
      say(
        `note: the price moves ${cfg.view.tierPriceLamports[tier]} -> ${price}; these pool types become STALE ` +
          'and open_pool refuses them until set-pool-type-economics restates each one:'
      );
      for (const t of stale) say(`        ${poolTypeLabel(t.view.mode, t.view.tier, t.view.capacity)}`);
    }
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
 * `open_pool` demands before it funds a prize pool. */
async function cmdSetTreasuryPolicy(ctx: Ctx): Promise<void> {
  const raw = need(ctx.cli, 'reserve-pots').trim();
  const reserve = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(reserve) || reserve < 0 || reserve > 255) {
    throw new Error(`--reserve-pots must fit a u8, got ${raw}`);
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

// ---------------------------------------------------------------------------
// Pool types (D-E19)
// ---------------------------------------------------------------------------

function initPoolTypeIx(ctx: Ctx, admin: PublicKey, mode: number, tier: number, capacity: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    keys: [
      // The admin pays the account's rent, so it is writable.
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: ctx.pdas.config(), isSigner: false, isWritable: false },
      { pubkey: ctx.pdas.poolType(mode, tier, capacity), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('init_pool_type'), Buffer.from([mode, tier]), u16le(capacity)]),
  });
}

function setPoolTypeEconomicsIx(
  ctx: Ctx,
  admin: PublicKey,
  mode: number,
  tier: number,
  capacity: number,
  minSeats: number,
  table: readonly number[],
  pot: bigint
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
      { pubkey: ctx.pdas.poolType(mode, tier, capacity), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      disc('set_pool_type_economics'),
      Buffer.from([mode, tier]),
      u16le(capacity),
      u16le(minSeats),
      Buffer.from(padTable(table)),
      u64le(pot),
    ]),
  });
}

function setPoolTypeEnabledIx(
  ctx: Ctx,
  admin: PublicKey,
  mode: number,
  tier: number,
  capacity: number,
  enabled: boolean
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
      { pubkey: ctx.pdas.poolType(mode, tier, capacity), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      disc('set_pool_type_enabled'),
      Buffer.from([mode, tier]),
      u16le(capacity),
      Buffer.from([enabled ? 1 : 0]),
    ]),
  });
}

/**
 * The economics a pool type would be given, checked offline exactly as
 * `set_pool_type_economics` checks them (pool_type.rs): top quarter paid,
 * never increasing, no zero inside the paid places, the minimum field
 * above the places paid and within the capacity, the prize pool equal to
 * the table at the price and no larger than the minimum field's entries.
 * The prize pool is COMPUTED from the table and the price — never typed.
 */
interface Economics {
  table: readonly number[];
  minSeats: number;
  pot: bigint;
  launch: boolean;
}

function economicsFor(
  capacity: PoolCapacity,
  price: bigint,
  explicitTable?: readonly number[],
  explicitMinSeats?: number
): Economics {
  if (price <= 0n) throw new Error('the tier price on chain is zero; set-tier-economics first');
  const table = explicitTable ?? LADDER_TABLES[capacity];
  const minSeats = explicitMinSeats ?? MIN_FIELD_BY_CAPACITY[capacity];
  assertPrizeTable(table);
  const paid = capacity / 4;
  if (table.length !== paid) {
    throw new Error(
      `a ${capacity}-player pool pays its top quarter — ${paid} places — and the table has ${table.length}`
    );
  }
  if (!(minSeats > paid && minSeats <= capacity)) {
    throw new Error(
      `the minimum field must exceed the ${paid} places paid and be at most ${capacity}; got ${minSeats}`
    );
  }
  const pot = prizePoolFor(table, price);
  if (pot > BigInt(minSeats) * price) {
    throw new Error(
      `the prize pool ${pot} exceeds the minimum field's entries (${minSeats} x ${price}); ` +
        'the program refuses it (PotExceedsMinimumField)'
    );
  }
  const launchTable = LADDER_TABLES[capacity];
  const launch =
    table.length === launchTable.length &&
    table.every((m, i) => m === launchTable[i]) &&
    minSeats === MIN_FIELD_BY_CAPACITY[capacity];
  return { table, minSeats, pot, launch };
}

function sameEconomics(t: PoolTypeView, e: Economics): boolean {
  const padded = padTable(e.table);
  return (
    t.paidPlaces === e.table.length &&
    padded.every((m, i) => m === t.prizeTable[i]) &&
    t.minSeats === e.minSeats &&
    t.potLamports === e.pot
  );
}

/** The ratified price guard every pool-type money step shares. */
function needRatifiedPrice(cfg: LiveConfig, tier: number): bigint {
  const price = cfg.view.tierPriceLamports[tier];
  if (price !== TIER_ENTRY_LAMPORTS[tier]) {
    throw new Error(
      `REFUSED — tier ${tier}'s price on chain is ${price} lamports; the ratified table says ` +
        `${TIER_ENTRY_LAMPORTS[tier]}. Every prize of a pool type is a multiple of that price: run ` +
        '`set-tier-economics` for the tier first, confirm with `status`, then run this again.'
    );
  }
  return price;
}

async function cmdInitPoolType(ctx: Ctx): Promise<void> {
  const mode = parseMode(need(ctx.cli, 'mode'));
  const tier = parseTier(need(ctx.cli, 'tier'));
  const capacity = parseCapacity(need(ctx.cli, 'capacity'));
  const cfg = await needConfig(ctx);
  needLadderConfig(cfg, 'init_pool_type');
  const existing = await readPoolType(ctx, mode, tier, capacity);
  const address = ctx.pdas.poolType(mode, tier, capacity);
  say(`pool type: ${poolTypeLabel(mode, tier, capacity)} at ${address.toBase58()}`);
  if (existing) {
    say('pool type: already exists — nothing to do (the program would refuse a second init)');
    return;
  }
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(POOL_TYPE_SPACE);
  say(`rent:      ${rent} lamports, paid by the admin (Config.admin ${cfg.admin.toBase58()})`);
  say('creates it DISABLED and without a table: set-pool-type-economics, then set-pool-type-enabled');
  if (ctx.cli.flags.get('dry-run') !== undefined) {
    say('\ndry run: nothing sent.');
    return;
  }
  await deliver(ctx, [initPoolTypeIx(ctx, signerPubkey(ctx.cli), mode, tier, capacity)], 'admin');
}

async function cmdSetPoolTypeEconomics(ctx: Ctx): Promise<void> {
  const mode = parseMode(need(ctx.cli, 'mode'));
  const tier = parseTier(need(ctx.cli, 'tier'));
  const capacity = parseCapacity(need(ctx.cli, 'capacity'));
  const tableFlag = ctx.cli.flags.get('table');
  const minFlag = ctx.cli.flags.get('min-seats');
  const cfg = await needConfig(ctx);
  needLadderConfig(cfg, 'set_pool_type_economics');
  const price = needRatifiedPrice(cfg, tier);
  const existing = await readPoolType(ctx, mode, tier, capacity);
  if (!existing) {
    throw new Error(
      `REFUSED — ${poolTypeLabel(mode, tier, capacity)} does not exist; run init-pool-type first`
    );
  }
  const e = economicsFor(
    capacity,
    price,
    tableFlag !== undefined ? parseTable(tableFlag) : undefined,
    minFlag !== undefined ? parseU16(minFlag, 'min-seats') : undefined
  );
  const potFlag = ctx.cli.flags.get('pot');
  if (potFlag !== undefined && parseAmount(potFlag) !== e.pot) {
    throw new Error(
      `REFUSED — --pot ${parseAmount(potFlag)} lamports disagrees with the table at the live price: ` +
        `${e.table.join(',')} x ${price} = ${e.pot} lamports. The prize pool is computed, never typed.`
    );
  }
  if (!e.launch && tableFlag === undefined && minFlag === undefined) {
    // Unreachable by construction (the defaults ARE the launch values), kept
    // so a later default can never slip a non-launch table past this line.
    throw new Error('REFUSED — a non-launch table needs --table');
  }
  const t = existing.view;
  say(`pool type: ${poolTypeLabel(mode, tier, capacity)} at ${existing.address.toBase58()}`);
  say(`price:     ${price} lamports (live Config, ratified)`);
  say(
    `current:   table ${tableText(t.prizeTable, t.paidPlaces)}, minimum ${t.minSeats}, ` +
      `prize pool ${t.potLamports} lamports (${economicsState(t, price)})`
  );
  say(
    `proposed:  table ${e.table.join(',')}, minimum ${e.minSeats}, prize pool ${e.pot} lamports ` +
      `= ${sol(e.pot)} SOL (${e.launch ? 'the D-E19 launch table' : 'NON-LAUNCH — named explicitly'})`
  );
  say('never touches an open pool: every pool copies its table, minimum and prize pool at open');
  if (sameEconomics(t, e)) {
    say('pool type: already carries exactly this — nothing to do');
    return;
  }
  if (ctx.cli.flags.get('dry-run') !== undefined) {
    say('\ndry run: checks passed, nothing sent.');
    return;
  }
  await deliver(
    ctx,
    [setPoolTypeEconomicsIx(ctx, signerPubkey(ctx.cli), mode, tier, capacity, e.minSeats, e.table, e.pot)],
    'admin'
  );
}

/**
 * Switch a pool type on or off — guarded like `set-open-tiers`. Enabling
 * refuses unless the type's economics are set, current at the live price,
 * at the ratified price, and the launch table (`--accept-non-launch` takes a
 * deliberately different table that set-pool-type-economics recorded).
 * Disabling is never refused: it stops the NEXT pool of the type and never
 * touches one taking entries.
 */
async function cmdSetPoolTypeEnabled(ctx: Ctx): Promise<void> {
  const mode = parseMode(need(ctx.cli, 'mode'));
  const tier = parseTier(need(ctx.cli, 'tier'));
  const capacity = parseCapacity(need(ctx.cli, 'capacity'));
  const enabled = parseBool(need(ctx.cli, 'enabled'), 'enabled');
  const cfg = await needConfig(ctx);
  needLadderConfig(cfg, 'set_pool_type_enabled');
  const existing = await readPoolType(ctx, mode, tier, capacity);
  if (!existing) {
    throw new Error(`REFUSED — ${poolTypeLabel(mode, tier, capacity)} does not exist; run init-pool-type first`);
  }
  const t = existing.view;
  const price = cfg.view.tierPriceLamports[tier];
  const state = economicsState(t, price);
  const tierOpen = tierOpenFor(cfg.view, mode, tier);
  say(`pool type: ${poolTypeLabel(mode, tier, capacity)} at ${existing.address.toBase58()}`);
  say(`current:   ${t.enabled ? 'enabled' : 'disabled'}`);
  say(`proposed:  ${enabled ? 'enabled' : 'disabled'}`);
  say(
    `economics: table ${tableText(t.prizeTable, t.paidPlaces)}, minimum ${t.minSeats}, prize pool ` +
      `${t.potLamports} lamports (${state})`
  );
  say(
    `count:     Config.enabled_pool_types ${cfg.view.enabledPoolTypes} -> ` +
      `${cfg.view.enabledPoolTypes + (enabled && !t.enabled ? 1 : !enabled && t.enabled ? -1 : 0)}`
  );
  if (t.enabled === enabled) {
    say('pool type: already in that state — nothing to do');
    return;
  }
  if (enabled) {
    const wrong: string[] = [];
    if (price !== TIER_ENTRY_LAMPORTS[tier]) {
      wrong.push(`tier ${tier}: price on chain ${price} lamports, ratified table ${TIER_ENTRY_LAMPORTS[tier]}`);
    }
    if (state === 'unset') wrong.push('economics are not set (the program refuses: PoolTypeEconomicsUnset)');
    if (state === 'stale') {
      wrong.push(
        `economics are stale: the table at today's price is ${tableValue(t.prizeTable, price)} lamports, ` +
          `the stored prize pool ${t.potLamports} (open_pool refuses: PoolTypeEconomicsStale)`
      );
    }
    if (state === 'non-launch' && ctx.cli.flags.get('accept-non-launch') === undefined) {
      wrong.push('economics are not the D-E19 launch table — pass --accept-non-launch if that is deliberate');
    }
    if (wrong.length > 0) {
      throw new Error(
        'REFUSED — this pool type cannot be enabled as it stands:\n  ' +
          wrong.join('\n  ') +
          '\n\nRun set-pool-type-economics (and set-tier-economics if the price is wrong), ' +
          'confirm with `status`, then run this again.'
      );
    }
    say(
      tierOpen
        ? `live:      YES once enabled — tier ${tier} is open for ${MODE_NAMES[mode]}; the next pool opens at ${sol(t.potLamports)} SOL`
        : `live:      not yet — tier ${tier} is closed for ${MODE_NAMES[mode]} (set-open-tiers${mode === 1 ? ' --mode hard' : ''})`
    );
  } else {
    say('closing:   stops the NEXT pool of this type; a pool taking entries is untouched');
  }
  if (ctx.cli.flags.get('dry-run') !== undefined) {
    say('\ndry run: checks passed, nothing sent.');
    return;
  }
  await deliver(ctx, [setPoolTypeEnabledIx(ctx, signerPubkey(ctx.cli), mode, tier, capacity, enabled)], 'admin');
}

/**
 * `ladder-launch` — the ordered instruction set that brings a launch grid of
 * pool types live (D-E19; devnet: tier 0, both modes, all four sizes):
 *
 *   migrate-config               while Config is pre-Ladder (603 or 484)
 *   per (mode, capacity), in the order given:
 *     init_pool_type             unless the account exists
 *     set_pool_type_economics    unless it already carries the launch table
 *                                at the live price
 *     set_pool_type_enabled      unless already enabled
 *
 * Computed from the chain, so a re-run after a partial execution emits only
 * what is left. Prints the plan; with `--emit-proposal --admin <vault>` it
 * emits ONE JSON array (stdout) in which every step names its `group` — one
 * group per pool type — which `scripts/squads-v3.ts` executes as one Squads
 * transaction each. Sends nothing itself.
 */
async function cmdLadderLaunch(ctx: Ctx): Promise<void> {
  const tier = parseTier(need(ctx.cli, 'tier'));
  const modes = need(ctx.cli, 'modes')
    .split(',')
    .map((m) => parseMode(m));
  const capacities = need(ctx.cli, 'capacities')
    .split(',')
    .map((c) => parseCapacity(c));
  if (new Set(modes).size !== modes.length) throw new Error('--modes names a mode twice');
  if (new Set(capacities).size !== capacities.length) throw new Error('--capacities names a size twice');

  const cfg = await needConfig(ctx);
  const price = needRatifiedPrice(cfg, tier);
  const admin = ctx.cli.emitProposal ? signerPubkey(ctx.cli) : cfg.admin;
  if (!admin.equals(cfg.admin)) {
    throw new Error(
      `REFUSED — --admin is ${admin.toBase58()} but Config.admin is ${cfg.admin.toBase58()}`
    );
  }
  if (tier > 0) {
    say(
      `note: tier ${tier} is above tier 0 — opening it also needs R6's preconditions ` +
        '(docs/guide/OPERATING-MANUAL.md §5); enabling pool types does not open the tier'
    );
  }

  const steps: Step[] = [];
  if (!cfg.view.ladderPresent) {
    steps.push({
      ix: migrateConfigIx(ctx, admin),
      summary: `grow Config ${cfg.raw.length} -> ${CONFIG_SPACE} bytes (enabled_pool_types = 0)`,
      group: 'migrate-config',
    });
  }

  const coords = modes.flatMap((mode) => capacities.map((capacity) => ({ mode, capacity })));
  const infos = await ctx.connection.getMultipleAccountsInfo(
    coords.map(({ mode, capacity }) => ctx.pdas.poolType(mode, tier, capacity)),
    'confirmed'
  );
  const cushion = BigInt(await ctx.connection.getMinimumBalanceForRentExemption(0));
  let inits = 0;
  let enabledAfter = cfg.view.enabledPoolTypes;
  let fundingAllLive = 0n;
  const warnings: string[] = [];
  coords.forEach(({ mode, capacity }, i) => {
    const group = `pool-type ${MODE_NAMES[mode]}/${tier}/${capacity}`;
    const label = poolTypeLabel(mode, tier, capacity);
    const info = infos[i];
    const view = info ? decodePoolTypeAccount(info.data, label) : null;
    const e = economicsFor(capacity, price);
    fundingAllLive += e.pot + cushion;
    if (!view) {
      inits++;
      steps.push({
        ix: initPoolTypeIx(ctx, admin, mode, tier, capacity),
        summary: `create ${label} (disabled, no table)`,
        group,
      });
    }
    if (!view || !sameEconomics(view, e)) {
      steps.push({
        ix: setPoolTypeEconomicsIx(ctx, admin, mode, tier, capacity, e.minSeats, e.table, e.pot),
        summary:
          `${label}: table ${e.table.join(',')}, minimum field ${e.minSeats}, ` +
          `prize pool ${e.pot} lamports (${sol(e.pot)} SOL)`,
        group,
      });
    }
    if (!view || !view.enabled) {
      enabledAfter++;
      steps.push({ ix: setPoolTypeEnabledIx(ctx, admin, mode, tier, capacity, true), summary: `enable ${label}`, group });
    }
    const gross = price * BigInt(capacity);
    if (gross > vaultCeiling(cfg, tier)) {
      warnings.push(
        `${label}: price x capacity = ${gross} lamports exceeds tier ${tier}'s vault ceiling ` +
          `${vaultCeiling(cfg, tier)} — open_pool will refuse it (VaultCeilingExceeded) until set-vault-ceiling`
      );
    }
    if (!tierOpenFor(cfg.view, mode, tier)) {
      warnings.push(`${label}: tier ${tier} is closed for ${MODE_NAMES[mode]} — enabled but not live until set-open-tiers`);
    }
  });

  const typeRent = BigInt(await ctx.connection.getMinimumBalanceForRentExemption(POOL_TYPE_SPACE));
  const configTopUp = cfg.view.ladderPresent
    ? 0n
    : BigInt(await ctx.connection.getMinimumBalanceForRentExemption(CONFIG_SPACE)) -
      BigInt((await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed'))?.lamports ?? 0);
  const adminBalance = BigInt(await ctx.connection.getBalance(admin, 'confirmed'));
  const platform = BigInt((await ctx.connection.getAccountInfo(ctx.pdas.platform(), 'confirmed'))?.lamports ?? 0);
  const adminCost = BigInt(inits) * typeRent + (configTopUp > 0n ? configTopUp : 0n);

  say(`ladder launch — tier ${tier} (${price} lamports entry), modes ${modes.map((m) => MODE_NAMES[m]).join(',')}, sizes ${capacities.join(',')}`);
  say(`program ${ctx.programId.toBase58()}  admin ${admin.toBase58()}  config ${cfg.raw.length} bytes`);
  say('');
  if (steps.length === 0) {
    say('nothing to do: every pool type named is created, carries the launch table and is enabled.');
  }
  steps.forEach((s, i) => {
    say(`${String(i + 1).padStart(2)}. ${instructionName(s.ix.data).padEnd(24)} ${s.summary ?? ''}`);
    for (const k of s.ix.keys) {
      say(`      ${k.pubkey.toBase58().padEnd(44)} ${k.isSigner ? 'signer ' : '       '}${k.isWritable ? 'writable' : ''}`);
    }
    say(`      data ${s.ix.data.toString('hex')}`);
  });
  say('');
  say(`Config.enabled_pool_types after: ${enabledAfter}`);
  say(
    `admin pays: ${adminCost} lamports (${inits} x ${typeRent} pool-type rent` +
      (configTopUp > 0n ? ` + ${configTopUp} Config top-up` : '') +
      `); admin balance ${adminBalance}` +
      (adminBalance < adminCost ? ' — NOT ENOUGH, fund the vault first' : '')
  );
  say(
    `treasury: every pool type named live at once needs ${fundingAllLive} lamports (${sol(fundingAllLive)} SOL: ` +
      `each prize pool + its ${cushion}-lamport vault cushion) on top of the ${cfg.view.treasuryMinPlatformLamports}` +
      `-lamport minimum and refundable entries, and reserve_pots = ${cfg.view.treasuryReservePots} further ` +
      `prize pools per idle enabled type; the platform holds ${platform}`
  );
  for (const w of warnings) say(`warning: ${w}`);

  if (!ctx.cli.emitProposal) {
    say(
      '\nprinted only. Emit it for the multisig with --emit-proposal --admin <vault> > ladder.json, ' +
        'then execute with scripts/squads-v3.ts (docs/guide/OPERATING-MANUAL.md §5).'
    );
    return;
  }
  await assertAdminSigner(ctx, steps.map((s) => s.ix)).catch((e) => {
    // A pre-Ladder Config still records the admin at the same offset; any
    // mismatch was refused above — this is the same check, kept central.
    throw e;
  });
  console.log(
    JSON.stringify(
      steps.map((s, i) =>
        emitted(s.ix, {
          step: i + 1,
          group: s.group,
          summary: s.summary,
          note: 'signer role: admin — the Squads vault executes this',
        })
      ),
      null,
      2
    )
  );
}

/**
 * `register-signers` — rotate the service signers. A settlement rotation
 * carries `Config.keeper` with it by default, in the SAME transaction
 * (audit D-08: the keeper left behind stops every new pool), and
 * `--keep-keeper` is the explicit way to say the two keys differ here.
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
  const keeperKey = keeper ?? (settlement && !keepKeeper ? settlement : undefined);
  if (keeperKey) {
    ixs.push(adminOnlyIx(ctx, 'set_keeper', new PublicKey(keeperKey).toBuffer()));
    if (!keeper) {
      say(
        `note: the keeper follows the settlement signer to ${keeperKey}. ` +
          'Pass --keep-keeper if this deployment runs them as different keys, ' +
          'or --keeper <pubkey> to name a third.'
      );
    }
  } else if (settlement) {
    say(
      'note: --keep-keeper given, so Config.keeper is UNCHANGED. Confirm with ' +
        '`admin.ts status` that it still names a key the operator holds — ' +
        'open_pool accepts no other.'
    );
  }
  await deliver(ctx, ixs, 'admin');
}

/**
 * `migrate-pool` — the one-shot Pool account growth, once per existing pool.
 *
 * Anchor refuses a short account, so until this runs against a pool EVERY
 * instruction touching it fails — `pay_next_place` and `release_escrow`
 * included, on pools that are already Paid. The program grows 847 (pre-R7-b:
 * `min_seats` = 52, then `mode`), 849 (pre-Phase-B: `mode`) and 850
 * (pre-Ladder) to 869, writing what those players entered under: 64 seats
 * and one paid place worth the whole prize pool.
 *
 * Permissionless and self-disabling. `--all` walks every pool
 * 1..next_pool_id−1 and sends one transaction per pool that needs it.
 */
async function cmdMigratePool(ctx: Ctx): Promise<void> {
  if (ctx.cli.flags.get('all') !== undefined) {
    const cfg = await needConfig(ctx);
    const next = cfg.view.nextPoolId;
    let sent = 0;
    for (let id = 1n; id < next; id++) {
      const done = await migrateOnePool(ctx, id);
      if (done) sent++;
    }
    say(`migrate-pool --all: ${sent} pool(s) migrated, ${next - 1n - BigInt(sent)} already current`);
    return;
  }
  await migrateOnePool(ctx, parsePoolId(need(ctx.cli, 'pool-id')));
}

/** One pool; true when a migration was sent (or emitted), false when none was needed. */
async function migrateOnePool(ctx: Ctx, poolId: bigint): Promise<boolean> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.pool(poolId), 'confirmed');
  if (!info) throw new Error(`pool ${poolId}: no account at ${ctx.pdas.pool(poolId).toBase58()}`);
  // Said before sending, because the on-chain refusal is a bare error code
  // and an operator working through a list of pools needs to tell "already
  // done" from "wrong pool".
  say(`pool ${poolId}: ${info.data.length} bytes on chain`);
  if (info.data.length >= POOL_SPACE) {
    say(`pool ${poolId}: already at the current layout (${POOL_SPACE}) — nothing to do`);
    return false;
  }
  if (info.data.length !== POOL_SPACE_V1 && info.data.length !== 849 && info.data.length !== 850) {
    throw new Error(
      `pool ${poolId}: ${info.data.length} bytes is not a layout migrate_pool grows (847, 849, 850)`
    );
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

/**
 * The three permissionless settlement instructions, by hand (audit
 * 2026-09-11, D-06) — the documented recovery for a daemon that is down,
 * wedged, or refusing a particular pool. All three are permissionless on
 * chain: the signer pays the fee and decides nothing; the program checks the
 * pool's state and deadlines, so a mistimed call is refused.
 */
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

/**
 * The pool's own type (D-E19): `trigger_refund` and `refund` take the
 * PoolType of the POOL's recorded mode, tier and capacity — the slot the
 * pool holds, freed when it closes. Read from the pool, never assumed; a
 * pool still at a pre-Ladder size is refused here because the program
 * refuses the short account.
 */
async function poolTypeOfPool(ctx: Ctx, poolId: bigint): Promise<{ head: PoolHead; poolType: PublicKey }> {
  const info = await ctx.connection.getAccountInfo(ctx.pdas.pool(poolId), 'confirmed');
  if (!info) throw new Error(`pool ${poolId}: no account at ${ctx.pdas.pool(poolId).toBase58()}`);
  if (info.data.length !== POOL_SPACE) {
    throw new Error(
      `REFUSED — pool ${poolId} is ${info.data.length} bytes; the program reads ${POOL_SPACE}. ` +
        `Run \`migrate-pool --pool-id ${poolId}\` first.`
    );
  }
  const head = decodePoolHead(info.data, `pool ${poolId}`);
  const poolType = ctx.pdas.poolType(head.mode, head.tier, head.capacity);
  if (!(await ctx.connection.getAccountInfo(poolType, 'confirmed'))) {
    throw new Error(
      `REFUSED — pool ${poolId}'s type (${poolTypeLabel(head.mode, head.tier, head.capacity)}) has no ` +
        `account at ${poolType.toBase58()}; the program would refuse. Create it with init-pool-type ` +
        '(it need not be enabled to settle a pool).'
    );
  }
  say(
    `pool ${poolId}: ${head.state}, ${head.entrants} entrants, minimum ${head.minSeats}, ` +
      `type ${poolTypeLabel(head.mode, head.tier, head.capacity)} (${poolType.toBase58()})`
  );
  return { head, poolType };
}

async function cmdTriggerRefund(ctx: Ctx): Promise<void> {
  const poolId = parsePoolId(need(ctx.cli, 'pool-id'));
  const { poolType } = await poolTypeOfPool(ctx, poolId);
  await deliver(
    ctx,
    [
      new TransactionInstruction({
        programId: ctx.programId,
        keys: [
          { pubkey: signerPubkey(ctx.cli), isSigner: true, isWritable: false },
          { pubkey: ctx.pdas.config(), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.pool(poolId), isSigner: false, isWritable: true },
          // The untouched prize pool returns vault → treasury at trigger. The
          // rent cushion stays in the vault, which keeps the account alive.
          { pubkey: ctx.pdas.vault(poolId), isSigner: false, isWritable: true },
          { pubkey: ctx.pdas.platform(), isSigner: false, isWritable: true },
          { pubkey: poolType, isSigner: false, isWritable: true },
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
  const { poolType } = await poolTypeOfPool(ctx, poolId);
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
          { pubkey: poolType, isSigner: false, isWritable: true },
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

/**
 * The ONE treasury exit. Since D-E19 the program computes the reserve over
 * the enabled pool types, which arrive as remaining accounts — every one,
 * strictly ascending by raw address bytes, as many as
 * `Config.enabled_pool_types` — and refuses a list that leaves one out
 * (PoolTypeListIncomplete). The floor is mirrored here so an over-large
 * amount is refused before it becomes a proposal.
 */
async function cmdWithdrawPlatform(ctx: Ctx): Promise<void> {
  const amount = parseAmount(need(ctx.cli, 'amount'));
  const destination = new PublicKey(need(ctx.cli, 'destination'));
  if (amount <= 0n) throw new Error('--amount must be greater than zero');
  const cfg = await needConfig(ctx);
  needLadderConfig(cfg, 'withdraw_platform');
  const enabled = (await readAllPoolTypes(ctx))
    .filter((t) => t.view.enabled)
    .sort((a, b) => compareAddressBytes(a.address.toBytes(), b.address.toBytes()));
  if (enabled.length !== cfg.view.enabledPoolTypes) {
    throw new Error(
      `REFUSED — ${enabled.length} enabled pool types on chain but Config.enabled_pool_types is ` +
        `${cfg.view.enabledPoolTypes}; the program would refuse (PoolTypeListIncomplete)`
    );
  }
  const cushion = BigInt(await ctx.connection.getMinimumBalanceForRentExemption(0));
  let reserve = 0n;
  for (const t of enabled) {
    if (tierOpenFor(cfg.view, t.view.mode, t.view.tier) && t.view.activePool === 0n) {
      reserve += (t.view.potLamports + cushion) * BigInt(cfg.view.treasuryReservePots);
    }
  }
  const floor = cfg.view.treasuryMinPlatformLamports + reserve + cfg.view.platformRefundable;
  const balance = BigInt((await ctx.connection.getAccountInfo(ctx.pdas.platform(), 'confirmed'))?.lamports ?? 0);
  say(`treasury:  ${balance} lamports; floor ${floor} (minimum ${cfg.view.treasuryMinPlatformLamports} + reserve ${reserve} + refundable ${cfg.view.platformRefundable})`);
  say(`withdrawable now: ${balance > floor ? balance - floor : 0n} lamports; requested ${amount}`);
  say(`remaining accounts: ${enabled.length} enabled pool type(s), ascending`);
  if (balance < amount + floor) {
    throw new Error('REFUSED — the amount would breach the floor; the program refuses it (WithdrawBelowFloor)');
  }
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
          ...enabled.map((t) => ({ pubkey: t.address, isSigner: false, isWritable: false })),
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
  if (cli.emitProposal) say = (...parts) => console.error(...parts);
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
    case 'init-pool-type':
      return cmdInitPoolType(ctx);
    case 'set-pool-type-economics':
      return cmdSetPoolTypeEconomics(ctx);
    case 'set-pool-type-enabled':
      return cmdSetPoolTypeEnabled(ctx);
    case 'ladder-launch':
      return cmdLadderLaunch(ctx);
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
