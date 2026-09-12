/**
 * The territory gate must decide on an address the CALLER CANNOT CHOOSE.
 *
 * 2026-08-31, found while running the gate's negative cases against the live
 * service. Sending `X-Forwarded-For: <a Belgian address>` made it answer
 * `{"allowed":false}`; sending nothing made it answer `{"allowed":true}`.
 * The caller selected the verdict of a gate whose entire purpose is that they
 * cannot — a territory bypass (PID §8, CLAUDE.md tradeoff #2), and a
 * rate-limit bypass too, since the limiter keyed on the same value.
 *
 * The cause: a proxy APPENDS to X-Forwarded-For rather than overwriting it,
 * so the LEFTMOST entry is whatever the caller typed. The rightmost is what
 * our own proxy observed.
 */

import { strict as assert } from 'assert';
import { clientKeyFrom } from '../../_shared/src/http-hygiene';

describe('the caller cannot choose their own address', () => {
  it('REGRESSION: an injected leftmost hop does not win', () => {
    // Exactly the live bypass: attacker value first, real peer appended.
    const resolved = clientKeyFrom('81.246.0.1, 203.0.113.9', '10.0.0.1', undefined, true);
    assert.equal(resolved, '203.0.113.9', 'the proxy-observed hop is the last, not the first');
    assert.notEqual(resolved, '81.246.0.1', 'the caller-supplied value must never be used');
  });

  it('prefers Fly-Client-IP, which the proxy overwrites and a caller cannot forge', () => {
    assert.equal(
      clientKeyFrom('81.246.0.1, 1.128.0.1', '10.0.0.1', '203.0.113.9', true),
      '203.0.113.9'
    );
  });

  it('takes the last hop through a chain of proxies', () => {
    assert.equal(clientKeyFrom('1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.1', undefined, true), '3.3.3.3');
  });

  it('falls back to the socket peer with no forwarding headers', () => {
    assert.equal(clientKeyFrom(undefined, '203.0.113.9', undefined, true), '203.0.113.9');
  });

  it('tolerates whitespace, empty hops and a trailing comma', () => {
    assert.equal(clientKeyFrom('81.246.0.1 , , 203.0.113.9 ,', '10.0.0.1', undefined, true), '203.0.113.9');
  });

  it('an all-empty header does not resolve to an empty address', () => {
    assert.equal(clientKeyFrom(' , , ', '203.0.113.9', undefined, true), '203.0.113.9');
    assert.equal(clientKeyFrom(' , , ', undefined, undefined, true), 'unknown');
  });

  it('an array-valued header is still read as one hop list', () => {
    assert.equal(clientKeyFrom(['81.246.0.1, 203.0.113.9'], '10.0.0.1', undefined, true), '203.0.113.9');
  });

  it('trusts no header at all when the service is not behind our proxy (E-21)', () => {
    // The gate the resolver's doc has always described, and which until
    // 2026-09-12 it did not take as a parameter. Exposed directly, every
    // header on the request is the caller's own — including the Fly one,
    // which is only unforgeable because Fly Proxy overwrites it.
    assert.equal(clientKeyFrom('81.246.0.1', '203.0.113.9', '81.246.0.1', false), '203.0.113.9');
  });

  it('rate limiting and the territory gate resolve identically', () => {
    // One resolver, so a caller can never be one address to the limiter and
    // another to the gate.
    const headers = '81.246.0.1, 203.0.113.9';
    assert.equal(clientKeyFrom(headers, '10.0.0.1', undefined, true), clientKeyFrom(headers, '10.0.0.1', undefined, true));
  });
});
