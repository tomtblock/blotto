import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureEd25519, hasNativeEd25519, resetEd25519ForTests } from './ed25519';

describe('Ed25519 in WebCrypto (2026-09-30, the Android WebView)', () => {
  afterEach(() => resetEd25519ForTests());

  it('reads a native implementation from a successful key generation', async () => {
    const ok = { generateKey: vi.fn(async () => ({})) };
    expect(await hasNativeEd25519(ok)).toBe(true);
    expect(ok.generateKey).toHaveBeenCalledWith({ name: 'Ed25519' }, false, ['sign', 'verify']);

    const notSupported = {
      generateKey: vi.fn(async () => {
        throw new DOMException('Ed25519 is not supported', 'NotSupportedError');
      }),
    };
    expect(await hasNativeEd25519(notSupported)).toBe(false);
    // No `generateKey` at all (an insecure context's bare `subtle`).
    expect(await hasNativeEd25519({} as never)).toBe(false);
  });

  it('does nothing — and downloads nothing — where Ed25519 is native', async () => {
    const install = vi.fn(async () => {});
    await ensureEd25519({ native: async () => true, install });
    expect(install).not.toHaveBeenCalled();
  });

  it('installs the polyfill once where it is not, however many callers await it', async () => {
    const install = vi.fn(async () => {});
    const native = vi.fn(async () => false);
    await Promise.all([
      ensureEd25519({ native, install }),
      ensureEd25519({ native, install }),
      ensureEd25519({ native, install }),
    ]);
    await ensureEd25519({ native, install });
    expect(native).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('a failed install is not remembered: the next caller tries again', async () => {
    let calls = 0;
    const install = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('chunk failed to load');
    });
    await expect(ensureEd25519({ native: async () => false, install })).rejects.toThrow('chunk failed to load');
    await ensureEd25519({ native: async () => false, install });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it('this test runtime (Node) has Ed25519 natively, so the real probe says so', async () => {
    expect(await hasNativeEd25519()).toBe(true);
  });
});
