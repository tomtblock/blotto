/**
 * Execute emitted admin instructions through a Squads v3 multisig.
 *
 * WHY THIS EXISTS. The program's admin is a Squads v3 vault (squads-mpl,
 * program SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu — on devnet multisig
 * 9EL1m9wv…, authority index 1). The Squads v3 web interface that used to
 * turn `admin.ts --emit-proposal` output into a proposal has been retired,
 * so the proposal is now built here, from the same payload, and run with a
 * member's key:
 *
 *   create_transaction(authority_index)  → add_instruction × n →
 *   activate_transaction → approve_transaction → execute_transaction
 *
 * WHAT IT REFUSES, before anything is sent:
 *   - an account flagged signer that is not the multisig's authority vault,
 *     an instruction with no signer, or a program other than blotto_cup;
 *   - a vault that is not `Config.admin` (the program would refuse it
 *     after every signer had approved);
 *   - a multisig whose threshold is above 1 — this script runs every step
 *     with ONE key, which only completes a 1-of-n multisig; it prints what
 *     each member must do instead of leaving a half-approved transaction;
 *   - a member key that is not a member;
 *   - a Squads transaction whose execution would not fit one Solana
 *     transaction (split it with --split each).
 *
 * WHAT IT ALWAYS DOES FIRST: simulate. `--dry-run` builds and simulates
 * and sends nothing; a real run simulates each Squads transaction again
 * immediately before sending it. When the whole pipeline (create … execute)
 * fits one Solana transaction it is simulated as one, against the real
 * Squads program and the real blotto_cup program, so the encoding of every
 * step is checked by the programs that will run it. Otherwise the proposal
 * steps are simulated together and the inner instructions are simulated on
 * their own, signed (in simulation only) by the vault.
 *
 * ENCODING. Built by hand from squads-mpl v1.3.1's source
 * (programs/squads-mpl/src/{lib,account,state}.rs) and its IDL v1.3.0 — the
 * IDL @sqds/sdk 2.0.4 bundles is identical to the one the program stores on
 * chain. The SDK itself is not a dependency (it pulls @coral-xyz/anchor 0.26
 * and a second web3.js). `scripts/squads-v3.test.ts` pins every instruction
 * against a transaction the Squads interface sent on devnet and against the
 * SDK's own builders (generator: scripts/squads-v3-vectors.gen.cjs).
 *
 * KEYS. MEMBER_KEYPAIR is the path to the member's keypair JSON. Its
 * contents are never printed or logged — only its public key.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/squads-v3.ts run --multisig <pubkey> --ix-file <path> [--dry-run]
 *   npx ts-node --transpile-only scripts/squads-v3.ts show --multisig <pubkey> --index <n>
 *   npx ts-node --transpile-only scripts/squads-v3.ts execute --multisig <pubkey> --index <n> [--dry-run]
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  type AccountMeta,
} from '@solana/web3.js';

import { resolveRpcUrl } from '../backend/_shared/src/cluster';

/** squads-mpl's `declare_id!` (programs/squads-mpl/src/lib.rs). */
export const SQUADS_V3_PROGRAM_ID = new PublicKey('SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu');

const DEFAULT_BLOTTO_PROGRAM_ID = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';

/** The compute limit an execute transaction asks for. It costs nothing
 * without a priority fee, and an execute runs every attached instruction as
 * a CPI. */
const EXECUTE_COMPUTE_UNITS = 1_400_000;

/** `MsTransactionStatus`, in declaration order (state.rs). */
export const MS_TRANSACTION_STATUS = ['Draft', 'Active', 'ExecuteReady', 'Executed', 'Rejected', 'Cancelled'] as const;

// ---------------------------------------------------------------------------
// Encoding — pure, pinned by scripts/squads-v3.test.ts.
// ---------------------------------------------------------------------------

/** Anchor's instruction discriminator: sha256("global:<snake_case>")[..8]. */
export function ixDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** Anchor's account discriminator: sha256("account:<TypeName>")[..8]. */
export function accountDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

function u32le(v: number): Buffer {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`not a u32: ${v}`);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}

/** The four PDAs (account.rs seeds; the SDK's address.ts derives the same). */
export const squadsPda = {
  multisig(createKey: PublicKey, programId = SQUADS_V3_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('squad'), createKey.toBuffer(), Buffer.from('multisig')],
      programId
    )[0];
  },
  transaction(multisig: PublicKey, index: number, programId = SQUADS_V3_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('squad'), multisig.toBuffer(), u32le(index), Buffer.from('transaction')],
      programId
    )[0];
  },
  instruction(transaction: PublicKey, index: number, programId = SQUADS_V3_PROGRAM_ID): PublicKey {
    if (!Number.isInteger(index) || index < 1 || index > 255) throw new Error(`instruction index is a u8 from 1: ${index}`);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('squad'), transaction.toBuffer(), Buffer.from([index]), Buffer.from('instruction')],
      programId
    )[0];
  },
  /** Authority (vault) PDA. Index 0 is the multisig itself and is not a vault. */
  authority(multisig: PublicKey, index: number, programId = SQUADS_V3_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('squad'), multisig.toBuffer(), u32le(index), Buffer.from('authority')],
      programId
    )[0];
  },
};

