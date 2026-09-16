import { expect } from 'chai';
import { ipPrefix, short } from '../src/short';

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
