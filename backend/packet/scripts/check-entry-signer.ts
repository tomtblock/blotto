/**
 * Entry-signer preflight — the check that closes C1.
 *
 * Runs the PRODUCTION selector and the PRODUCTION signer against the
 * environment you give it, signs a fixed test payload, and verifies the
 * result. Nothing here re-implements the signing path: it calls the same
 * `buildSigner` the packet service calls, so a pass here means the service
 * will work with these values, and a failure prints Turnkey's own error
 * instead of the uniform rejection the service is obliged to return.
 *
 * Written after two devnet failures on 2026-08-29/31 that this would have
 * caught in seconds: first a missing ENTRY_SIGNER_KEY_ID silently selecting
 * the development seed, then Turnkey refusing every signing request while
 * the service reported only "entry_unavailable".
 *
 * Run from backend/packet, with the same variables the app has:
 *
 *   TURNKEY_API_BASE_URL=... TURNKEY_API_PUBLIC_KEY=... \
 *   TURNKEY_API_PRIVATE_KEY=... TURNKEY_ORGANIZATION_ID=... \
 *   ENTRY_SIGNER_KEY_ID=... ENTRY_SIGNER_PUBLIC_KEY_HEX=... \
 *   npm run check-signer
 *
 * It prints the signer's Solana address so it can be compared against the
 * Turnkey console by eye. It never prints a secret: the API private key is
 * reported as present or absent only.
 */

import nacl from 'tweetnacl';
import { buildSigner, redact } from '../src/signer-select';

const PUBLIC_VARS = [
  'TURNKEY_API_BASE_URL',
  'TURNKEY_ORGANIZATION_ID',
  'ENTRY_SIGNER_KEY_ID',
  'ENTRY_SIGNER_PUBLIC_KEY_HEX',
] as const;
const SECRET_VARS = ['TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY'] as const;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

async function main(): Promise<void> {
  const env = process.env;

  console.log('--- configuration ---');
  // These four are public by definition: base URLs, org and key ids, and a
  // public key. Printing them is what lets an operator spot a wrong value.
  for (const k of PUBLIC_VARS) console.log(`  ${k.padEnd(28)} ${env[k] ?? '<unset>'}`);
  // These two are credentials. Presence only, never the value.
  for (const k of SECRET_VARS) console.log(`  ${k.padEnd(28)} ${env[k] ? '<set>' : '<unset>'}`);
  if (env.ENTRY_SIGNER_SEED_HEX) {
    console.log(`  ${'ENTRY_SIGNER_SEED_HEX'.padEnd(28)} <set — development seed is present>`);
  }
  console.log();

  console.log('--- selecting the signer (production code path) ---');
  const signer = buildSigner(env);
  console.log();

  console.log('--- signing a test payload ---');
  const message = Buffer.from('blotto-cup entry-signer preflight'.padEnd(85, '\0'));
  let signature: Uint8Array;
  try {
    signature = await signer.sign(new Uint8Array(message));
  } catch (e) {
    console.error('  FAILED. Turnkey refused the signing request:');
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    console.error();
    console.error('  Read the message above first — Turnkey names most of these itself:');
    console.error('   - "unable to load API key" / "invalid public key" / "compressed P-256"');
    console.error('     -> TURNKEY_API_PUBLIC_KEY and _PRIVATE_KEY are swapped, or one of them');
    console.error('        holds something that is not the P-256 API key pair. Note the entry');
    console.error('        signer is a DIFFERENT object: an Ed25519 key, not the API credential.');
    console.error('   - "not found" / "does not exist"');
    console.error('     -> ENTRY_SIGNER_KEY_ID names an object this organization does not hold,');
    console.error('        or TURNKEY_ORGANIZATION_ID is the parent org rather than the sub-org.');
    console.error('   - "unauthorized" / "policy" / "quorum"');
    console.error('     -> the API user exists but no policy lets it sign with this key.');
    process.exitCode = 1;
    return;
  }

  const publicKey = await signer.publicKey();
  const ok = nacl.sign.detached.verify(new Uint8Array(message), signature, publicKey);

  console.log(`  signature length      ${signature.length} bytes`);
  console.log(`  verifies against the configured public key: ${ok}`);
  console.log();
  console.log('--- the signer this configuration produces ---');
  console.log(`  hex     ${Buffer.from(publicKey).toString('hex')}`);
  console.log(`  base58  ${base58(publicKey)}`);
  console.log();

  if (!ok) {
    console.error('  MISMATCH. Turnkey signed with a DIFFERENT key than');
    console.error('  ENTRY_SIGNER_PUBLIC_KEY_HEX names. Fix the hex before C3 —');
    console.error('  after init_config it takes an admin-signed rotation to change.');
    process.exitCode = 1;
    return;
  }
  console.log('  PASS. Compare the base58 address above against the Turnkey console.');
  console.log('  If it matches, this configuration is correct and complete.');
  console.log(`  (signed via ${redact(process.env.ENTRY_SIGNER_KEY_ID)})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
