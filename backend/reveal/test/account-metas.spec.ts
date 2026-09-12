/**
 * Every account the settlement client marks writable, checked against the
 * `mut` set the program declares — across the language boundary.
 *
 * This is the durable half of the fix for the defect that made `pay_prizes`
 * unreachable. `PayPrizes` declares its Config account `#[account(mut, …)]`
 * and the handler writes it; the client built the instruction with Config
 * marked read-only. Anchor evaluates the `mut` constraint while assembling
 * accounts, BEFORE the handler runs, so every payment batch reverted — not
 * only the final one. No pool could ever be paid.
 *
 * Nothing caught it, and it is worth being precise about why, because that
 * is what this file is for:
 *
 *   - the LiteSVM suite drives the compiled program through its own
 *     byte-level client, so it builds correct metadata itself and tests the
 *     program rather than this module;
 *   - the deployed-drift check simulates the admin surface and the sanctions
 *     pair, and none of the money-moving instructions the daemon sends;
 *   - every daemon and crank spec drives `FakeChain`, which never constructs
 *     an account meta at all.
 *
 * So this suite reads both sides as text. It parses each `#[derive(Accounts)]`
 * struct in the program for the fields carrying `mut`, parses each builder in
 * `chain-web3.ts` for the accounts it marks writable, and compares them. It
 * is the same discipline `entry-layout.spec.ts` applies to a constant: read
 * the Rust, compare.
 */

import { expect } from 'chai';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

/** Walk up from the working directory to the repository root, so this suite
 * runs the same whether mocha is invoked from the package or the root. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'Anchor.toml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('could not locate the repository root from ' + process.cwd());
}

const ROOT = repoRoot();
/** The accounts structs live under instructions/, plus two that sit beside
 * the modules they belong to. */
const IX_DIR = join(ROOT, 'programs/blotto_cup/src/instructions');
const EXTRA_RUST = ['pass.rs', 'vrf.rs'].map((f) =>
  join(ROOT, 'programs/blotto_cup/src', f)
);
const CLIENT = join(ROOT, 'backend/reveal/src/chain-web3.ts');

// --------------------------------------------------------------------- Rust

/** field name → is it declared `mut`, for one `#[derive(Accounts)]` struct. */
type AccountsStruct = Map<string, boolean>;

/**
 * Parse every accounts struct in the program. An attribute block may span
 * lines, so the parser accumulates it until the field declaration arrives.
 */
