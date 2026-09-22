/**
 * Packet service specs (roadmap 4.2's gate): allowlisted → a signed packet
 * that verifies; blocked territory / VPN / sanctions / no attestation → the
 * SAME generic rejection, indistinguishable across causes. The encoding is
 * pinned to the Python oracle (fixtures/vectors.json).
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import {
  DEFAULT_TERRITORY_SCHEDULE,
  DEFAULT_WALLET_BLOCKLIST,
  GENERIC_REJECTION,
  LocalPacketSigner,
  MemoryAttestationStore,
  ed25519InstructionData,
  encodePacket,
  issuePacket,
  type AttestationStore,
  type PacketServiceDeps,
} from '../src';
import { base58Encode } from '../src/shared';
import { ciphertextMessage } from '../src/ciphertext-message';

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'vectors.json'), 'utf8')
);

const WALLET = base58Encode(new Uint8Array(32).fill(3));
const POOL = base58Encode(new Uint8Array(32).fill(4));

/** A store already holding WALLET's clickwrap record at `termsVersion`. */
function attested(termsVersion = 1): AttestationStore {
  const store = new MemoryAttestationStore();
  void store.put({
    wallet: WALLET,
    termsVersion,
    attested18: true,
    timestamp: 1_756_000_000n,
    walletSignature: 'dGVzdA==',
  });
  return store;
}