/** Borsh `IncomingInstruction { program_id, keys: Vec<MsAccountMeta>, data: Vec<u8> }`. */
export function encodeIncomingInstruction(ix: TransactionInstruction): Buffer {
  const parts: Buffer[] = [ix.programId.toBuffer(), u32le(ix.keys.length)];
  for (const k of ix.keys) {
    parts.push(k.pubkey.toBuffer(), Buffer.from([k.isSigner ? 1 : 0, k.isWritable ? 1 : 0]));
  }
  parts.push(u32le(ix.data.length), Buffer.from(ix.data));
  return Buffer.concat(parts);
}

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({ pubkey, isSigner, isWritable });

/** `create_transaction(authority_index: u32)` — multisig (w), transaction (w, init), creator (s, w), system. */
export function createTransactionIx(a: {
  multisig: PublicKey;
  transaction: PublicKey;
  creator: PublicKey;
  authorityIndex: number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SQUADS_V3_PROGRAM_ID,
    keys: [
      meta(a.multisig, false, true),
      meta(a.transaction, false, true),
      meta(a.creator, true, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([ixDiscriminator('create_transaction'), u32le(a.authorityIndex)]),
  });
}

/** `add_instruction(incoming)` — multisig, transaction (w), instruction (w, init), creator (s, w), system. */
export function addInstructionIx(a: {
  multisig: PublicKey;
  transaction: PublicKey;
  instruction: PublicKey;
  creator: PublicKey;
  incoming: TransactionInstruction;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SQUADS_V3_PROGRAM_ID,
    keys: [
      meta(a.multisig, false, false),
      meta(a.transaction, false, true),
      meta(a.instruction, false, true),
      meta(a.creator, true, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([ixDiscriminator('add_instruction'), encodeIncomingInstruction(a.incoming)]),
  });
}

/** `activate_transaction()` — multisig, transaction (w), creator (s, w). */
export function activateTransactionIx(a: { multisig: PublicKey; transaction: PublicKey; creator: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: SQUADS_V3_PROGRAM_ID,
    keys: [meta(a.multisig, false, false), meta(a.transaction, false, true), meta(a.creator, true, true)],
    data: ixDiscriminator('activate_transaction'),
  });
}

/** `approve_transaction()` — multisig, transaction (w), member (s, w). */
export function approveTransactionIx(a: { multisig: PublicKey; transaction: PublicKey; member: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: SQUADS_V3_PROGRAM_ID,
    keys: [meta(a.multisig, false, false), meta(a.transaction, false, true), meta(a.member, true, true)],
    data: ixDiscriminator('approve_transaction'),
  });
}

/** One attached instruction as `execute_transaction` needs it: its
 * MsInstruction PDA, its program and its stored account metas. */
export interface AttachedInstruction {
  pda: PublicKey;
  programId: PublicKey;
  keys: AccountMeta[];
}

/**
 * `execute_transaction(account_list: Vec<u8>)` — multisig (w), transaction
 * (w), member (s, w), then the remaining accounts.
 *
 * The program (lib.rs `execute_transaction`) walks `account_list` as
 * indices into the remaining accounts, expecting for each attached
 * instruction, in order: its MsInstruction PDA, its program, then exactly
 * its stored keys. It signs for the vault itself (`invoke_signed` with the
 * authority seeds), so every remaining account is passed as a non-signer.
 *
 * The remaining list is deduplicated EXACTLY as @sqds/sdk 2.0.4's
 * `_executeTransaction` does it — by (pubkey, writable), where a pubkey
 * already present with the other writability is appended again — so the
 * bytes match the SDK's for every input (pinned by the test). The message
 * compiler merges such duplicates into one writable account, so the extra
 * entry costs an index byte and nothing else.
 */
export function executeTransactionIx(a: {
  multisig: PublicKey;
  transaction: PublicKey;
  member: PublicKey;
  attached: AttachedInstruction[];
}): TransactionInstruction {
  const list: AccountMeta[] = [];
  for (const x of a.attached) {
    list.push(meta(x.pda, false, false), meta(x.programId, false, false));
    for (const k of x.keys) list.push(meta(k.pubkey, false, k.isWritable));
  }
  const unique: AccountMeta[] = [];
  for (const curr of list) {
    const at = unique.findIndex((u) => u.pubkey.equals(curr.pubkey));
    if (at >= 0 && unique[at].isWritable === curr.isWritable) continue;
    unique.push(meta(curr.pubkey, false, curr.isWritable));
  }
  const indices = list.map((x) => unique.findIndex((u) => u.pubkey.equals(x.pubkey) && u.isWritable === x.isWritable));
  if (indices.some((i) => i < 0 || i > 255)) throw new Error('execute_transaction: more than 256 distinct accounts');
  return new TransactionInstruction({
    programId: SQUADS_V3_PROGRAM_ID,
    keys: [meta(a.multisig, false, true), meta(a.transaction, false, true), meta(a.member, true, true), ...unique],
    data: Buffer.concat([ixDiscriminator('execute_transaction'), u32le(indices.length), Buffer.from(indices)]),
  });
}

// ---------------------------------------------------------------------------
// Decoding — Borsh, in declaration order (state.rs).
// ---------------------------------------------------------------------------

export interface MultisigView {
  threshold: number;
  authorityIndex: number;
  transactionIndex: number;
  msChangeIndex: number;
  bump: number;
  createKey: PublicKey;
  allowExternalExecute: boolean;
  keys: PublicKey[];
}

