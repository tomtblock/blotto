import { describe, expect, it } from 'vitest';
import { DEPLOY, deployCountAt, msToDeploy } from './deploy';

describe('the deploy curve (mockup numbers)', () => {
  it('releases nothing before the hold and never more than the cap', () => {
    expect(deployCountAt(0)).toBe(0);
    expect(deployCountAt(-50)).toBe(0);
    expect(deployCountAt(60_000)).toBe(DEPLOY.max);
  });
  it('matches the README: 5 at half a second, 46 at two seconds, 100 by about 3.4 s', () => {
    expect(deployCountAt(500)).toBe(5);
    expect(deployCountAt(2000)).toBe(46);
    expect(deployCountAt(3400)).toBeGreaterThanOrEqual(100);
    expect(msToDeploy(100)).toBeLessThan(3500);
  });
  it('is monotone', () => {
    let prev = 0;
    for (let ms = 0; ms <= 20_000; ms += 37) {
      const n = deployCountAt(ms);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});
