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
const DEFAULT_RPC = 'https://api.devnet.solana.com';

const USAGE = `blotto-cup admin CLI

  npx ts-node --transpile-only scripts/admin.ts <command> [flags]

commands
  status                    read Config + platform treasury balance
  pools                     read every pool's state — the drain query the
                            D-E2/D-E4 runbook section records before an
                            upgrade (read-only; exits 1 while any pool is
                            Sealed, Scored or Refunding)
  init-config               one-time setup (admin = the signing key)
      --entry-signer <pubkey> --settlement-signer <pubkey>
      --ceilings <7 comma-separated lamport values>
      --min-platform <lamports | SOL decimal ending in "sol", e.g. 2sol>
  set-open-tiers            which tiers may open pools (founder-owned)
      --tiers <7 comma-separated 0/1, e.g. 1,0,0,0,0,0,0>
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
  register-signers          rotate the service signers (either or both)
      [--entry-signer <pubkey>] [--settlement-signer <pubkey>]
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
  console.log(`next pool id:      ${d.readBigUInt64LE(315)}`);
  console.log(`platform balance:  ${BigInt(platform?.lamports ?? 0)} lamports`);
}

const POOL_STATES = ['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'] as const;
/** States in which a pool is mid-settlement — the drain gate of the
 * D-E2/D-E4 runbook section (proposal E1 §8): no upgrade or backend deploy
 * while any pool sits here, because the prize rule is enforced by the
 * engine that settles it. */
const MID_SETTLEMENT = new Set(['Sealed', 'Scored', 'Refunding']);

/** Read-only: every pool 1..next_pool_id−1 by fixed offsets (state.rs since
 * D-A1 v2 — the same offsets chain-web3.ts::getPool and the LiteSVM readers
 * pin: id 8 | tier 16 | entry 17 | pot 25 | entrants 33 | opened_at 35 |
 * fill_deadline 43 | state 51), then the drain verdict, timestamped so the
 * output can be kept as the record the runbook asks for. */
async function cmdPools(ctx: Ctx): Promise<void> {
  const cfg = await ctx.connection.getAccountInfo(ctx.pdas.config(), 'confirmed');
  if (!cfg) {
    console.log('config: NOT INITIALISED (run init-config)');
    return;
  }
  const next = cfg.data.readBigUInt64LE(315);
  console.log(`drain query at ${new Date().toISOString()} — program ${ctx.programId.toBase58()}`);
  console.log('id    tier  state      entrants  pot_lamports     fill_deadline (unix)');
  const blocking: bigint[] = [];
  const tally = new Map<string, number>();
  for (let id = 1n; id < next; id++) {
    const info = await ctx.connection.getAccountInfo(ctx.pdas.pool(id), 'confirmed');
    if (!info) {
      console.log(`${id.toString().padEnd(5)} (no account — gap in the id sequence)`);
      continue;
    }
    const d = info.data;
    const state = POOL_STATES[d[51]] ?? `unknown(${d[51]})`;
    tally.set(state, (tally.get(state) ?? 0) + 1);
    if (MID_SETTLEMENT.has(state)) blocking.push(id);
    console.log(
      `${id.toString().padEnd(5)} ${String(d[16]).padEnd(5)} ${state.padEnd(10)} ` +
        `${String(d.readUInt16LE(33)).padEnd(9)} ${d.readBigUInt64LE(25).toString().padEnd(16)} ` +
        `${d.readBigInt64LE(43)}`
    );
  }
  console.log(
    `pools: ${next - 1n} — ` +
      [...tally.entries()].map(([s, n]) => `${s} ${n}`).join(', ')
  );
  if (blocking.length === 0) {
    console.log('drain: CLEAR — no pool is Sealed, Scored or Refunding');
  } else {
    console.log(`drain: BLOCKED — mid-settlement pool ids: ${blocking.join(', ')}`);
    process.exitCode = 1;
  }
}

async function cmdInitConfig(ctx: Ctx): Promise<void> {
  const entrySigner = new PublicKey(need(ctx.cli, 'entry-signer'));
  const settlementSigner = new PublicKey(need(ctx.cli, 'settlement-signer'));
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
          ceilingsBuf,
          u64le(minPlatform),
        ]),
      }),
    ],
    'the account becoming admin'
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

async function cmdSetOpenTiers(ctx: Ctx): Promise<void> {
  const tiers = need(ctx.cli, 'tiers')
    .split(',')
    .map((v) => {
      if (v !== '0' && v !== '1') throw new Error(`--tiers entries must be 0 or 1, got ${v}`);
      return v === '1' ? 1 : 0;
    });
  if (tiers.length !== N_TIERS) throw new Error(`--tiers must list exactly ${N_TIERS} values`);
  await deliver(ctx, [adminOnlyIx(ctx, 'set_open_tiers', Buffer.from(tiers))], 'admin');
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

async function cmdRegisterSigners(ctx: Ctx): Promise<void> {
  const entry = ctx.cli.flags.get('entry-signer');
  const settlement = ctx.cli.flags.get('settlement-signer');
  if (!entry && !settlement) {
    throw new Error('pass --entry-signer and/or --settlement-signer');
  }
  const ixs: TransactionInstruction[] = [];
  if (entry) {
    ixs.push(adminOnlyIx(ctx, 'rotate_entry_signer', new PublicKey(entry).toBuffer()));
  }
  if (settlement) {
    ixs.push(adminOnlyIx(ctx, 'set_settlement_signer', new PublicKey(settlement).toBuffer()));
  }
  await deliver(ctx, ixs, 'admin');
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
