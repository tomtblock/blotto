/*
 * Every call into the Privy SDK that accepts a Solana chain must name it.
 *
 * `privy-bridge.tsx` has documented since PR #102 that "Privy's per-request
 * default is mainnet, and an implicit default is exactly what broke the first
 * on-device signing attempt". The signing calls obeyed that; the FUNDING call
 * did not, and nothing noticed for two releases — the rule was held by a code
 * comment alone, eight lines above the place it was being broken.
 *
 * The consequence of the gap was not a failed transaction. A funding request
 * with no chain resolves to MAINNET, where card providers sell real SOL, while
 * every balance read, signature and settlement in this app is devnet. A player
 * would have spent real money into an address the app then reports as empty,
 * with no error on any screen. On a mainnet build the omission would silently
 * become correct and the defect would disappear without ever being fixed —
 * which is why this is asserted rather than left to review.
 *
 * This is a SOURCE-LEVEL check, deliberately. The bridge is a React component
 * whose whole job is to hand arguments to a third-party SDK; mounting it to
 * observe those arguments would test our mock of Privy, not our call into it.
 * Reading the file is coarse, but it fails for the right reason and it cannot
 * pass while a chain-taking call sits there without a chain.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BRIDGE_PATH = fileURLToPath(new URL('./privy-bridge.tsx', import.meta.url));
const bridge = readFileSync(BRIDGE_PATH, 'utf8');

/**
 * The SDK entry points that take an optional Solana chain and default it to
 * mainnet when it is absent. `signMessage` is deliberately NOT here: it signs
 * bytes and touches no cluster, so it has no chain argument to omit.
 */
const CHAIN_TAKING_CALLS = ['signTransaction', 'fundWallet'] as const;

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/**
 * Reads the argument text of every `name(…)` invocation, paren-matched so a
 * nested object or arrow inside the arguments does not truncate the slice.
 *
 * Scanned by hand rather than with a regular expression: one rule in the §8.7
 * language gate lacked a leading word boundary and matched the identifier of
 * JavaScript's regular-expression constructor, so building the search pattern
 * the obvious way failed CI. That is a false positive in the gate (fixed where
 * the gate lives, #85), not something to work around here — and this scan is
 * no worse for the job either way.
 */
function callArguments(source: string, name: string): string[] {
  const found: string[] = [];
  for (let at = source.indexOf(name); at !== -1; at = source.indexOf(name, at + 1)) {
    const before = source[at - 1];
    if (before !== undefined && IDENTIFIER_CHAR.test(before)) continue; // e.g. `useFundWallet`

    let i = at + name.length;
    while (source[i] === ' ' || source[i] === '\n') i += 1;
    if (source[i] !== '(') continue;

    const start = i;
    let depth = 0;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(start + 1, i));
  }
  return found;
}

describe('the Privy bridge', () => {
  it('pins the one chain this app configures to devnet', () => {
    expect(bridge).toContain('const SOLANA_CHAIN = "solana:devnet" as const;');
  });

  it.each(CHAIN_TAKING_CALLS)('names the chain on every %s call', (name) => {
    // The declaration site (`const { fundWallet } = useFundWallet()`) and the
    // hook itself are not calls into the SDK's chain-taking surface; only
    // invocations that pass an object literal are.
    const invocations = callArguments(bridge, name).filter((args) => args.includes('{'));

    expect(invocations.length, `no ${name}(…) invocation found — did the call move?`)
      .toBeGreaterThan(0);

    for (const args of invocations) {
      expect(args, `${name}(…) does not name the chain, so the SDK defaults it to MAINNET`)
        .toContain('chain: SOLANA_CHAIN');
    }
  });

  it('never writes a Solana chain as a bare string at a call site', () => {
    // Any literal other than through SOLANA_CHAIN defeats the single point of
    // control — including a devnet literal, which would then not move when the
    // constant does.
    const callSites = CHAIN_TAKING_CALLS.flatMap((name) => callArguments(bridge, name));
    for (const args of callSites) {
      expect(args, 'chain is written as a literal instead of SOLANA_CHAIN')
        .not.toMatch(/chain:\s*["'`]/);
    }
  });

  // Deliberately NOT asserted: "solana:mainnet" absent from the file. The
  // header quotes the original PR #102 error verbatim, and a check that
  // forbade naming the failure mode would punish documenting it.
});
