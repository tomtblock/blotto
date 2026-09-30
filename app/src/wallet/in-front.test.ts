import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IN_FRONT_DEFAULTS, whenInFront, type PageView } from "./in-front";

/* A page whose front-ness the test drives: `bring()` fires the change
 * listeners the way a `focus` or `visibilitychange` event would. */
function page(state: { visible: boolean; focused: boolean }) {
  const listeners = new Set<() => void>();
  const view: PageView = {
    visible: () => state.visible,
    focused: () => state.focused,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const fire = () => {
    for (const l of listeners) l();
  };
  return { view, fire, listeners };
}

/* Whether a promise has settled, without awaiting it past the fake clock. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("the page-in-front wait before a mobile wallet prompt (2026-09-30)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves at once when the page is already in front — a first prompt from a tap pays nothing", async () => {
    const { view, listeners } = page({ visible: true, focused: true });
    const p = whenInFront(view);
    expect(await settled(p)).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("waits for the page to come in front, then the grace, then goes", async () => {
    const state = { visible: true, focused: false };
    const { view, fire, listeners } = page(state);
    const p = whenInFront(view, { maxWaitMs: 2500, graceMs: 300 });
    expect(await settled(p)).toBe(false);

    // A change that does not bring it in front is ignored.
    fire();
    expect(await settled(p)).toBe(false);

    state.focused = true;
    fire();
    expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(299);
    expect(await settled(p)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(p)).toBe(true);
  });

  it("needs both visible and focused", async () => {
    const state = { visible: false, focused: true };
    const { view, fire } = page(state);
    const p = whenInFront(view, { maxWaitMs: 2500, graceMs: 0 });
    fire();
    expect(await settled(p)).toBe(false);
    state.visible = true;
    fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled(p)).toBe(true);
  });

  it("goes anyway at the ceiling if the page never reports itself in front, and stops listening", async () => {
    const { view, listeners } = page({ visible: true, focused: false });
    const p = whenInFront(view, { maxWaitMs: 2500, graceMs: 300 });
    await vi.advanceTimersByTimeAsync(2499);
    expect(await settled(p)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(p)).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("defaults: a bounded wait and a short grace", () => {
    expect(IN_FRONT_DEFAULTS).toEqual({ maxWaitMs: 2500, graceMs: 300 });
  });
});
