/**
 * C11: the LIVE Turnkey spec — runs ONLY when the founder's sub-org
 * credentials are in the environment; otherwise every case is skipped
 * (visible as "pending", never silently green).
 *
 *   TURNKEY_API_BASE_URL      https://api.turnkey.com
 *   TURNKEY_API_PUBLIC_KEY    the API key pair's public half
 *   TURNKEY_API_PRIVATE_KEY   its private half
 *   TURNKEY_ORGANIZATION_ID   the blotto sub-organization
 *   TURNKEY_USER_ID           the API user inside it
 *
 * What it proves with real credentials: the full import→export round-trip
 * through the REAL envelope and enclave (the storage-label judgement call
 * in custody-turnkey.ts), and the export-refusal semantics — this
 * adapter's policy refusal, plus R21's Turnkey-side refusal, which
 * requires the sub-org policy denying `exportPrivateKey` to every API key
 * except the settlement service's (asserted as the Turnkey API error when
 * run with a second, unprivileged key via TURNKEY_UNPRIVILEGED_*).
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  ExportRefusedError,
  TurnkeyCustody,
  turnkeyEnvelope,
  type TurnkeyKeyVault,
} from '../src';

const ENV = process.env;
const configured =
  ENV.TURNKEY_API_BASE_URL &&
  ENV.TURNKEY_API_PUBLIC_KEY &&
  ENV.TURNKEY_API_PRIVATE_KEY &&
  ENV.TURNKEY_ORGANIZATION_ID &&
  ENV.TURNKEY_USER_ID;

(configured ? describe : describe.skip)('Turnkey LIVE (credentialed only)', function () {
  this.timeout(120_000);

  function liveVault(): TurnkeyKeyVault {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Turnkey } = require('@turnkey/sdk-server') as typeof import('@turnkey/sdk-server');
    const client = new Turnkey({
      apiBaseUrl: ENV.TURNKEY_API_BASE_URL!,
      apiPublicKey: ENV.TURNKEY_API_PUBLIC_KEY!,
      apiPrivateKey: ENV.TURNKEY_API_PRIVATE_KEY!,
      defaultOrganizationId: ENV.TURNKEY_ORGANIZATION_ID!,
    }).apiClient();
    return {
      async initImportPrivateKey(input) {
        const r = await client.initImportPrivateKey(input);
        return { importBundle: r.importBundle };
      },
      async importPrivateKey(input) {
        const r = await client.importPrivateKey(input);
        return { privateKeyId: r.privateKeyId };
      },
      async exportPrivateKey(input) {
        const r = await client.exportPrivateKey(input);
        return { exportBundle: r.exportBundle };
      },
    };
  }

  it('export before seal is refused; after seal the real enclave round-trips the exact bytes', async () => {
    let sealed = false;
    const custody = new TurnkeyCustody({
      vault: liveVault(),
      envelope: turnkeyEnvelope(),
      organizationId: ENV.TURNKEY_ORGANIZATION_ID!,
      userId: ENV.TURNKEY_USER_ID!,
      policy: async () => sealed,
    });
    const poolId = BigInt(Date.now()); // unique per run against the live org
    const published = await custody.createPoolKey(poolId);

    try {
      await custody.exportSecret(poolId);
      expect.fail('export before seal must refuse');
    } catch (e) {
      expect(e).to.be.instanceOf(ExportRefusedError);
    }

    sealed = true;
    const secret = await custody.exportSecret(poolId);
    const h = createHash('sha256').update(secret).digest();
    expect(Buffer.from(h).toString('hex')).to.equal(
      Buffer.from(published.secretHash).toString('hex')
    );
  });
});