function expectDiscriminator(data: Uint8Array, name: string): Buffer {
  const buf = Buffer.from(data);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(accountDiscriminator(name))) {
    throw new Error(`account is not a Squads v3 ${name} (discriminator mismatch)`);
  }
  return buf;
}

/** `Ms`: threshold u16 | authority_index u16 | transaction_index u32 | ms_change_index u32 | bump u8 | create_key | allow_external_execute bool | keys Vec<Pubkey>. */
export function decodeMultisig(data: Uint8Array): MultisigView {
  const d = expectDiscriminator(data, 'Ms');
  const n = d.readUInt32LE(54);
  if (d.length < 58 + 32 * n) throw new Error(`Ms account too short for ${n} members`);
  const keys: PublicKey[] = [];
  for (let i = 0; i < n; i++) keys.push(new PublicKey(d.subarray(58 + 32 * i, 90 + 32 * i)));
  return {
    threshold: d.readUInt16LE(8),
    authorityIndex: d.readUInt16LE(10),
    transactionIndex: d.readUInt32LE(12),
    msChangeIndex: d.readUInt32LE(16),
    bump: d[20],
    createKey: new PublicKey(d.subarray(21, 53)),
    allowExternalExecute: d[53] !== 0,
    keys,
  };
}

export interface MsTransactionView {
  creator: PublicKey;
  ms: PublicKey;
  transactionIndex: number;
  authorityIndex: number;
  authorityBump: number;
  status: string;
  instructionIndex: number;
  bump: number;
  approved: PublicKey[];
  rejected: PublicKey[];
  cancelled: PublicKey[];
  executedIndex: number;
}

function readKeyVec(d: Buffer, at: number): [PublicKey[], number] {
  const n = d.readUInt32LE(at);
  const out: PublicKey[] = [];
  let o = at + 4;
  for (let i = 0; i < n; i++, o += 32) out.push(new PublicKey(d.subarray(o, o + 32)));
  return [out, o];
}

export function decodeMsTransaction(data: Uint8Array): MsTransactionView {
  const d = expectDiscriminator(data, 'MsTransaction');
  const [approved, o1] = readKeyVec(d, 84);
  const [rejected, o2] = readKeyVec(d, o1);
  const [cancelled, o3] = readKeyVec(d, o2);
  return {
    creator: new PublicKey(d.subarray(8, 40)),
    ms: new PublicKey(d.subarray(40, 72)),
    transactionIndex: d.readUInt32LE(72),
    authorityIndex: d.readUInt32LE(76),
    authorityBump: d[80],
    status: MS_TRANSACTION_STATUS[d[81]] ?? `unknown(${d[81]})`,
    instructionIndex: d[82],
    bump: d[83],
    approved,
    rejected,
    cancelled,
    executedIndex: d[o3],
  };
}

export interface MsInstructionView {
  programId: PublicKey;
  keys: AccountMeta[];
  data: Buffer;
  instructionIndex: number;
  executed: boolean;
}

export function decodeMsInstruction(data: Uint8Array): MsInstructionView {
  const d = expectDiscriminator(data, 'MsInstruction');
  let o = 8;
  const programId = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const n = d.readUInt32LE(o);
  o += 4;
  const keys: AccountMeta[] = [];
  for (let i = 0; i < n; i++, o += 34) keys.push(meta(new PublicKey(d.subarray(o, o + 32)), d[o + 32] !== 0, d[o + 33] !== 0));
  const len = d.readUInt32LE(o);
  o += 4;
  const ixData = Buffer.from(d.subarray(o, o + len));
  o += len;
  return { programId, keys, data: ixData, instructionIndex: d[o], executed: d[o + 2] !== 0 };
}

// ---------------------------------------------------------------------------
// The payload admin.ts emits.
// ---------------------------------------------------------------------------

export interface EmittedInstruction {
  instruction?: string;
  group?: string;
  summary?: string;
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  dataBase64: string;
}

/**
 * Parse `admin.ts --emit-proposal` output: one JSON array (ladder-launch),
 * or one or more JSON objects back to back (every other command). Lines
 * npm prints around a script (`> blotto-cup@… admin`) are skipped; any
 * other text is an error rather than something to guess around.
 */
export function parseEmitted(text: string): EmittedInstruction[] {
  const cleaned = text
    .split('\n')
    .filter((line) => !/^> /.test(line))
    .join('\n');
  const values: unknown[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const c = cleaned[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c !== '{' && c !== '[') {
      const line = cleaned.slice(i, cleaned.indexOf('\n', i) === -1 ? undefined : cleaned.indexOf('\n', i));
      throw new Error(`the instruction file holds something that is not JSON: ${JSON.stringify(line.slice(0, 80))}`);
    }
    // Scan one balanced JSON value, string-aware.
    let depth = 0;
    let inString = false;
    let j = i;
    for (; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error('the instruction file ends inside a JSON value');
    values.push(JSON.parse(cleaned.slice(i, j + 1)));
    i = j + 1;
  }
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
  return flat.map((v, k) => {
    const o = v as Partial<EmittedInstruction>;
    if (
      typeof o !== 'object' ||
      o === null ||
      typeof o.programId !== 'string' ||
      typeof o.dataBase64 !== 'string' ||
      !Array.isArray(o.accounts) ||
      o.accounts.some(
        (a) => typeof a?.pubkey !== 'string' || typeof a.isSigner !== 'boolean' || typeof a.isWritable !== 'boolean'
      )
    ) {
      throw new Error(`entry ${k + 1} is not an emitted instruction (programId, accounts, dataBase64)`);
    }
    return o as EmittedInstruction;
  });
}

export function toInstruction(e: EmittedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(e.programId),
    keys: e.accounts.map((a) => meta(new PublicKey(a.pubkey), a.isSigner, a.isWritable)),
    data: Buffer.from(e.dataBase64, 'base64'),
  });
}

