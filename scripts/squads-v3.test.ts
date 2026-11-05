/**
 * Known-vector tests for the Squads v3 instruction encoding in
 * `scripts/squads-v3.ts`.
 *
 * Two independent sources, neither of them this repository's encoder
 * (CLAUDE.md: a vector captured from our own output proves nothing):
 *
 *   1. CHAIN — the transactions the Squads v3 web interface sent on devnet
 *      for multisig 9EL1m9wv… transaction #13 (a `set_hard_open_tiers`
 *      proposal, read back with getTransaction on 2026-11-05), and the
 *      three accounts that proposal left behind (Ms, MsTransaction,
 *      MsInstruction). Bytes copied verbatim below.
 *   2. SDK — `scripts/squads-v3.vectors.json`, produced by @sqds/sdk 2.0.4's
 *      own builders for a three-instruction proposal (the easy / tier 0 /
 *      8-player pool type: init, economics, enable). Regenerate with
 *      `scripts/squads-v3-vectors.gen.cjs`.
 *
 * Offline: no RPC. Run:
 *   npx --yes tsx@4.20.3 scripts/squads-v3.test.ts
 *   (or `yarn test:squads-v3`, which runs it under ts-node)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PACKET_DATA_SIZE, PublicKey, TransactionInstruction } from '@solana/web3.js';

import {
  SQUADS_V3_PROGRAM_ID,
  activateTransactionIx,
  addInstructionIx,
  approveTransactionIx,
  checkPayload,
  createTransactionIx,
  decodeMsInstruction,
  decodeMsTransaction,
  decodeMultisig,
  executeTransactionIx,
  groupInstructions,
  ixDiscriminator,
  legacyTransactionSize,
  batchInstructions,
  parseEmitted,
  programInstructionNames,
  squadsPda,
  type EmittedInstruction,
} from './squads-v3';

const pk = (s: string) => new PublicKey(s);
const MULTISIG = pk('9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN');
const CREATE_KEY = pk('5w6YYSfmRMJyfF9MyK96EqHekBj3KNrsuLPchtZ2ptnb');
const MEMBER = pk('4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1');
const VAULT = pk('9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z');
const BLOTTO = pk('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const CONFIG = pk('6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa');
const SYSTEM = pk('11111111111111111111111111111111');

type KeyRow = [string, boolean, boolean];
const rows = (ix: TransactionInstruction): KeyRow[] => ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);

// ---------------------------------------------------------------------------
// 1. Chain: devnet transaction #13, as the Squads interface sent it.
// ---------------------------------------------------------------------------

const CHAIN = {
  transactionIndex: 13,
  transactionPda: '3SvsvqSEsb4SUS6Pp9GwARLzoLYs4Jo6h5Wa4qzhwvdu',
  instructionPda: 'G5EJMJyBdssDRtp9nd4hrhx6Xnu6mtvH34DxpHoNczkW',
  /** set_hard_open_tiers([1,0,0,0,0,0,0]) for the vault. */
  inner: new TransactionInstruction({
    programId: BLOTTO,
    keys: [
      { pubkey: VAULT, isSigner: true, isWritable: false },
      { pubkey: CONFIG, isSigner: false, isWritable: true },
    ],
    data: Buffer.from('501f4a86cf00b6a801000000000000', 'hex'),
  }),
  createData: 'e3c135ef377e706901000000',
  addData:
    '0b4688a6ca37f64a44094a669e3344aaddffe6ed952f36207686d870e31bdae7b9eadb7a2378e1a6020000007a4153f19dd42867d9c6a2' +
    '99548ba0426cc700de6e79614b80f46556dafe70de010050315ff625955b74dd63731e00de7d56f77e740b5029143717a0631be440172d' +
    '00010f000000501f4a86cf00b6a801000000000000',
  activateData: '381100a3870b8720',
  approveData: 'e02758b5243b9b7a',
  executeData: 'e7ad315beb1844130400000000010203',
  /** The execute transaction's accounts, in order, with the message's flags. */
  executeKeys: [
    [MULTISIG.toBase58(), false, true],
    ['3SvsvqSEsb4SUS6Pp9GwARLzoLYs4Jo6h5Wa4qzhwvdu', false, true],
    [MEMBER.toBase58(), true, true],
    ['G5EJMJyBdssDRtp9nd4hrhx6Xnu6mtvH34DxpHoNczkW', false, false],
    [BLOTTO.toBase58(), false, false],
    [VAULT.toBase58(), false, false],
    [CONFIG.toBase58(), false, true],
  ] as KeyRow[],
  /** Account data read from devnet after #13 executed. */
  msAccount:
    'RnYJbP7XH3gBAAEADQAAAAAAAAD/SUphPBzusvF1kHslbsHUGo2MkBPpCR/hPk1Ds5PNBKgAAQAAADsU9r6Qi7YvJ870jp4YcU2vEEbyLFgswOlZ8kY+zQ3a',
  txAccount:
    'tpdo2P8BE507FPa+kIu2LyfO9I6eGHFNrxBG8ixYLMDpWfJGPs0N2npHi0ym0AL8NYaXmgdLovERlXtee0ZjXgtfWMxUh8w9DQAAAAEAAAD/AwH/AQAAADsU' +
    '9r6Qi7YvJ870jp4YcU2vEEbyLFgswOlZ8kY+zQ3aAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  ixAccount:
    '7rl+lb1Z/1xECUpmnjNEqt3/5u2VLzYgdobYcOMb2ue56tt6I3jhpgIAAAB6QVPxndQoZ9nGoplUi6BCbMcA3m55YUuA9GVW2v5w3gEAUDFf9iWVW3TdY3Me' +
    'AN59Vvd+dAtQKRQ3F6BjG+RAFy0AAQ8AAABQH0qGzwC2qAEAAAAAAAAB+wA=',
};

