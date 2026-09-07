"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { truncateAddress } from "@/wallet/types";

/*
 * HOUSE PATTERN for wallet-address surfaces (founder call, 2026-08-09):
 * display TRUNCATED (first4…last4), tap-to-copy writes the FULL address,
 * live balance beside it where relevant. Extracted from the 10.B Step 2
 * signing spike so every surface (header, Steps 3/4 trade screens) uses
 * the same control — users tap any visible address expecting a copy.
 *
 * `navigator.clipboard.writeText` needs a secure context + user gesture
 * (iOS Safari is the strict one; the handler sits directly on the tap).
 * If the write throws or the API is absent, the fallback REVEALS the full
 * address and programmatically selects it so a long-press copy works —
 * selecting the truncated form would be useless. The failed state sticks
 * until the next tap: auto-resetting would destroy the user's selection.
 * Clipboard surfaces gate on a real-device pass; desktop results are
 * advisory.
 */

type CopyState = "idle" | "copied" | "failed";

function useCopyAddress(value: string) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const textRef = useRef<HTMLSpanElement>(null);

  const selectText = useCallback(() => {
    const node = textRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  // The full address must be in the DOM before it can be selected.
  useEffect(() => {
    if (copyState === "failed") selectText();
  }, [copyState, selectText]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard API");
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(
        () => setCopyState((s) => (s === "copied" ? "idle" : s)),
        2_500,
      );
    } catch {
      setCopyState("failed");
    }
  };

  return { copyState, textRef, selectText, copy };
}

/**
 * Pill form for the app header: the address itself is the tap-to-copy
 * control (users tap it expecting exactly that). Failure reveals the full
 * address, selected, in a dropdown panel under the pill.
 */
export function CopyableAddressPill({ value }: { value: string }) {
  const { copyState, textRef, selectText, copy } = useCopyAddress(value);
  return (
    <span className="relative">
      <button
        onClick={copy}
        data-testid="wallet-address-pill"
        className="rounded-full bg-raised px-3 py-1.5 font-mono text-xs text-ink"
        title="copy wallet address"
      >
        {copyState === "copied" ? "copied ✓" : truncateAddress(value)}
      </button>
      {copyState === "failed" ? (
        <span className="absolute top-full right-0 z-50 mt-1 flex w-64 flex-col gap-1 rounded border border-overlay bg-base p-2 shadow-lg">
          <span
            ref={textRef}
            onClick={selectText}
            className="font-mono text-xs break-all select-all"
          >
            {value}
          </span>
          <span className="font-mono text-[10px] text-ink-muted">
            copy blocked — address selected above, long-press to copy
          </span>
        </span>
      ) : null}
    </span>
  );
}