/** Which instructions share a Squads transaction: `group` — consecutive
 * entries with the same `group` field (none at all: one transaction);
 * `all` — one transaction; `each` — one per instruction. */
export function groupInstructions(list: EmittedInstruction[], split: 'group' | 'all' | 'each'): EmittedInstruction[][] {
  if (split === 'all') return list.length ? [list] : [];
  if (split === 'each') return list.map((e) => [e]);
  const out: EmittedInstruction[][] = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last[0].group === e.group) last.push(e);
    else out.push([e]);
  }
  return out;
}

/**
 * Everything that must hold before a payload goes near the multisig: the
 * right program, a signer on every instruction and no signer but the vault,
 * and a name that matches the bytes when the payload states one.
 */
export function checkPayload(
  list: EmittedInstruction[],
  opts: { vault: PublicKey; programId: PublicKey; names: Map<string, string> }
): string[] {
  const problems: string[] = [];
  list.forEach((e, k) => {
    const where = `instruction ${k + 1}${e.instruction ? ` (${e.instruction})` : ''}`;
    if (e.programId !== opts.programId.toBase58()) {
      problems.push(`${where}: program ${e.programId} is not blotto_cup ${opts.programId.toBase58()}`);
    }
    const signers = e.accounts.filter((a) => a.isSigner);
    if (signers.length === 0) problems.push(`${where}: no account is flagged signer — nothing for the vault to sign`);
    for (const s of signers) {
      if (s.pubkey !== opts.vault.toBase58()) {
        problems.push(
          `${where}: signer ${s.pubkey} is not this multisig's vault ${opts.vault.toBase58()} — ` +
            'only the vault can sign through Squads'
        );
      }
    }
    const data = Buffer.from(e.dataBase64, 'base64');
    const byBytes = opts.names.get(data.subarray(0, 8).toString('hex'));
    if (!byBytes) problems.push(`${where}: discriminator ${data.subarray(0, 8).toString('hex')} is no instruction of this program`);
    else if (e.instruction && e.instruction !== byBytes) {
      problems.push(`${where}: labelled ${e.instruction} but its bytes are ${byBytes}`);
    }
  });
  return problems;
}

/** Instruction names by discriminator, read from the program's own source —
 * the same reading check-deployed.ts uses, so a new instruction needs no
 * edit here. */
export function programInstructionNames(libRsPath = resolve(__dirname, '../programs/blotto_cup/src/lib.rs')): Map<string, string> {
  const src = readFileSync(libRsPath, 'utf8');
  const names = new Map<string, string>();
  for (const m of src.matchAll(/^\s*pub fn ([a-z_]+)\s*(?:<[^>]*>)?\s*\(/gm)) {
    names.set(ixDiscriminator(m[1]).toString('hex'), m[1]);
  }
  return names;
}

/** Serialized size of a legacy transaction with one signature (the payer),
 * or Infinity when it cannot be serialized at all (too large). */
export function legacyTransactionSize(ixs: TransactionInstruction[], payer: PublicKey): number {
  try {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() }).add(...ixs);
    const message = tx.serializeMessage();
    const signers = tx.compileMessage().header.numRequiredSignatures;
    return 1 + 64 * signers + message.length;
  } catch {
    return Infinity;
  }
}

/** Greedy, order-preserving packing into transactions that fit the packet. */
export function packInstructions(ixs: TransactionInstruction[], payer: PublicKey): TransactionInstruction[][] {
  const out: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [];
  for (const ix of ixs) {
    if (legacyTransactionSize([...current, ix], payer) <= PACKET_DATA_SIZE) {
      current.push(ix);
      continue;
    }
    if (current.length === 0) throw new Error('one Squads instruction does not fit a transaction on its own');
    out.push(current);
    current = [ix];
    if (legacyTransactionSize(current, payer) > PACKET_DATA_SIZE) {
      throw new Error('one Squads instruction does not fit a transaction on its own');
    }
  }
  if (current.length) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// The CLI.
// ---------------------------------------------------------------------------

const USAGE = `squads-v3 — run blotto-cup admin instructions through a Squads v3 multisig

  npx ts-node --transpile-only scripts/squads-v3.ts <command> [flags]

commands
  run       build, simulate and (without --dry-run) execute the instructions in
            --ix-file as Squads transaction(s): create, add each instruction,
            activate, approve, execute
      --multisig <pubkey> --ix-file <path, or - for stdin>
      [--split group|all|each]  one Squads transaction per payload group
                                (default; ladder-launch names one group per pool
                                type), one for everything, or one per instruction
      [--dry-run]               build and simulate only; needs no key (pass
                                --member <pubkey>, or the sole member is used)
  show      print one Squads transaction and its attached instructions
      --multisig <pubkey> --index <n>
  execute   execute an ExecuteReady Squads transaction (finishing a run that
            stopped after approval)
      --multisig <pubkey> --index <n> [--dry-run]

flags
  --authority-index <n>  the vault's authority index (default 1)
  --rpc <url>            default: BLOTTO_CLUSTER / BLOTTO_RPC_URL resolution (devnet)
  --program <pubkey>     blotto_cup (default ${DEFAULT_BLOTTO_PROGRAM_ID} or BLOTTO_PROGRAM_ID)

env
  MEMBER_KEYPAIR   path to the member's keypair JSON (never printed)
`;

interface Flags {
  command: string;
  values: Map<string, string>;
  switches: Set<string>;
}

const SWITCHES = new Set(['dry-run', 'help']);

function parseFlags(argv: string[]): Flags {
  const [command, ...rest] = argv;
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const name = a.slice(2);
    if (SWITCHES.has(name)) {
      switches.add(name);
      continue;
    }
    const v = rest[i + 1];
    if (v === undefined || (v.startsWith('--') && v !== '-')) throw new Error(`flag ${a} needs a value`);
    values.set(name, v);
    i++;
  }
  return { command: command ?? '', values, switches };
}