test('PDAs: the devnet multisig, its vault, and transaction #13 derive as on chain', () => {
  assert.equal(squadsPda.multisig(CREATE_KEY).toBase58(), MULTISIG.toBase58());
  assert.equal(squadsPda.authority(MULTISIG, 1).toBase58(), VAULT.toBase58());
  const tx = squadsPda.transaction(MULTISIG, CHAIN.transactionIndex);
  assert.equal(tx.toBase58(), CHAIN.transactionPda);
  assert.equal(squadsPda.instruction(tx, 1).toBase58(), CHAIN.instructionPda);
});

test('chain: create / add / activate / approve / execute reproduce transaction #13 byte for byte', () => {
  const tx = pk(CHAIN.transactionPda);
  const ixPda = pk(CHAIN.instructionPda);
  const create = createTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER, authorityIndex: 1 });
  assert.equal(create.data.toString('hex'), CHAIN.createData);
  assert.ok(create.programId.equals(SQUADS_V3_PROGRAM_ID));
  const add = addInstructionIx({ multisig: MULTISIG, transaction: tx, instruction: ixPda, creator: MEMBER, incoming: CHAIN.inner });
  assert.equal(add.data.toString('hex'), CHAIN.addData);
  assert.equal(activateTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER }).data.toString('hex'), CHAIN.activateData);
  assert.equal(approveTransactionIx({ multisig: MULTISIG, transaction: tx, member: MEMBER }).data.toString('hex'), CHAIN.approveData);
  const execute = executeTransactionIx({
    multisig: MULTISIG,
    transaction: tx,
    member: MEMBER,
    attached: [{ pda: ixPda, programId: BLOTTO, keys: CHAIN.inner.keys }],
  });
  assert.equal(execute.data.toString('hex'), CHAIN.executeData);
  assert.deepEqual(rows(execute), CHAIN.executeKeys);
});

test('chain: the Ms, MsTransaction and MsInstruction accounts decode', () => {
  const ms = decodeMultisig(Buffer.from(CHAIN.msAccount, 'base64'));
  assert.equal(ms.threshold, 1);
  assert.equal(ms.authorityIndex, 1);
  assert.equal(ms.transactionIndex, 13);
  assert.equal(ms.msChangeIndex, 0);
  assert.equal(ms.createKey.toBase58(), CREATE_KEY.toBase58());
  assert.deepEqual(ms.keys.map((k) => k.toBase58()), [MEMBER.toBase58()]);

  const t = decodeMsTransaction(Buffer.from(CHAIN.txAccount, 'base64'));
  assert.equal(t.status, 'Executed');
  assert.equal(t.transactionIndex, 13);
  assert.equal(t.authorityIndex, 1);
  assert.equal(t.instructionIndex, 1);
  assert.equal(t.creator.toBase58(), MEMBER.toBase58());
  assert.equal(t.ms.toBase58(), MULTISIG.toBase58());
  assert.deepEqual(t.approved.map((k) => k.toBase58()), [MEMBER.toBase58()]);
  assert.equal(t.rejected.length, 0);
  assert.equal(t.executedIndex, 1);

  const ix = decodeMsInstruction(Buffer.from(CHAIN.ixAccount, 'base64'));
  assert.ok(ix.programId.equals(BLOTTO));
  assert.equal(ix.data.toString('hex'), CHAIN.inner.data.toString('hex'));
  assert.deepEqual(rows(new TransactionInstruction({ programId: BLOTTO, keys: ix.keys, data: ix.data })), rows(CHAIN.inner));
  assert.equal(ix.instructionIndex, 1);
  assert.equal(ix.executed, false);
});

