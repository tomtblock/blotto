"use client";

/*
 * The wallet card (2026-09-08): the one place a player sees what they hold,
 * adds to it, takes it out, or chooses which wallet plays. Rendered on the
 * wallet screen and at the top of the profile. Depends on useAuth and the tx
 * seam only — never on the provider SDK.
 *
 * What it answers, in the founder's words: "the portal to how viewers know
 * how much they've won, how much balance they've got to play with … the same
 * for whatever sign-in route they take."
 *
 *   - Balance: live, bigint end to end (`useBalance`).
 *   - Add SOL: the provider's deposit-address screen (the only funding route
 *     that works on devnet), plus a test-faucet link behind a build switch.
 *   - Send SOL: a real transfer on the entry tx seam — the exit for a player
 *     paid into a wallet the provider made for them.
 *   - Move my wallet to Phantom: the provider's key-export screen (embedded
 *     wallets only) — the other exit.
 *   - Use a different wallet: attach Phantom to THIS account.
 *   - The picker: which connected wallet enters, is paid, and is shown.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { COPY } from "@/copy";
import { useAuth } from "@/wallet/auth-context";
import { balanceQueryKey, useBalance } from "@/wallet/use-balance";
import { formatSolShort, lamportsToSol, solToLamports } from "@/data/format";
import { rpcUrl } from "@/chain/rpc";
import { explorerTxUrl, isMainnet } from "@/chain/cluster";
import { makeTxRpc } from "@/tx/tx-rpc";
import { checkSend, maxSendableLamports, sendSol } from "@/tx/send-sol";
import type { TradeResult } from "@/tx/execute";
import { Button } from "@/components/ui/button";
import { NeonSection } from "@/components/ui/neon-section";
import { Sheet } from "@/components/ui/sheet";
import { Stat } from "@/components/ui/stat";
import { CopyableAddressPill } from "@/components/copyable-address";
import { openFunding } from "@/wallet/funding";

/** Devnet only — see .env.example. Inlined at build; absent in real-money builds. */
const FAUCET_ENABLED = process.env.NEXT_PUBLIC_DEVNET_FAUCET === "1";
const FAUCET_URL = "https://faucet.solana.com/";
/*
 * On devnet the deposit-address screen is the only funding method that can
 * work (no card or exchange provider sells devnet SOL); on mainnet the
 * provider chooses among whatever methods the dashboard has switched on.
 */
const FUNDING_METHOD = isMainnet() ? ("any" as const) : ("receive" as const);

