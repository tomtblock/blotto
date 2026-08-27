/**
 * Turnkey entry-packet signer (C11, R21) — the production `PacketSigner`.
 * Sign-only by construction: the Ed25519 entry-signer key lives in the
 * founder's Turnkey sub-org and never exports; this adapter only ever runs
 * `signRawPayload` (PAYLOAD_ENCODING_HEXADECIMAL + HASH_FUNCTION_NOT_
 * APPLICABLE — ed25519 hashes internally; shapes verified against the
 * installed @turnkey/sdk-server 8.2.1 types).
 *
 * The public key is CONFIG, not an API call: it is `Config.entry_signer`
 * on-chain — public by definition — and passing it in keeps `publicKey()`
 * synchronous-cheap and the adapter's client surface sign-only. A
 * mismatched config fails at the program's Ed25519 check, never silently.
 *
 * Credentials (founder-provisioned): TURNKEY_API_BASE_URL /
 * TURNKEY_API_PUBLIC_KEY / TURNKEY_API_PRIVATE_KEY /
 * TURNKEY_ORGANIZATION_ID, plus ENTRY_SIGNER_KEY_ID (the Turnkey private
 * key id or its Solana address) and ENTRY_SIGNER_PUBLIC_KEY_HEX.
 */

import type { PacketSigner } from './packet';

/** The one call this adapter makes — injected so specs run against a fake;
 * the live `Turnkey(...).apiClient()` satisfies it structurally. */
export interface TurnkeyRawSigner {
  signRawPayload(input: {
    organizationId: string;
    signWith: string;
    payload: string;
    encoding: 'PAYLOAD_ENCODING_HEXADECIMAL';
    hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE';
  }): Promise<{ r: string; s: string }>;
}

export interface TurnkeyPacketSignerConfig {
  client: TurnkeyRawSigner;
  organizationId: string;
  /** Turnkey private key id (or its address) for the entry signer. */
  signWith: string;
  /** The key's Ed25519 public key, hex — must equal `Config.entry_signer`. */
  publicKeyHex: string;
}

const unhex = (s: string) => new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));

export class TurnkeyPacketSigner implements PacketSigner {
  private readonly pub: Uint8Array;

  constructor(private readonly cfg: TurnkeyPacketSignerConfig) {
    this.pub = unhex(cfg.publicKeyHex);
    if (this.pub.length !== 32) {
      throw new Error('publicKeyHex must be 32 bytes of hex');
    }
  }

  async publicKey(): Promise<Uint8Array> {
    return this.pub.slice();
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const { r, s } = await this.cfg.client.signRawPayload({
      organizationId: this.cfg.organizationId,
      signWith: this.cfg.signWith,
      payload: Buffer.from(message).toString('hex'),
      encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
      hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE',
    });
    const rb = unhex(r);
    const sb = unhex(s);
    if (rb.length !== 32 || sb.length !== 32) {
      throw new Error(`turnkey returned r=${rb.length}/s=${sb.length} bytes, expected 32/32`);
    }
    const signature = new Uint8Array(64);
    signature.set(rb, 0);
    signature.set(sb, 32);
    return signature;
  }
}