test('decoders refuse an account of another type', () => {
  assert.throws(() => decodeMultisig(Buffer.from(CHAIN.txAccount, 'base64')), /not a Squads v3 Ms/);
  assert.throws(() => decodeMsTransaction(Buffer.from(CHAIN.msAccount, 'base64')), /MsTransaction/);
});

// ---------------------------------------------------------------------------
// 2. SDK: a three-instruction proposal built by @sqds/sdk 2.0.4.
// ---------------------------------------------------------------------------

interface SdkIx {
  programId: string;
  keys: KeyRow[];
  dataHex: string;
}
interface SdkVector {
  generator: string;
  transactionIndex: number;
  vault: string;
  transactionPda: string;
  instructionPdas: string[];
  inner: SdkIx[];
  create: SdkIx;
  adds: SdkIx[];
  activate: SdkIx;
  approve: SdkIx;
  execute: SdkIx;
}
const SDK: SdkVector = JSON.parse(readFileSync(resolve(__dirname, 'squads-v3.vectors.json'), 'utf8'));
const fromSdk = (x: SdkIx): TransactionInstruction =>
  new TransactionInstruction({
    programId: pk(x.programId),
    keys: x.keys.map(([p, s, w]) => ({ pubkey: pk(p), isSigner: s, isWritable: w })),
    data: Buffer.from(x.dataHex, 'hex'),
  });
const same = (ours: TransactionInstruction, theirs: SdkIx, what: string) => {
  assert.equal(ours.programId.toBase58(), theirs.programId, `${what}: program`);
  assert.deepEqual(rows(ours), theirs.keys, `${what}: accounts`);
  assert.equal(ours.data.toString('hex'), theirs.dataHex, `${what}: data`);
};

test('sdk: the vector is the one the generator documents', () => {
  assert.equal(SDK.generator, '@sqds/sdk 2.0.4');
  assert.equal(SDK.vault, VAULT.toBase58());
  const tx = squadsPda.transaction(MULTISIG, SDK.transactionIndex);
  assert.equal(tx.toBase58(), SDK.transactionPda);
  SDK.instructionPdas.forEach((p, i) => assert.equal(squadsPda.instruction(tx, i + 1).toBase58(), p));
});

test('sdk: every step of a multi-instruction proposal matches the SDK exactly', () => {
  const tx = pk(SDK.transactionPda);
  const inner = SDK.inner.map(fromSdk);
  same(createTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER, authorityIndex: 1 }), SDK.create, 'create');
  inner.forEach((incoming, i) =>
    same(
      addInstructionIx({ multisig: MULTISIG, transaction: tx, instruction: pk(SDK.instructionPdas[i]), creator: MEMBER, incoming }),
      SDK.adds[i],
      `add ${i + 1}`
    )
  );
  same(activateTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER }), SDK.activate, 'activate');
  same(approveTransactionIx({ multisig: MULTISIG, transaction: tx, member: MEMBER }), SDK.approve, 'approve');
  // The SDK's account de-duplication (including its quirk of appending a
  // pubkey again when only its writability differs) is reproduced exactly.
  same(
    executeTransactionIx({
      multisig: MULTISIG,
      transaction: tx,
      member: MEMBER,
      attached: inner.map((ix, i) => ({ pda: pk(SDK.instructionPdas[i]), programId: ix.programId, keys: ix.keys })),
    }),
    SDK.execute,
    'execute'
  );
});

test('sdk: a pool-type group (three instructions) executes in one transaction; 25 do not', () => {
  const tx = pk(SDK.transactionPda);
  const inner = SDK.inner.map(fromSdk);
  const attached = inner.map((ix, i) => ({ pda: pk(SDK.instructionPdas[i]), programId: ix.programId, keys: ix.keys }));
  const execute = executeTransactionIx({ multisig: MULTISIG, transaction: tx, member: MEMBER, attached });
  assert.ok(legacyTransactionSize([execute], MEMBER) <= PACKET_DATA_SIZE);
  // The proposal half of the same group fits one transaction too.
  const proposal = [
    createTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER, authorityIndex: 1 }),
    ...inner.map((incoming, i) =>
      addInstructionIx({ multisig: MULTISIG, transaction: tx, instruction: pk(SDK.instructionPdas[i]), creator: MEMBER, incoming })
    ),
    activateTransactionIx({ multisig: MULTISIG, transaction: tx, creator: MEMBER }),
    approveTransactionIx({ multisig: MULTISIG, transaction: tx, member: MEMBER }),
  ];
  assert.equal(batchInstructions(proposal, MEMBER).length, 1);
  // A launch grid in ONE Squads transaction is far past the packet limit,
  // which is why ladder-launch groups by pool type.
  const many = Array.from({ length: 25 }, (_, i) => ({
    pda: squadsPda.instruction(tx, i + 1),
    programId: BLOTTO,
    keys: [...inner[i % 3].keys.slice(0, 2), { pubkey: PublicKey.unique(), isSigner: false, isWritable: true }],
  }));
  const big = executeTransactionIx({ multisig: MULTISIG, transaction: tx, member: MEMBER, attached: many });
  assert.ok(legacyTransactionSize([big], MEMBER) > PACKET_DATA_SIZE);
});