function need(f: Flags, name: string): string {
  const v = f.values.get(name);
  if (v === undefined) throw new Error(`--${name} is required (see --help)`);
  return v;
}

function parseIndex(raw: string, flag: string, min: number): number {
  if (!/^[0-9]+$/.test(raw.trim())) throw new Error(`--${flag} must be a whole number, got ${raw}`);
  const n = Number(raw.trim());
  if (n < min || n > 0xffffffff) throw new Error(`--${flag} must be at least ${min}, got ${raw}`);
  return n;
}

/** Load the member's key. The path and the bytes are never echoed. */
function loadMember(): Keypair {
  const path = process.env.MEMBER_KEYPAIR;
  if (!path) throw new Error('MEMBER_KEYPAIR is not set — point it at the member keypair JSON (or use --dry-run).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('MEMBER_KEYPAIR does not point at a readable keypair JSON file');
  }
  if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error('MEMBER_KEYPAIR is not a 64-byte keypair JSON array');
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}

interface Env {
  connection: Connection;
  multisig: PublicKey;
  ms: MultisigView;
  authorityIndex: number;
  vault: PublicKey;
  programId: PublicKey;
  dryRun: boolean;
  member: PublicKey;
  signer: Keypair | null;
}

async function loadEnv(f: Flags): Promise<Env> {
  const rpc = f.values.get('rpc') ?? resolveRpcUrl({ BLOTTO_CLUSTER: process.env.BLOTTO_CLUSTER, BLOTTO_RPC_URL: process.env.BLOTTO_RPC_URL });
  const connection = new Connection(rpc, 'confirmed');
  const multisig = new PublicKey(need(f, 'multisig'));
  const programId = new PublicKey(f.values.get('program') ?? process.env.BLOTTO_PROGRAM_ID ?? DEFAULT_BLOTTO_PROGRAM_ID);
  const info = await connection.getAccountInfo(multisig, 'confirmed');
  if (!info) throw new Error(`no account at ${multisig.toBase58()} on ${rpc}`);
  if (!info.owner.equals(SQUADS_V3_PROGRAM_ID)) {
    throw new Error(
      `${multisig.toBase58()} is owned by ${info.owner.toBase58()}, not the Squads v3 program ` +
        `${SQUADS_V3_PROGRAM_ID.toBase58()} — this script speaks v3 only`
    );
  }
  const ms = decodeMultisig(info.data);
  if (!squadsPda.multisig(ms.createKey).equals(multisig)) {
    throw new Error('the multisig account is not at the PDA of its own create key — refusing to use it');
  }
  const authorityIndex = parseIndex(f.values.get('authority-index') ?? '1', 'authority-index', 1);
  const vault = squadsPda.authority(multisig, authorityIndex);
  const dryRun = f.switches.has('dry-run');
  let signer: Keypair | null = null;
  let member: PublicKey;
  if (process.env.MEMBER_KEYPAIR) {
    signer = loadMember();
    member = signer.publicKey;
  } else if (dryRun) {
    const named = f.values.get('member');
    if (named) member = new PublicKey(named);
    else if (ms.keys.length === 1) member = ms.keys[0];
    else throw new Error('--dry-run on a multisig with several members needs --member <pubkey>');
  } else {
    member = loadMember().publicKey; // throws with the explanation
  }
  console.log(`cluster:   ${rpc}`);
  console.log(`multisig:  ${multisig.toBase58()} (Squads v3) — threshold ${ms.threshold} of ${ms.keys.length}, ${ms.transactionIndex} transactions so far`);
  console.log(`members:   ${ms.keys.map((k) => k.toBase58()).join(', ')}`);
  console.log(`vault:     ${vault.toBase58()} (authority index ${authorityIndex})`);
  console.log(`member:    ${member.toBase58()}${signer ? ' (key loaded from MEMBER_KEYPAIR)' : ' (simulation only — no key loaded)'}`);
  if (!ms.keys.some((k) => k.equals(member))) {
    throw new Error(`REFUSED — ${member.toBase58()} is not a member of this multisig`);
  }
  return { connection, multisig, ms, authorityIndex, vault, programId, dryRun, member, signer };
}