function parseRustAccounts(): Map<string, AccountsStruct> {
  const out = new Map<string, AccountsStruct>();
  const files = [
    ...readdirSync(IX_DIR)
      .filter((f) => f.endsWith('.rs'))
      .map((f) => join(IX_DIR, f)),
    ...EXTRA_RUST,
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let current: { name: string; fields: AccountsStruct } | null = null;
    let attr = '';
    let depth = 0;
    for (const line of lines) {
      const start = /^pub struct (\w+)<'info>\s*\{/.exec(line.trim());
      if (start) {
        current = { name: start[1], fields: new Map() };
        attr = '';
        depth = 1;
        continue;
      }
      if (!current) continue;
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth <= 0) {
        out.set(current.name, current.fields);
        current = null;
        attr = '';
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('#[') || attr.length > 0) {
        attr += ' ' + trimmed;
        // The attribute block closes when its brackets balance.
        const opens = (attr.match(/\[/g) ?? []).length;
        const closes = (attr.match(/\]/g) ?? []).length;
        if (opens > closes) continue;
      }
      const field = /^pub (\w+):/.exec(trimmed);
      if (field) {
        // `mut` as its own token inside the account attribute. The attribute
        // cannot be matched as a whole with a bracket-free run, because
        // `seeds = [...]` nests brackets — so look for the token instead,
        // and never for a substring of another word.
        const hasAccountAttr = /#\[account\(/.test(attr);
        const saysMut = /[(,\s]mut\s*[,)]/.test(attr);
        // Anchor's `init` and `init_if_needed` create the account, which
        // requires it to be writable whether or not `mut` is also written.
        const saysInit = /[(,\s]init(_if_needed)?\s*[,)]/.test(attr);
        current.fields.set(field[1], hasAccountAttr && (saysMut || saysInit));
        attr = '';
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------- TypeScript

/** The account expressions the client builds, mapped to program field names. */
const EXPR_TO_FIELD: ReadonlyArray<readonly [RegExp, string]> = [
  [/this\.configPda\(\)/, 'config'],
  [/this\.platformPda\(\)/, 'platform'],
  [/this\.vaultPda\(/, 'vault'],
  [/this\.passCollectionPda\(/, 'pass_collection'],
  [/this\.entryPda\(/, 'entry'],
  [/this\.poolPda\(|^poolKey$/, 'pool'],
  [/this\.cfg\.settlementSigner\.publicKey/, 'settlement_signer'],
  [/SystemProgram\.programId/, 'system_program'],
];

interface ClientAccount {
  field: string;
  writable: boolean;
}

/** Builder method name → the accounts it emits, in order. */
function parseClientBuilders(): Map<string, ClientAccount[]> {
  const src = readFileSync(CLIENT, 'utf8').split('\n');
  const out = new Map<string, ClientAccount[]>();
  let method: string | null = null;
  for (const line of src) {
    const m = /^ {2}(?:private |public )?(?:async )?(\w+)\s*[(<]/.exec(line);
    if (m && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      method = m[1];
    }
    const meta = /pubkey:\s*([^,]+),\s*isSigner:\s*(true|false),\s*isWritable:\s*(true|false)/.exec(
      line
    );
    if (!meta || !method) continue;
    const expr = meta[1].trim();
    const hit = EXPR_TO_FIELD.find(([re]) => re.test(expr));
    if (!hit) continue; // a wallet or a pinned program id — not a named field
    const list = out.get(method) ?? [];
    list.push({ field: hit[1], writable: meta[3] === 'true' });
    out.set(method, list);
  }
  return out;
}

/**
 * Which accounts struct each client builder targets. Written out rather than
 * inferred, because the mapping is the thing under test: an instruction added
 * to the client without a line here is caught by the completeness test below.
 */
const BUILDER_TO_STRUCT: Record<string, string> = {
  openPool: 'OpenPool',
  initConfig: 'InitConfig',
  migrateConfig: 'MigrateConfig',
  fundPlatformWallet: 'FundPlatformWallet',
  revealPoolSecret: 'SettlePool',
  commitResults: 'SettlePool',
  payPrizes: 'PayPrizes',
  sendFlagIx: 'FlagEntry',
  releaseEscrow: 'ReleaseEscrow',
  liftSanctionsHold: 'LiftSanctionsHold',
  forfeitEscrow: 'ForfeitEscrow',
  payNextPlace: 'PayNextPlace',
  sealAtDeadline: 'SealAtDeadline',
  triggerRefund: 'TriggerRefund',
  refund: 'Refund',
  commitVrfSeed: 'CommitVrfSeed',
  createPassCollection: 'CreatePassCollection',
};

describe('account metadata, across the language boundary', () => {
  const rust = parseRustAccounts();
  const client = parseClientBuilders();

  it('parsed both sides', () => {
    expect(rust.size, 'accounts structs found in the program').to.be.greaterThan(10);
    expect(client.size, 'instruction builders found in the client').to.be.greaterThan(10);
    // The parse must actually see `mut` somewhere, or every assertion below
    // would pass vacuously.
    const anyMut = [...rust.values()].some((fields) => [...fields.values()].some(Boolean));
    expect(anyMut, 'the Rust parse never found a mut account — the parser is broken').to.equal(
      true
    );
  });

  for (const [method, structName] of Object.entries(BUILDER_TO_STRUCT)) {
    it(`${method} marks exactly the accounts ${structName} declares mut`, () => {
      const accounts = client.get(method);
      expect(accounts, `no account metadata parsed for ${method}`).to.not.equal(undefined);
      const fields = rust.get(structName);
      expect(fields, `no accounts struct named ${structName}`).to.not.equal(undefined);

      for (const account of accounts!) {
        const declaredMut = fields!.get(account.field);
        if (declaredMut === undefined) continue; // not a field of this struct
        expect(
          account.writable,
          `${method} sends '${account.field}' ${
            account.writable ? 'writable' : 'read-only'
          } but ${structName} declares it ${declaredMut ? 'mut' : 'read-only'}`
        ).to.equal(declaredMut);
      }
    });
  }

  it('every builder that emits account metadata is covered by the table above', () => {
    const uncovered = [...client.keys()].filter((m) => !(m in BUILDER_TO_STRUCT));
    expect(
      uncovered,
      `these builders emit account metadata that nothing compares against the program: ${uncovered.join(
        ', '
      )}`
    ).to.deep.equal([]);
  });
});