// ---------------------------------------------------------------------------
// 3. The admin.ts payload.
// ---------------------------------------------------------------------------

const emittedFor = (ix: TransactionInstruction, extra: Partial<EmittedInstruction> = {}): EmittedInstruction => ({
  ...extra,
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  dataBase64: ix.data.toString('base64'),
});

test('parseEmitted: an array, objects back to back, and the npm banner', () => {
  const a = emittedFor(CHAIN.inner, { instruction: 'set_hard_open_tiers' });
  const b = emittedFor(fromSdk(SDK.inner[0]), { group: 'g' });
  assert.equal(parseEmitted(JSON.stringify([a, b], null, 2)).length, 2);
  const stream = `\n> blotto-cup@0.1.0 admin\n> ts-node --transpile-only scripts/admin.ts\n\n${JSON.stringify(a, null, 2)}\n${JSON.stringify(b, null, 2)}\n`;
  const parsed = parseEmitted(stream);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].instruction, 'set_hard_open_tiers');
  assert.throws(() => parseEmitted(`config: 603 bytes on chain\n${JSON.stringify(a)}`), /not JSON/);
  assert.throws(() => parseEmitted('{"programId": "x"}'), /not an emitted instruction/);
  // A brace inside a string does not end the value early.
  assert.equal(parseEmitted(JSON.stringify({ ...a, summary: 'tricky } ] {' })).length, 1);
});

test('groupInstructions: by payload group, all, each', () => {
  const x = (group?: string) => ({ ...emittedFor(CHAIN.inner), group });
  const list = [x('m'), x('a'), x('a'), x('a'), x('b')];
  assert.deepEqual(groupInstructions(list, 'group').map((g) => g.length), [1, 3, 1]);
  assert.deepEqual(groupInstructions(list, 'all').map((g) => g.length), [5]);
  assert.deepEqual(groupInstructions(list, 'each').map((g) => g.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(groupInstructions([x(), x()], 'group').map((g) => g.length), [2]);
});

test('checkPayload: only the vault signs, only blotto_cup, labels match bytes', () => {
  const names = programInstructionNames();
  assert.equal(names.get(ixDiscriminator('set_paused').toString('hex')), 'set_paused');
  assert.equal(names.get('c0227045a831554f'), 'init_pool_type');
  const ok = emittedFor(CHAIN.inner, { instruction: 'set_hard_open_tiers' });
  assert.deepEqual(checkPayload([ok], { vault: VAULT, programId: BLOTTO, names }), []);
  // A member key in the signer slot.
  const wrongSigner = emittedFor(new TransactionInstruction({ ...CHAIN.inner, keys: [{ pubkey: MEMBER, isSigner: true, isWritable: false }, CHAIN.inner.keys[1]] }));
  assert.match(checkPayload([wrongSigner], { vault: VAULT, programId: BLOTTO, names }).join(), /not this multisig's vault/);
  // No signer at all.
  const noSigner = emittedFor(new TransactionInstruction({ ...CHAIN.inner, keys: [CHAIN.inner.keys[1]] }));
  assert.match(checkPayload([noSigner], { vault: VAULT, programId: BLOTTO, names }).join(), /no account is flagged signer/);
  // Another program.
  const other = emittedFor(new TransactionInstruction({ ...CHAIN.inner, programId: SYSTEM }));
  assert.match(checkPayload([other], { vault: VAULT, programId: BLOTTO, names }).join(), /is not blotto_cup/);
  // A label that lies about the bytes.
  const lying = { ...ok, instruction: 'set_paused' };
  assert.match(checkPayload([lying], { vault: VAULT, programId: BLOTTO, names }).join(), /labelled set_paused but its bytes are set_hard_open_tiers/);
});
