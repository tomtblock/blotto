import { expect } from 'chai';
import { ipPrefix, short, urlForLog } from '../src/short';

// 2026-09-16: one truncation rule for everything that reaches a log or an
// alert (the founder's data-minimisation ruling of 2026-09-15). The three
// copies these replace agreed on the shape and disagreed on the placeholder;
// the placeholder is now the caller's to name.
describe('short() and ipPrefix()', () => {
  it('keeps the first six and the last four of a long identifier', () => {
    const wallet = '7fpaNh8mAi9SDJyvu6sVFxsqqP8LE3whvBJ1K9ZFYPve';
    expect(short(wallet)).to.equal('7fpaNh…YPve');
    expect(short(wallet)).to.not.contain('SDJyvu6sVFx');
  });

  it('leaves a short value alone and names an absent one', () => {
    expect(short('abc')).to.equal('abc');
    expect(short('exactly12chr')).to.equal('exactly12chr');
    expect(short(undefined)).to.equal('<none>');
    expect(short('', '<unset>')).to.equal('<unset>');
    expect(short(null, '<unset>')).to.equal('<unset>');
  });

  it('truncates a v4 address to two octets and a v6 address to one hextet', () => {
    expect(ipPrefix('187.40.12.99')).to.equal('187.40.x.x');
    expect(ipPrefix('2a02:8109:abcd::1')).to.equal('2a02:…');
    expect(ipPrefix('not an address')).to.equal('unparsed');
    expect(ipPrefix(undefined)).to.equal('unknown');
    expect(ipPrefix('', 'none')).to.equal('none');
  });
});

// 2026-09-24: `review` logged the whole Helius devnet url, API key included,
// on every boot — and `backend-status` copies four hundred log lines per app
// into a retained GitHub Actions log, so every run of that diagnostic
// re-published it. These pin the property that matters: whatever goes in, no
// query string comes out.
describe('urlForLog()', () => {
  it('drops the query string, which is where the key lives', () => {
    const rpc = 'https://devnet.helius-rpc.com/?api-key=00000000-1111-2222-3333-444444444444';
    expect(urlForLog(rpc)).to.equal('https://devnet.helius-rpc.com/?…');
    expect(urlForLog(rpc)).to.not.contain('api-key');
    expect(urlForLog(rpc)).to.not.contain('444444444444');
  });

  it('keeps the host and the path, which are the useful parts', () => {
    expect(urlForLog('https://api.example.net/v2/lookup?key=s3cret')).to.equal(
      'https://api.example.net/v2/lookup?…'
    );
    expect(urlForLog('https://rpc.example.net/')).to.equal('https://rpc.example.net/');
  });

  it('drops userinfo, which is the other place a credential hides', () => {
    expect(urlForLog('https://user:hunter2@db.example.net/blotto')).to.equal(
      'https://…@db.example.net/blotto'
    );
    expect(urlForLog('postgres://u:p@host:5432/db?sslmode=verify-full')).to.equal(
      'postgres://…@host:5432/db?…'
    );
  });

  it('fails closed: an unparseable value is never echoed back', () => {
    // The case where a url is malformed is exactly the case where nobody has
    // checked what is in it, so returning the original would be the worst
    // possible default.
    expect(urlForLog('not a url at all ?api-key=leak')).to.equal('<unparseable url>');
    expect(urlForLog('not a url at all ?api-key=leak')).to.not.contain('leak');
  });

  it('names an absent value rather than printing "undefined"', () => {
    expect(urlForLog(undefined)).to.equal('<unset>');
    expect(urlForLog(null)).to.equal('<unset>');
    expect(urlForLog('')).to.equal('<unset>');
    expect(urlForLog('', '<none>')).to.equal('<none>');
  });
});
