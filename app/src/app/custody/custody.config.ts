/*
 * The custody disclosure page's single data source (C13, D-C). Every value
 * a reader sees comes from the founder-owned `config/custody.json` or from
 * this file's ARCHITECTURE facts (what each key can and cannot do — fixed
 * by the program, not by configuration). An unset config value renders as
 * an explicit "not yet set" — never a placeholder number, never a guess:
 * a custody page that invents a threshold would be worse than none.
 */

import custodyConfig from '@config/custody.json';
import { COPY } from '@/copy';

export interface CustodyValue {
  /** The value to display, or null → the page renders "not yet set". */
  value: string | null;
}

export interface KeyInventoryRow {
  name: string;
  /** Who holds it (from config; null = not yet provisioned). */
  holder: string | null;
  /** What the key CAN do — program/architecture facts. */
  can: string;
  /** What the key CANNOT do — the load-bearing limits. */
  cannot: string;
}

export interface CustodyView {
  programId: CustodyValue;
  upgradeAuthority: CustodyValue;
  threshold: CustodyValue;
  timelock: CustodyValue;
  keys: KeyInventoryRow[];
  updated: string;
}

const val = (v: string | number | null | undefined): CustodyValue => ({
  value: v === null || v === undefined ? null : String(v),
});

export function custodyView(): CustodyView {
  const c = custodyConfig;
  const k = COPY.custody.keys;
  const threshold =
    c.multisig.threshold !== null && c.multisig.memberCount !== null
      ? `${c.multisig.threshold} of ${c.multisig.memberCount}`
      : null;
  const timelock =
    c.multisig.timelockHours !== null ? `${c.multisig.timelockHours} hours` : null;
  return {
    programId: val(c.programId),
    upgradeAuthority: val(c.upgradeAuthority),
    threshold: val(threshold),
    timelock: val(timelock),
    keys: [
      { name: k.admin.name, holder: c.keys.admin, can: k.admin.can, cannot: k.admin.cannot },
      {
        name: k.entrySigner.name,
        holder: c.keys.entrySigner,
        can: k.entrySigner.can,
        cannot: k.entrySigner.cannot,
      },
      {
        name: k.settlementSigner.name,
        holder: c.keys.settlementSigner,
        can: k.settlementSigner.can,
        cannot: k.settlementSigner.cannot,
      },
      {
        name: k.poolSealing.name,
        // Per-pool keys: the holder is architecture (custody service), not
        // a config wallet — but until custody is provisioned it too is unset.
        holder: c.keys.settlementSigner === null ? null : k.poolSealing.holderWhenProvisioned,
        can: k.poolSealing.can,
        cannot: k.poolSealing.cannot,
      },
      {
        name: k.platformWallet.name,
        // D-A1 revised: the treasury is a program-held PDA — no private key
        // exists for it anywhere. The row's holder is architecture, not a
        // configured wallet.
        holder: k.platformWallet.holderNote,
        can: k.platformWallet.can,
        cannot: k.platformWallet.cannot,
      },
      {
        name: k.irysUpload.name,
        holder: c.keys.irysUploadWallet,
        can: k.irysUpload.can,
        cannot: k.irysUpload.cannot,
      },
      {
        name: k.reviewers.name,
        // The reviewer set lives in its own founder-owned file.
        holder: k.reviewers.holderNote,
        can: k.reviewers.can,
        cannot: k.reviewers.cannot,
      },
    ],
    updated: c.updated,
  };
}