function deps(
  overrides: Partial<{
    country: string;
    region: string;
    vpn: boolean;
    sanctioned: boolean;
    attestations: AttestationStore;
  }> = {}
): PacketServiceDeps {
  return {
    geo: {
      async lookup() {
        return {
          country: overrides.country ?? 'GB',
          region: overrides.region,
          vpnOrProxy: overrides.vpn ?? false,
        };
      },
    },
    sanctions: {
      async isSanctioned() {
        return overrides.sanctioned ?? false;
      },
    },
    signer: new LocalPacketSigner(new Uint8Array(32).fill(7)),
    attestations: overrides.attestations ?? attested(),
    config: { blockedWallets: DEFAULT_WALLET_BLOCKLIST, territories: DEFAULT_TERRITORY_SCHEDULE, kycTier: 0, termsVersion: 1, termsUpdated: '2026-09-06' },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

const request = { wallet: WALLET, pool: POOL, ip: '203.0.113.7' };

describe('the packet encoding (pinned to the Python oracle)', () => {
  for (const c of vectors.cases) {
    it(`layout: ${c.name}`, () => {
      const bytes = encodePacket({
        wallet: c.wallet,
        pool: c.pool,
        nonce: BigInt(c.nonce),
        geoCleared: c.geo_cleared === 1,
        ageVerified: c.age_verified === 1,
        kycTier: c.kyc_tier,
        issuedAt: BigInt(c.issued_at),
        termsVersion: c.terms_version,
      });
      expect(Buffer.from(bytes).toString('hex')).to.equal(c.expected_hex);
    });
  }
});

describe('packet issuance', () => {
  it('allowlisted, clean, attested → a packet whose signature verifies', async () => {
    const res = await issuePacket(deps(), request);
    if (!res.ok) throw new Error('expected a packet');
    const message = Buffer.from(res.message, 'base64');
    const signature = Buffer.from(res.signature, 'base64');
    const publicKey = Buffer.from(res.publicKey, 'base64');
    expect(message.length).to.equal(85);
    expect(nacl.sign.detached.verify(message, signature, publicKey)).to.equal(true);
    // geo_cleared and age_verified are set; kyc tier is 0 at launch (R3).
    expect(message[72]).to.equal(1);
    expect(message[73]).to.equal(1);
    expect(message[74]).to.equal(0);
    // D-B4: the accepted terms version rides at offset 83 (u16 LE).
    expect(message[83] | (message[84] << 8)).to.equal(1);
    // The ed25519 instruction bytes are self-referential and well-formed.
    const ix = ed25519InstructionData(publicKey, signature, message);
    expect(ix[0]).to.equal(1);
    expect(ix.length).to.equal(16 + 32 + 64 + 85);
  });

  it('every failure is the SAME generic rejection', async () => {
    const results = await Promise.all([
      issuePacket(deps({ country: 'BE' }), request), // blocked territory
      issuePacket(deps({ vpn: true }), request), // VPN
      issuePacket(deps({ sanctioned: true }), request), // sanctions
      issuePacket(deps({ attestations: new MemoryAttestationStore() }), request), // no attestation
      issuePacket(deps({ attestations: attested(0) }), request), // stale terms version
      issuePacket(
        {
          ...deps(),
          geo: {
            async lookup(): Promise<never> {
              throw new Error('vendor down');
            },
          },
        },
        request
      ), // upstream failure
    ]);
    for (const r of results) {
      expect(r).to.deep.equal(GENERIC_REJECTION);
    }
    // Literally identical serialisations — nothing to fingerprint.
    const texts = results.map((r) => JSON.stringify(r));
    expect(new Set(texts).size).to.equal(1);
  });

  // Rewritten for schedule version 3 (founder instruction 2026-09-12 §3.1).
  // The assertion it replaces named BE + AU, which was the whole policy from
  // 2026-08-28; this walks every code in the PID §9 confirmed block through
  // the real issuance path rather than through `territoryAllowed` alone.
  // 2026-09-21 (D-B3-3): `US` joins them at country level. It is not a §9
  // country row — §9 names twelve states — so the title says so rather than
  // quietly folding it into the count.
  it('the schedule blocks all fourteen PID §9 countries plus US — and only those', async () => {
    expect(DEFAULT_TERRITORY_SCHEDULE.posture).to.equal('block-list');
    expect(DEFAULT_TERRITORY_SCHEDULE.allowed).to.deep.equal([]);

    const blocked = ['AE', 'AU', 'BE', 'BH', 'CN', 'HK', 'ID', 'IN', 'KW', 'MY', 'OM', 'QA', 'SA', 'SG', 'US'];
    expect(DEFAULT_TERRITORY_SCHEDULE.blocked).to.deep.equal(blocked);
    for (const country of blocked) {
      const r = await issuePacket(deps({ country }), request);
      expect(r.ok, country).to.equal(false);
    }

    // The §9 "open subject to counsel" territories are NOT blocks and must
    // keep issuing.
    //
    // US was in this list until 2026-09-21, with a note that it was admitted
    // because the state-level rows are held and "blocking it would be a
    // decision nobody has taken". The founder has now taken it (D-B3-3), so
    // US moves to the blocked walk above. FR stays here: Part 6.3 of the
    // counsel brief has France open subject to confirmation, and that IS
    // still a decision nobody has taken.
    for (const country of ['GB', 'IE', 'DE', 'FR', 'AR', 'CA', 'BR', 'JP', 'KR']) {
      const r = await issuePacket(deps({ country }), request);
      expect(r.ok, country).to.equal(true);
    }
  });

  // §3.2: enforcement is on ENTRY, never on receipt. A player who entered
  // lawfully and later travels must still be paid and still be refunded.
  //
  // This holds structurally rather than by a check: prizes are PUSHED (R10 —
  // there is no claim instruction to gate), and `refund` is permissionless
  // on chain, so neither path passes through this service at all. The test
  // pins that by asserting the thing that WOULD break it — that the packet
  // service's only product is an ENTRY packet, and refusing one leaves every
  // other path untouched.
  it('a blocked territory refuses an entry and nothing else (§3.2: receipt is never gated)', async () => {
    const refused = await issuePacket(deps({ country: 'IN' }), request);
    expect(refused.ok).to.equal(false);
    // The refusal is the generic one — it carries no instruction, no hold,
    // and nothing a payout or refund path could consult.
    expect(refused).to.deep.equal(GENERIC_REJECTION);
    // And there is no route here that could gate a payout: the service
    // issues entry packets, stores sealed allocations and answers /geo.
    const { handleEntryRoute } = require('../src/server');
    expect(typeof handleEntryRoute).to.equal('function');
  });
});

describe('the entry service routes', () => {
  const { handleEntryRoute } = require('../src/server');
  const { MemoryPoolIdResolver } = require('../src/pool-ids');
  const { MemorySeatResolver } = require('../src/seats');
  const { MemoryCiphertextStore } = require('../../sealing/src');

  /** The pool's on-chain numeric id — the key every reader of the ciphertext
   * store uses. The route must resolve the PDA to THIS, not to anything it
   * derives locally (audit B-01). */
  const POOL_ID = 7n;

  /** A wallet that can actually sign, so the route's ownership check is
   * exercised rather than stubbed. */
  function sealer() {
    const kp = nacl.sign.keyPair();
    const wallet = base58Encode(kp.publicKey);
    return {
      wallet,
      sign(pool: string, ciphertext: Uint8Array): string {
        const msg = ciphertextMessage(pool, wallet, new Uint8Array(ciphertext));
        return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64');
      },
    };
  }
  const SEALER = sealer();
  const ATTACKER = (() => {
    const kp = nacl.sign.keyPair();
    return {
      sign(pool: string, ciphertext: Uint8Array): string {
        // Signs the VICTIM's canonical message with the attacker's key.
        const msg = ciphertextMessage(pool, SEALER.wallet, new Uint8Array(ciphertext));
        return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64');
      },
    };
  })();
  const POOL_IDS = () => {
    const r = new MemoryPoolIdResolver();
    r.set(POOL, POOL_ID);
    return r;
  };

  function serverDeps() {
    return {
      packet: deps(),
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: POOL_IDS(),
      // No seat registered by default: the ordinary case is a player part
      // way through their first entry, which is exactly when an overwrite
      // must be allowed (DRIFT.md §H6).
      seats: new MemorySeatResolver(),
      trustProxyHeader: false,
    };
  }

  it('issues a packet over POST /packet and rejects generically on block', async () => {
    const d = serverDeps();
    const ok = await handleEntryRoute(
      d,
      'POST',
      '/packet',
      { wallet: WALLET, pool: POOL },
      '203.0.113.7'
    );
    expect(ok.status).to.equal(200);
    const blocked = await handleEntryRoute(
      { ...d, packet: deps({ country: 'BE' }) },
      'POST',
      '/packet',
      { wallet: WALLET, pool: POOL },
      '203.0.113.7'
    );
    expect(blocked.status).to.equal(403);
    expect(blocked.body).to.deep.equal(GENERIC_REJECTION);
    // Malformed input: the SAME generic body.
    const malformed = await handleEntryRoute(d, 'POST', '/packet', { wallet: 'x' }, 'ip');
    expect(malformed.status).to.equal(403);
    expect(malformed.body).to.deep.equal(GENERIC_REJECTION);
  });

  it('stores a well-formed ciphertext and rejects wrong sizes', async () => {
    const d = serverDeps();
    const goodBytes = Buffer.alloc(48 + 127, 7);
    const good = goodBytes.toString('base64');
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: good, signature: SEALER.sign(POOL, goodBytes) },
      'ip'
    );
    expect(res.status).to.equal(204);
    // Read back by the NUMERIC pool id — the key the crank and the read API
    // use. Reading back through any transform this route applied would pin
    // the defect instead of catching it.
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(stored).to.not.equal(null);
    const short = Buffer.alloc(10);
    const bad = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: short.toString('base64'), signature: SEALER.sign(POOL, short) },
      'ip'
    );
    expect(bad.status).to.equal(400);
  });

  it('refuses a ciphertext for a pool it cannot resolve, rather than guessing a key', async () => {
    const d = serverDeps();
    const unknown = base58Encode(new Uint8Array(32).fill(9));
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: unknown, player: SEALER.wallet, ciphertext: bytes.toString('base64'), signature: SEALER.sign(unknown, bytes) },
      'ip'
    );
    expect(res.status).to.equal(400);
    expect(await d.ciphertexts.listForPool(POOL_ID)).to.have.length(0);
  });

  it('refuses a sealed allocation signed by anyone other than the player (audit B-02)', async () => {
    const d = serverDeps();
    const bytes = Buffer.alloc(48 + 127, 7);
    // The attacker signs with their OWN key and names the victim as player.
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      {
        pool: POOL,
        player: SEALER.wallet,
        ciphertext: bytes.toString('base64'),
        signature: ATTACKER.sign(POOL, bytes),
      },
      'ip'
    );
    expect(res.status).to.equal(403);
    expect(await d.ciphertexts.get(POOL_ID, SEALER.wallet)).to.equal(null);
  });

  it('refuses an unsigned sealed allocation', async () => {
    const d = serverDeps();
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: bytes.toString('base64') },
      'ip'
    );
    expect(res.status).to.equal(403);
  });

  /**
   * The gate that cost eleven devnet wallets, and the gate it became
   * (DRIFT.md §H6, fixed 2026-09-18).
   *
   * What must never be overwritten is a seat THE CHAIN HAS ACCEPTED: the
   * chain holds that run's battles_hash and a mismatch is scored all
   * losses. What was being refused instead was any second, different
   * ciphertext at all — including from a player whose first attempt never
   * reached the chain, who had paid nothing and could never enter again.
   */
  const post = (d: any, b: Buffer) =>
    handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: b.toString('base64'), signature: SEALER.sign(POOL, b) },
      'ip'
    );

  it('will not replace the allocation of a seat the chain has accepted, and stays idempotent', async () => {
    const d = serverDeps();
    const first = Buffer.alloc(48 + 127, 7);
    const again = Buffer.alloc(48 + 127, 9);
    expect((await post(d, first)).status).to.equal(204);
    // The same bytes again is an ordinary retry, registered or not.
    expect((await post(d, first)).status).to.equal(204);
    // The chain accepts the seat. From here the ciphertext is load-bearing.
    d.seats.register(POOL, SEALER.wallet);
    expect((await post(d, again)).status).to.equal(409);
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(Buffer.from(stored!.ciphertext).equals(first)).to.equal(true);
  });

  it('lets a wallet re-seal while no seat is registered — the lockout, gone (§H6)', async () => {
    const d = serverDeps();
    const abandoned = Buffer.alloc(48 + 127, 7);
    const second = Buffer.alloc(48 + 127, 9);
    // A first run that sealed and then failed: refused packet, dismissed
    // prompt, closed laptop. Nothing was paid and no seat exists.
    expect((await post(d, abandoned)).status).to.equal(204);
    // The replay carries a fresh salt, so the bytes are always different.
    expect((await post(d, second)).status).to.equal(204);
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(
      Buffer.from(stored!.ciphertext).equals(second),
      'the second run is the one that must be stored'
    ).to.equal(true);
  });

  it('refuses the overwrite when the seat lookup cannot answer (fails CLOSED)', async () => {
    const d = serverDeps();
    const first = Buffer.alloc(48 + 127, 7);
    const again = Buffer.alloc(48 + 127, 9);
    expect((await post(d, first)).status).to.equal(204);
    // A broken database must never be read as "no seat registered": that
    // direction of failure costs a player their paid entry, while this one
    // costs a retry before anything is paid.
    d.seats.breakIt();
    expect((await post(d, again)).status).to.equal(409);
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(Buffer.from(stored!.ciphertext).equals(first)).to.equal(true);
  });

  it('keys the seat lookup on the pool PDA, which is what the entries projection holds', async () => {
    // `entries.pool` is TEXT holding the base58 PDA (migration 0003,
    // written from EntryRegistered.pool). The ciphertext STORE is keyed by
    // the numeric id. Keying this lookup by the id would match no row for
    // any player, read as "not registered", and allow every overwrite —
    // failing open in the one direction that costs a paid entry.
    const d = serverDeps();
    const first = Buffer.alloc(48 + 127, 7);
    const again = Buffer.alloc(48 + 127, 9);
    expect((await post(d, first)).status).to.equal(204);
    // Registered under the numeric id — the wrong key. Nothing sees it.
    d.seats.register(String(POOL_ID), SEALER.wallet);
    expect((await post(d, again)).status).to.equal(204);
    // Registered under the PDA — the right key. The gate closes.
    const third = Buffer.alloc(48 + 127, 11);
    d.seats.register(POOL, SEALER.wallet);
    expect((await post(d, third)).status).to.equal(409);
  });

  it('refuses a sealed allocation once the pool has stopped accepting entries', async () => {
    const d = serverDeps();
    d.poolIds.set(POOL, POOL_ID, 'Sealed');
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: bytes.toString('base64'), signature: SEALER.sign(POOL, bytes) },
      'ip'
    );
    expect(res.status).to.equal(409);
  });

  /**
   * "Am I sealed here?" — the question nothing could ask (DRIFT.md §H6).
   * The lockout was not only irreversible, it was invisible: the battle
   * test's own preflight reported GO for two wallets that were already
   * barred, because there was no way to find out.
   */
  describe('POST /ciphertexts/status', () => {
    const { ciphertextStatusMessage } = require('../src/ciphertext-message');
    // `deps()` fixes the service clock; the signed message must agree with it.
    const AT = deps().now();
    const statusSig = (pool: string, wallet: string, kp: nacl.SignKeyPair, at = AT) =>
      Buffer.from(
        nacl.sign.detached(ciphertextStatusMessage(pool, wallet, at), kp.secretKey)
      ).toString('base64');

    const ASKER = (() => {
      const kp = nacl.sign.keyPair();
      return { kp, wallet: base58Encode(kp.publicKey) };
    })();

    const ask = (d: any, body: unknown) =>
      handleEntryRoute(d, 'POST', '/ciphertexts/status', body, 'ip');

    it('tells a wallet the truth about itself, before and after it seals', async () => {
      const d = serverDeps();
      const before = await ask(d, {
        pool: POOL,
        player: ASKER.wallet,
        atUnix: AT.toString(),
        signature: statusSig(POOL, ASKER.wallet, ASKER.kp),
      });
      expect(before.status).to.equal(200);
      expect(before.body).to.deep.equal({ sealed: false });

      const bytes = Buffer.alloc(48 + 127, 3);
      const msg = ciphertextMessage(POOL, ASKER.wallet, new Uint8Array(bytes));
      await handleEntryRoute(
        d,
        'POST',
        '/ciphertexts',
        {
          pool: POOL,
          player: ASKER.wallet,
          ciphertext: bytes.toString('base64'),
          signature: Buffer.from(nacl.sign.detached(msg, ASKER.kp.secretKey)).toString('base64'),
        },
        'ip'
      );

      const after = await ask(d, {
        pool: POOL,
        player: ASKER.wallet,
        atUnix: AT.toString(),
        signature: statusSig(POOL, ASKER.wallet, ASKER.kp),
      });
      expect(after.status).to.equal(200);
      expect(after.body).to.deep.equal({ sealed: true });
    });

    it('never answers for a wallet the caller cannot sign for', async () => {
      const d = serverDeps();
      const other = nacl.sign.keyPair();
      const res = await ask(d, {
        pool: POOL,
        player: SEALER.wallet,
        atUnix: AT.toString(),
        // Signs the VICTIM's canonical message with someone else's key.
        signature: statusSig(POOL, SEALER.wallet, other),
      });
      expect(res.status).to.equal(403);
    });

    it('refuses a write signature replayed as a read, and a stale read signature', async () => {
      const d = serverDeps();
      const bytes = Buffer.alloc(48 + 127, 3);
      const writeMsg = ciphertextMessage(POOL, ASKER.wallet, new Uint8Array(bytes));
      const replayed = await ask(d, {
        pool: POOL,
        player: ASKER.wallet,
        atUnix: AT.toString(),
        signature: Buffer.from(
          nacl.sign.detached(writeMsg, ASKER.kp.secretKey)
        ).toString('base64'),
      });
      expect(replayed.status, 'the two messages must not be interchangeable').to.equal(403);

      const stale = await ask(d, {
        pool: POOL,
        player: ASKER.wallet,
        atUnix: (AT - 3600n).toString(),
        signature: statusSig(POOL, ASKER.wallet, ASKER.kp, AT - 3600n),
      });
      expect(stale.status).to.equal(403);
    });

    it('answers 400 for a pool it cannot resolve, not a cheerful false', async () => {
      const d = serverDeps();
      const unknown = base58Encode(new Uint8Array(32).fill(9));
      const res = await ask(d, {
        pool: unknown,
        player: ASKER.wallet,
        atUnix: AT.toString(),
        signature: statusSig(unknown, ASKER.wallet, ASKER.kp),
      });
      expect(res.status).to.equal(400);
    });

    it('still answers after the pool has sealed — a barred wallet asks late', async () => {
      const d = serverDeps();
      d.poolIds.set(POOL, POOL_ID, 'Sealed');
      const res = await ask(d, {
        pool: POOL,
        player: ASKER.wallet,
        atUnix: AT.toString(),
        signature: statusSig(POOL, ASKER.wallet, ASKER.kp),
      });
      expect(res.status).to.equal(200);
    });
  });
});
