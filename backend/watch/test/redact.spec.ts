import { expect } from 'chai';
import { redact } from '../src/redact';

// Every secret-shaped string is assembled at runtime, so the repository holds
// none and the secret scanner stays green.
const j = (...p: string[]): string => p.join('');
const PROGRAM = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';

describe('evidence redaction', () => {
  const cases: [string, string, string][] = [
    ['an RPC API key in a URL', j('https://devnet.helius-rpc.com/?api', '-key=', 'abcd-1234-efgh'), 'https://devnet.helius-rpc.com/?api-key=<redacted>'],
    ['a bearer token', j('Authorization: Bearer ', 'abcdefghijklmnop'), 'Authorization: <redacted>'],
    ['a Postgres password', j('postgres://blotto:', 's3cretpass', '@db.internal:5432/x'), 'postgres://blotto:<redacted>@db.internal:5432/x'],
    ['a Telegram bot token', j('bot', '1234567890', ':', 'A'.repeat(35), '/sendMessage'), 'bot<telegram-token>/sendMessage'],
    ['a GitHub token', j('token ', 'ghp', '_', 'a'.repeat(36)), 'token <github-token>'],
    ['a fine-grained GitHub token', j('github', '_pat_', 'B'.repeat(40)), '<github-token>'],
    ['a keypair array', `[${Array.from({ length: 64 }, (_, i) => i % 256).join(',')}]`, '<keypair>'],
    ['a full IPv4 address', 'client 198.51.100.7 refused', 'client <ip> refused'],
    ['the a.b.x.x prefix the services log', 'packet: geo ALLOW 203.0.x.x — GB', 'packet: geo ALLOW <ip> — GB'],
    ['an IPv6 address', 'from fdaa:0:1:a7b:23c:9a2e:4c4f:2 now', 'from <ip> now'],
    ['a compressed IPv6 address', 'via 2a09:8280:1::4e', 'via <ip>'],
  ];
  for (const [what, input, expected] of cases) {
    it(`removes ${what}`, () => expect(redact(input).text).to.equal(expected));
  }

  it('shortens wallet-length base58, but keeps what is on the keep list', () => {
    const wallet = '7fpaNh8mAi9SDJyvu6sVFxsqqP8LE3whvBJ1K9ZFYPve';
    expect(redact(`player ${wallet} program ${PROGRAM}`, [PROGRAM]).text).to.equal(`player 7fpa… program ${PROGRAM}`);
  });

  it('leaves timestamps, balances, versions, pool ids and machine ids alone', () => {
    const line = '2026-10-15T02:06:48.705Z settlementSol 9.196024324 pool 101 web3 1.98.4 machine 3d8d9e1f2c5e89';
    expect(redact(line).text).to.equal(line);
  });

  it('counts what it removed', () => {
    expect(redact('a 198.51.100.7 b 203.0.x.x').counts.ipv4).to.equal(2);
  });
});