export function WalletCard({ headingAs = "h2" }: { headingAs?: "h1" | "h2" } = {}) {
  const auth = useAuth();
  const wallet = auth.status === "signed-in" ? auth.walletAddress : null;
  const balance = useBalance(wallet);
  const queryClient = useQueryClient();
  const [sendOpen, setSendOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [funding, setFunding] = useState(false);
  /*
   * D-14 (audit 2026-09-11): the provider's refusal — "Wallet funding is
   * not enabled", which is its state today — used to go to the console and
   * nowhere else, so the button was inert with no explanation. The player
   * sees it now, with the route that does not depend on the provider.
   */
  const [fundingFailed, setFundingFailed] = useState(false);

  if (!wallet) {
    return (
      <NeonSection heading={COPY.wallet.title} headingAs={headingAs}>
        <p className="text-[15px] text-ink-muted">{COPY.wallet.signInFirst}</p>
      </NeonSection>
    );
  }

  const active = auth.signers.find((s) => s.address === wallet) ?? null;
  const whichWallet = active
    ? active.kind === "embedded"
      ? COPY.wallet.whichEmbedded
      : COPY.wallet.whichExternal(active.label)
    : null;

  return (
    <NeonSection heading={COPY.wallet.title} headingAs={headingAs} data-testid="wallet-card">
      <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Stat
          label={COPY.wallet.balanceLabel}
          value={
            balance.data !== undefined
              ? lamportsToSol(balance.data.toString())
              : balance.isError
                ? "–"
                : "…"
          }
          unit="SOL"
          size="moment"
        />
        <div className="flex flex-col items-end gap-2">
          <CopyableAddressPill value={wallet} />
          {whichWallet ? (
            <span className="text-[12px] text-ink-muted">{whichWallet}</span>
          ) : null}
        </div>
      </div>

      {balance.isError ? (
        <p className="text-[13px] text-ink-muted">
          {COPY.wallet.balanceUnavailable}{" "}
          <button
            type="button"
            className="text-brand underline underline-offset-2"
            onClick={() => void balance.refetch()}
          >
            {COPY.wallet.refresh}
          </button>
        </p>
      ) : null}

      {auth.signers.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
            {COPY.wallet.pickerLabel}
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {auth.signers.map((s) => (
              <button
                key={s.address}
                type="button"
                role="radio"
                aria-checked={s.address === wallet}
                onClick={() => auth.setActiveWallet(s.address)}
                data-testid={`pick-${s.address}`}
                className={
                  "rounded-full border px-3 py-1.5 font-mono text-xs " +
                  (s.address === wallet
                    ? "border-brand bg-brand/10 text-ink"
                    : "border-line text-ink-muted hover:border-brand")
                }
              >
                {s.label} · {s.address.slice(0, 4)}…
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* Actions (candy revision 2026-09-13): ONE key — adding funds — and
          quiet pills for the rest. The order is the order a new player
          needs them: put SOL in, send SOL out, then the wallet choices. */}
      <div className="flex flex-wrap gap-2.5">
        {auth.addFunds ? (
          <Button
            disabled={funding}
            data-testid="wallet-add"
            onClick={async () => {
              setFunding(true);
              setFundingFailed(false);
              // D-14: an OUTCOME, not a swallowed throw (wallet/funding.ts).
              const outcome = await openFunding(auth.addFunds, wallet, {
                method: FUNDING_METHOD,
              });
              setFundingFailed(outcome !== "opened");
              setFunding(false);
            }}
          >
            {COPY.wallet.addSol}
          </Button>
        ) : null}
        <Button intent="cream" data-testid="wallet-send" onClick={() => setSendOpen(true)}>
          {COPY.wallet.send}
        </Button>
        {auth.exportWallet && active?.kind === "embedded" ? (
          <Button intent="cream" data-testid="wallet-export" onClick={() => setExportOpen(true)}>
            {COPY.wallet.exportTitle}
          </Button>
        ) : null}
        {auth.linkWallet ? (
          <Button intent="cream" data-testid="wallet-link" onClick={() => auth.linkWallet?.()}>
            {COPY.wallet.linkTitle}
          </Button>
        ) : null}
      </div>

      {fundingFailed ? (
        <p
          role="status"
          data-testid="wallet-add-failed"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] leading-5 text-ink-muted"
        >
          {COPY.wallet.addSolUnavailable}
        </p>
      ) : null}

      {FAUCET_ENABLED ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] leading-5 text-ink-muted">
          <a
            href={FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full text-brand underline underline-offset-2"
          >
            {COPY.wallet.faucet}
          </a>{" "}
          — {COPY.wallet.faucetNote}
        </p>
      ) : null}

      <Sheet open={sendOpen} onClose={() => setSendOpen(false)} title={COPY.wallet.sendTitle}>
        {sendOpen && active ? (
          <SendForm
            from={wallet}
            balanceLamports={balance.data ?? 0n}
            signer={active}
            onSent={() => {
              void queryClient.invalidateQueries({ queryKey: balanceQueryKey(wallet) });
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={exportOpen} onClose={() => setExportOpen(false)} title={COPY.wallet.exportTitle}>
        <p className="mb-4 text-[15px] leading-6 text-ink-muted">{COPY.wallet.exportExplain}</p>
        <Button
          data-testid="wallet-export-confirm"
          onClick={async () => {
            setExportOpen(false);
            try {
              await auth.exportWallet?.(wallet);
            } catch (error) {
              console.error("wallet: key export did not open:", error);
            }
          }}
        >
          {COPY.wallet.exportConfirm}
        </Button>
      </Sheet>
      </div>
    </NeonSection>
  );
}

type SendPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; signature: string }
  | { kind: "failed"; message: string };

function SendForm({
  from,
  balanceLamports,
  signer,
  onSent,
}: {
  from: string;
  balanceLamports: bigint;
  signer: NonNullable<ReturnType<typeof useAuth>["signers"][number]>;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<SendPhase>({ kind: "idle" });
  const rpc = useMemo(() => makeTxRpc(rpcUrl()), []);

  const lamports = solToLamports(amount);
  const check = checkSend(from, to, lamports, balanceLamports);
  const max = maxSendableLamports(balanceLamports);
  const problem =
    to.trim() === "" || amount.trim() === ""
      ? null
      : check.ok
        ? null
        : check.reason === "invalid-address" || check.reason === "self"
          ? COPY.wallet.sendInvalidAddress
          : check.reason === "zero"
            ? COPY.wallet.sendZero
            : COPY.wallet.sendTooMuch;

  if (phase.kind === "done") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[17px] font-medium text-ink">{COPY.wallet.sendDone}</p>
        <p className="text-[13px] text-ink-muted">
          {COPY.wallet.sendSignature}:{" "}
          <a
            href={explorerTxUrl(phase.signature)}
            target="_blank"
            rel="noreferrer"
            className="font-mono break-all text-brand underline underline-offset-2"
          >
            {phase.signature}
          </a>
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!check.ok || phase.kind === "sending") return;
        setPhase({ kind: "sending" });
        const result: TradeResult = await sendSol({
          rpc,
          signer,
          to: check.to,
          lamports: check.lamports,
        });
        if (result.outcome === "confirmed" && result.signature) {
          setPhase({ kind: "done", signature: result.signature });
          onSent();
        } else {
          setPhase({
            kind: "failed",
            message: result.failure?.message ?? COPY.wallet.balanceUnavailable,
          });
        }
      }}
    >
      <p className="text-[13px] leading-5 text-ink-muted">{COPY.wallet.sendNote}</p>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.wallet.sendTo}
        </span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          data-testid="send-to"
          className="h-12 rounded-lg border border-line bg-base px-3 font-mono text-[14px] text-ink outline-none focus:border-brand"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.wallet.sendAmount}
          <button
            type="button"
            className="text-brand"
            onClick={() => setAmount(lamportsToSol(max.toString()))}
          >
            {COPY.wallet.sendMax} · {formatSolShort(max)}
          </button>
        </span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          data-testid="send-amount"
          className="tnum h-12 rounded-lg border border-line bg-base px-3 font-mono text-[16px] text-ink outline-none focus:border-brand"
        />
      </label>

      {problem ? (
        <p role="status" className="text-[13px] text-ink-muted" data-testid="send-problem">
          {problem}
        </p>
      ) : null}
      {phase.kind === "failed" ? (
        <p role="status" className="rounded-lg border border-line px-3 py-2 text-[13px] text-ink">
          {phase.message}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={!check.ok || phase.kind === "sending"}
        data-testid="send-confirm"
      >
        {phase.kind === "sending" ? COPY.wallet.sendSending : COPY.wallet.sendConfirm}
      </Button>
    </form>
  );
}