/** Threshold > 1 cannot be completed with one key; say what each member does. */
function refuseThreshold(env: Env, index: number): never {
  const lines = [
    `REFUSED — this multisig needs ${env.ms.threshold} approvals; this script runs every step with ONE key and`,
    'would leave a half-approved transaction on chain. What each member must do instead:',
    `  1. one member (the proposer) creates transaction #${index} with authority index ${env.authorityIndex}, adds`,
    '     each instruction from the payload in order, and activates it (create_transaction,',
    '     add_instruction x n, activate_transaction — run with --split each so each is checkable);',
    `  2. each of ${env.ms.threshold} members, with their own key, checks every account and the data against the`,
    '     payload (`squads-v3.ts show --index <n>`) and sends approve_transaction;',
    '  3. once approvals reach the threshold the transaction is ExecuteReady, and any member runs',
    '     `squads-v3.ts execute --index <n>`.',
    `Members: ${env.ms.keys.map((k) => k.toBase58()).join(', ')}`,
  ];
  throw new Error(lines.join('\n'));
}

interface Simulation {
  ok: boolean;
  logs: string[];
  error: string;
  units?: number;
}

async function simulate(connection: Connection, ixs: TransactionInstruction[], payer: PublicKey): Promise<Simulation> {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: ixs,
  }).compileToLegacyMessage();
  const res = await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  });
  const logs = res.value.logs ?? [];
  const err = res.value.err;
  const anchorMessage = logs.find((l) => l.includes('Error Message:'));
  return {
    ok: err === null,
    logs,
    error: err === null ? '' : `${JSON.stringify(err)}${anchorMessage ? ` — ${anchorMessage.replace(/^Program log: /, '')}` : ''}`,
    units: res.value.unitsConsumed,
  };
}

function printSimulation(label: string, s: Simulation): void {
  console.log(`  simulate ${label}: ${s.ok ? 'OK' : 'FAILED'}${s.units !== undefined ? ` (${s.units} compute units)` : ''}`);
  if (!s.ok) {
    console.log(`    error: ${s.error}`);
    for (const l of s.logs.slice(-25)) console.log(`    | ${l}`);
  } else {
    for (const l of s.logs.filter((x) => /Program log: Instruction: /.test(x))) console.log(`    | ${l}`);
  }
}

/** One Squads transaction, fully built for a given index. */
interface Planned {
  index: number;
  transaction: PublicKey;
  entries: EmittedInstruction[];
  inner: TransactionInstruction[];
  proposal: TransactionInstruction[];
  execute: TransactionInstruction;
}

function plan(env: Env, index: number, entries: EmittedInstruction[]): Planned {
  const transaction = squadsPda.transaction(env.multisig, index);
  const inner = entries.map(toInstruction);
  if (inner.length > 255) throw new Error('a Squads transaction holds at most 255 instructions');
  const pdas = inner.map((_, i) => squadsPda.instruction(transaction, i + 1));
  const proposal = [
    createTransactionIx({ multisig: env.multisig, transaction, creator: env.member, authorityIndex: env.authorityIndex }),
    ...inner.map((incoming, i) =>
      addInstructionIx({ multisig: env.multisig, transaction, instruction: pdas[i], creator: env.member, incoming })
    ),
    activateTransactionIx({ multisig: env.multisig, transaction, creator: env.member }),
    approveTransactionIx({ multisig: env.multisig, transaction, member: env.member }),
  ];
  const execute = executeTransactionIx({
    multisig: env.multisig,
    transaction,
    member: env.member,
    attached: inner.map((ix, i) => ({ pda: pdas[i], programId: ix.programId, keys: ix.keys })),
  });
  return { index, transaction, entries, inner, proposal, execute };
}

const computeLimit = (): TransactionInstruction => ComputeBudgetProgram.setComputeUnitLimit({ units: EXECUTE_COMPUTE_UNITS });

function describe(p: Planned, names: Map<string, string>): void {
  console.log(`\nSquads transaction #${p.index} — ${p.transaction.toBase58()}`);
  p.entries.forEach((e, i) => {
    const name = names.get(Buffer.from(e.dataBase64, 'base64').subarray(0, 8).toString('hex')) ?? '?';
    console.log(`  ${String(i + 1).padStart(2)}. ${name}${e.summary ? ` — ${e.summary}` : ''}`);
    for (const a of e.accounts) {
      console.log(`        ${a.pubkey.padEnd(44)} ${a.isSigner ? 'signer ' : '       '}${a.isWritable ? 'writable' : ''}`);
    }
    console.log(`        data ${Buffer.from(e.dataBase64, 'base64').toString('hex')}`);
  });
}

/** Simulate one planned Squads transaction the strongest way that fits. */
async function simulatePlanned(env: Env, p: Planned): Promise<boolean> {
  const whole = [...p.proposal, p.execute, computeLimit()];
  if (legacyTransactionSize(whole, env.member) <= PACKET_DATA_SIZE) {
    const s = await simulate(env.connection, whole, env.member);
    printSimulation('the whole pipeline (create … execute) as one transaction', s);
    return s.ok;
  }
  let ok = true;
  for (const [i, chunk] of packInstructions(p.proposal, env.member).entries()) {
    const s = await simulate(env.connection, chunk, env.member);
    printSimulation(`proposal transaction ${i + 1}`, s);
    ok = ok && s.ok;
    if (!s.ok) break;
  }
  // The inner instructions on their own, the vault as fee payer and signer
  // (simulation does not verify signatures) — what the program will do.
  for (const [i, chunk] of packInstructions([...p.inner, computeLimit()], env.vault).entries()) {
    const s = await simulate(env.connection, chunk, env.vault);
    printSimulation(`inner instructions ${i + 1} (signed by the vault, simulation only)`, s);
    ok = ok && s.ok;
    if (!s.ok) break;
  }
  return ok;
}

