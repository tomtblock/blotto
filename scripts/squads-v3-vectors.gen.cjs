/**
 * Generator for the SDK-derived vectors in `scripts/squads-v3.test.ts`.
 *
 * WHY A GENERATOR. `scripts/squads-v3.ts` builds Squads v3 (squads-mpl)
 * instructions by hand rather than through `@sqds/sdk`, whose peer set
 * (@coral-xyz/anchor 0.26 and a second web3.js) this repository does not
 * carry. A vector captured from our own encoder would prove nothing
 * (CLAUDE.md, "Output expectations"), so the multi-instruction vector the
 * test pins is produced HERE, by the published SDK's own builders, and the
 * single-instruction vector is copied from a transaction the Squads web
 * interface sent on devnet (multisig 9EL1m9wv…, transaction 13).
 *
 * The SDK is NOT a dependency of this repository. To regenerate, install it
 * somewhere outside the tree and pass its node_modules directory:
 *
 *   mkdir /tmp/sqds && cd /tmp/sqds && npm init -y >/dev/null && npm install --ignore-scripts @sqds/sdk@2.0.4
 *   node scripts/squads-v3-vectors.gen.cjs /tmp/sqds/node_modules > scripts/squads-v3.vectors.json
 *
 * It prints JSON; `scripts/squads-v3.vectors.json` is that output verbatim,
 * and the test reads it.
 * Nothing here touches the network: the SDK's execute builder fetches the
 * transaction and its instructions, so those two reads are answered from
 * the inputs below.
 */
'use strict';

const path = require('path');

const modules = process.argv[2];
if (!modules) {
  console.error('usage: node scripts/squads-v3-vectors.gen.cjs <path to a node_modules holding @sqds/sdk@2.0.4>');
  process.exit(2);
}
const sdkPkg = require(path.join(modules, '@sqds/sdk/package.json'));
if (sdkPkg.version !== '2.0.4') {
  console.error(`expected @sqds/sdk 2.0.4, found ${sdkPkg.version}`);
  process.exit(2);
}
const Squads = require(path.join(modules, '@sqds/sdk')).default;
const { PublicKey, TransactionInstruction } = require(path.join(modules, '@solana/web3.js'));
const BN = require(path.join(modules, 'bn.js'));
const { getTxPDA, getIxPDA, getAuthorityPDA } = require(path.join(modules, '@sqds/sdk/lib/sdk/src/address'));

// The devnet multisig and its one member (read from chain 2026-11-05).
const SQUADS = new PublicKey('SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu');
const MULTISIG = new PublicKey('9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN');
const MEMBER = new PublicKey('4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1');
const BLOTTO = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const TX_INDEX = 14;
const AUTHORITY_INDEX = 1;

const [vault] = getAuthorityPDA(MULTISIG, new BN(AUTHORITY_INDEX), SQUADS);
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], BLOTTO);
const cap = Buffer.alloc(2);
cap.writeUInt16LE(8);
const [poolType] = PublicKey.findProgramAddressSync(
  [Buffer.from('ptype'), Buffer.from([0]), Buffer.from([0]), cap],
  BLOTTO
);

// The three instructions that bring the easy / tier 0 / 8-player pool type
// live (wire contract: init_pool_type, set_pool_type_economics,
// set_pool_type_enabled). Their bytes are inputs here, not outputs: this
// vector pins the Squads wrapping, not the blotto encoding.
const inner = [
  new TransactionInstruction({
    programId: BLOTTO,
    keys: [
      { pubkey: vault, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: poolType, isSigner: false, isWritable: true },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from('c0227045a831554f' + '00' + '00' + '0800', 'hex'),
  }),
  new TransactionInstruction({
    programId: BLOTTO,
    keys: [
      { pubkey: vault, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: poolType, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(
      '215d696d1fd843f3' + '00' + '00' + '0800' + '0500' + '0302' + '00'.repeat(14) + '0065cd1d00000000',
      'hex'
    ),
  }),
  new TransactionInstruction({
    programId: BLOTTO,
    keys: [
      { pubkey: vault, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: poolType, isSigner: false, isWritable: true },
    ],
    data: Buffer.from('4cd7da1575a6fea0' + '00' + '00' + '0800' + '01', 'hex'),
  }),
];

const wallet = {
  publicKey: MEMBER,
  signTransaction: async (t) => t,
  signAllTransactions: async (t) => t,
};
// A connection is required by the constructor; nothing below calls it.
const { Connection } = require(path.join(modules, '@solana/web3.js'));
const squads = new Squads({
  connection: new Connection('http://127.0.0.1:1'),
  wallet,
  multisigProgramId: SQUADS,
});

const [txPda] = getTxPDA(MULTISIG, new BN(TX_INDEX), SQUADS);
const ixPdas = inner.map((_, i) => getIxPDA(txPda, new BN(i + 1), SQUADS)[0]);

// Answer the SDK's two reads from the inputs (the shapes its IDL decodes to).
squads.getTransaction = async () => ({
  ms: MULTISIG,
  instructionIndex: inner.length,
});
squads.getInstruction = async (key) => {
  const i = ixPdas.findIndex((k) => k.equals(key));
  return { programId: inner[i].programId, keys: inner[i].keys };
};

const show = (ix) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  dataHex: Buffer.from(ix.data).toString('hex'),
});

(async () => {
  const create = await squads.buildCreateTransaction(MULTISIG, AUTHORITY_INDEX, TX_INDEX);
  const adds = [];
  for (let i = 0; i < inner.length; i++) {
    adds.push(show(await squads.buildAddInstruction(MULTISIG, txPda, inner[i], i + 1)));
  }
  const activate = await squads.buildActivateTransaction(MULTISIG, txPda);
  const approve = await squads.buildApproveTransaction(MULTISIG, txPda);
  const execute = await squads.buildExecuteTransaction(txPda, MEMBER);
  console.log(
    JSON.stringify(
      {
        generator: `@sqds/sdk ${sdkPkg.version}`,
        multisig: MULTISIG.toBase58(),
        member: MEMBER.toBase58(),
        transactionIndex: TX_INDEX,
        authorityIndex: AUTHORITY_INDEX,
        vault: vault.toBase58(),
        transactionPda: txPda.toBase58(),
        instructionPdas: ixPdas.map((k) => k.toBase58()),
        inner: inner.map(show),
        create: show(create),
        adds,
        activate: show(activate),
        approve: show(approve),
        execute: show(execute),
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