async function readTransaction(env: Env, transaction: PublicKey): Promise<MsTransactionView> {
  const info = await env.connection.getAccountInfo(transaction, 'confirmed');
  if (!info) throw new Error(`no Squads transaction at ${transaction.toBase58()}`);
  return decodeMsTransaction(info.data);
}

async function send(env: Env, ixs: TransactionInstruction[]): Promise<string> {
  if (!env.signer) throw new Error('internal: no signer loaded');
  return sendAndConfirmTransaction(env.connection, new Transaction().add(...ixs), [env.signer], { commitment: 'confirmed' });
}

async function cmdRun(f: Flags): Promise<void> {
  const file = need(f, 'ix-file');
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  const entries = parseEmitted(text);
  if (entries.length === 0) throw new Error('the instruction file holds no instruction');
  const split = (f.values.get('split') ?? 'group') as 'group' | 'all' | 'each';
  if (!['group', 'all', 'each'].includes(split)) throw new Error(`--split must be group, all or each, got ${split}`);

  const env = await loadEnv(f);
  const names = programInstructionNames();
  const problems = checkPayload(entries, { vault: env.vault, programId: env.programId, names });

  // The vault must be the admin the program checks (`has_one = admin`).
  const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], env.programId)[0];
  const config = await env.connection.getAccountInfo(configPda, 'confirmed');
  if (config && config.data.length >= 40) {
    const admin = new PublicKey(config.data.subarray(8, 40));
    console.log(`config:    ${configPda.toBase58()} — admin ${admin.toBase58()}`);
    if (!admin.equals(env.vault)) problems.push(`Config.admin is ${admin.toBase58()}, not this multisig's vault ${env.vault.toBase58()}`);
  } else {
    console.log(`config:    ${configPda.toBase58()} — not initialised`);
  }
  console.log(`vault balance: ${await env.connection.getBalance(env.vault, 'confirmed')} lamports (it pays rent where an instruction marks it writable)`);
  if (problems.length > 0) {
    throw new Error(`REFUSED — the payload does not match this multisig:\n  ${problems.join('\n  ')}`);
  }
  const groups = groupInstructions(entries, split);
  if (env.ms.threshold > 1) refuseThreshold(env, env.ms.transactionIndex + 1);

  // Build every Squads transaction up front at the indices it will take, and
  // refuse before sending anything if one cannot execute in one transaction.
  const plans = groups.map((g, k) => plan(env, env.ms.transactionIndex + 1 + k, g));
  for (const p of plans) {
    const size = legacyTransactionSize([p.execute, computeLimit()], env.member);
    if (size > PACKET_DATA_SIZE) {
      throw new Error(
        `REFUSED — Squads transaction #${p.index} (${p.entries.length} instructions) would need a ${size === Infinity ? 'too large' : `${size}-byte`} ` +
          `execute transaction; the limit is ${PACKET_DATA_SIZE}. Run with --split each.`
      );
    }
    packInstructions(p.proposal, env.member); // throws if one step cannot fit on its own
  }
  console.log(`\n${entries.length} instruction(s) in ${plans.length} Squads transaction(s), #${plans[0].index}..#${plans[plans.length - 1].index}`);
  for (const p of plans) describe(p, names);

  if (env.dryRun) {
    console.log('\ndry run — simulating; nothing is signed or sent');
    let ok = true;
    for (const [k, p] of plans.entries()) {
      console.log(`\nSquads transaction #${p.index}:`);
      if (k > 0) {
        console.log(
          `  (simulated as if it were the next proposal, #${plans[0].index}, against the CURRENT chain state: ` +
            'the transactions before it are not applied, so a step that depends on them fails here and ' +
            'passes in a real run)'
        );
      }
      // Simulations do not chain, so every group is simulated at the index
      // the multisig would accept NOW; the real run re-plans before sending.
      ok = (await simulatePlanned(env, k === 0 ? p : plan(env, plans[0].index, p.entries))) && ok;
    }
    console.log(ok ? '\ndry run: every simulation passed.' : '\ndry run: a simulation FAILED — read the logs above.');
    if (!ok) process.exitCode = 1;
    return;
  }

  const executed: number[] = [];
  for (let k = 0; k < plans.length; k++) {
    // Re-read the index: another proposal may have been created meanwhile.
    const live = decodeMultisig((await env.connection.getAccountInfo(env.multisig, 'confirmed'))!.data);
    let p = plans[k];
    if (live.transactionIndex + 1 !== p.index) {
      p = plan(env, live.transactionIndex + 1, p.entries);
      console.log(`\nthe multisig moved on; this group becomes Squads transaction #${p.index}`);
    }
    console.log(`\nSquads transaction #${p.index}: pre-flight simulation`);
    if (!(await simulatePlanned(env, p))) {
      throw new Error(
        `STOPPED before sending Squads transaction #${p.index}: its simulation failed (logs above). ` +
          (executed.length ? `Already executed: #${executed.join(', #')}.` : 'Nothing was sent.')
      );
    }
    const sigs: string[] = [];
    for (const chunk of packInstructions(p.proposal, env.member)) {
      try {
        sigs.push(await send(env, chunk));
      } catch (e) {
        throw new Error(
          `STOPPED while proposing #${p.index}: ${e instanceof Error ? e.message : String(e)}\n` +
            `Sent so far: ${sigs.join(', ') || '(none)'}. A Draft or Active Squads transaction can never ` +
            'execute; an ExecuteReady one is finished with `squads-v3.ts execute --index ' + p.index + '`.'
        );
      }
      console.log(`  proposal: ${sigs[sigs.length - 1]}`);
    }
    const ready = await readTransaction(env, p.transaction);
    if (ready.status !== 'ExecuteReady') {
      throw new Error(`STOPPED: Squads transaction #${p.index} is ${ready.status}, not ExecuteReady, after approval`);
    }
    const sim = await simulate(env.connection, [computeLimit(), p.execute], env.member);
    printSimulation('execute', sim);
    if (!sim.ok) {
      throw new Error(
        `STOPPED: Squads transaction #${p.index} is approved (ExecuteReady) but its execution fails in ` +
          'simulation — nothing was executed. Fix the cause, then `squads-v3.ts execute --index ' + p.index + '`.'
      );
    }
    const execSig = await send(env, [computeLimit(), p.execute]);
    const done = await readTransaction(env, p.transaction);
    console.log(`  execute:  ${execSig}`);
    console.log(`  Squads transaction #${p.index}: ${done.status}`);
    if (done.status !== 'Executed') throw new Error(`STOPPED: #${p.index} reads ${done.status} after execute`);
    executed.push(p.index);
  }
  console.log(`\nexecuted Squads transaction(s) #${executed.join(', #')}; the multisig's next index is ${executed[executed.length - 1] + 1}`);
}

async function attachedOf(env: Env, transaction: PublicKey, count: number): Promise<{ attached: AttachedInstruction[]; views: MsInstructionView[] }> {
  const pdas = Array.from({ length: count }, (_, i) => squadsPda.instruction(transaction, i + 1));
  const infos = await env.connection.getMultipleAccountsInfo(pdas, 'confirmed');
  const views = infos.map((info, i) => {
    if (!info) throw new Error(`attached instruction ${i + 1} has no account at ${pdas[i].toBase58()}`);
    return decodeMsInstruction(info.data);
  });
  return { attached: views.map((v, i) => ({ pda: pdas[i], programId: v.programId, keys: v.keys })), views };
}

async function cmdShow(f: Flags): Promise<void> {
  f.switches.add('dry-run'); // read-only: no key needed
  const env = await loadEnv(f);
  const index = parseIndex(need(f, 'index'), 'index', 1);
  const transaction = squadsPda.transaction(env.multisig, index);
  const t = await readTransaction(env, transaction);
  const names = programInstructionNames();
  console.log(`\nSquads transaction #${index} — ${transaction.toBase58()}`);
  console.log(`  status ${t.status}; authority index ${t.authorityIndex}; creator ${t.creator.toBase58()}`);
  console.log(`  approved by: ${t.approved.map((k) => k.toBase58()).join(', ') || '(none)'}; rejected by: ${t.rejected.map((k) => k.toBase58()).join(', ') || '(none)'}`);
  const { views } = await attachedOf(env, transaction, t.instructionIndex);
  views.forEach((v, i) => {
    const name = v.programId.equals(env.programId) ? names.get(v.data.subarray(0, 8).toString('hex')) ?? '?' : `(program ${v.programId.toBase58()})`;
    console.log(`  ${i + 1}. ${name}${v.executed ? ' [executed]' : ''}`);
    for (const k of v.keys) console.log(`       ${k.pubkey.toBase58().padEnd(44)} ${k.isSigner ? 'signer ' : '       '}${k.isWritable ? 'writable' : ''}`);
    console.log(`       data ${v.data.toString('hex')}`);
  });
}

async function cmdExecute(f: Flags): Promise<void> {
  const env = await loadEnv(f);
  const index = parseIndex(need(f, 'index'), 'index', 1);
  const transaction = squadsPda.transaction(env.multisig, index);
  const t = await readTransaction(env, transaction);
  console.log(`Squads transaction #${index}: ${t.status}, ${t.instructionIndex} instruction(s)`);
  if (t.status !== 'ExecuteReady') throw new Error(`REFUSED — only an ExecuteReady transaction can execute; #${index} is ${t.status}`);
  if (t.executedIndex > 0) throw new Error(`REFUSED — #${index} was partly executed instruction by instruction; finish it that way`);
  const { attached } = await attachedOf(env, transaction, t.instructionIndex);
  const execute = executeTransactionIx({ multisig: env.multisig, transaction, member: env.member, attached });
  const sim = await simulate(env.connection, [computeLimit(), execute], env.member);
  printSimulation('execute', sim);
  if (!sim.ok) {
    process.exitCode = 1;
    return;
  }
  if (env.dryRun) {
    console.log('dry run: nothing sent.');
    return;
  }
  const sig = await send(env, [computeLimit(), execute]);
  console.log(`execute: ${sig}`);
  console.log(`Squads transaction #${index}: ${(await readTransaction(env, transaction)).status}`);
}

async function main(): Promise<void> {
  const f = parseFlags(process.argv.slice(2));
  if (!f.command || f.command === '--help' || f.command === 'help' || f.switches.has('help')) {
    console.log(USAGE);
    return;
  }
  switch (f.command) {
    case 'run':
      return cmdRun(f);
    case 'show':
      return cmdShow(f);
    case 'execute':
      return cmdExecute(f);
    default:
      console.error(`unknown command: ${f.command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
