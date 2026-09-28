/**
 * The complaints route (2026-09-19) — the way a player contests anything.
 *
 * WHY IT EXISTS. Until this change there was nowhere for a player to
 * complain. Copy said "tell us", "you can ask us about your own entry" and
 * "we will give it to you on request", and each of those led nowhere at all.
 * The published appeal right could not be exercised either: it promised a
 * different reviewer would decide it and the founder-owned registry holds
 * one person. The named-reviewer apparatus comes out of the player-facing
 * product (Blotto Cup is the reviewer of record, a human still decides), and
 * this is what replaces it as the route to challenge a decision.
 *
 * It also has to exist before two things can be WRITTEN: the terms clause
 * that promises a challenge route, and the response windows the terms
 * publish. A published undertaking with no mechanism is the defect this
 * repository has been bitten by five times (`published-claims.test.ts`).
 *
 * WHAT IS HERE. Pure functions over one reference's rows, the same shape as
 * `appeals.ts`: the rules are unit-tested without a server, and a complaint's
 * status is DERIVED from an append-only thread rather than stored in a
 * mutable column — an operator updating a status appends a row, so the
 * history of a complaint cannot be quietly rewritten.
 *
 * SIGNATURE POLICY. A wallet signature is required for anything that asks us
 * to change an outcome (a decision, a payment), because it proves the
 * complainant controls the address the outcome belongs to. Every other
 * category may be submitted unsigned, so a player locked out of their wallet
 * can still reach us — which is precisely when they most need to. The form
 * states which is which, and a signed submission always carries more weight
 * than an unsigned one.
 *
 * WHAT THIS ROUTE IS NOT. It moves no lamports, decides nothing, and holds
 * no power over a pool. It is a record that a person asked, and the status of
 * our answer.
 */

import nacl from 'tweetnacl';
import { base58Decode } from '../../_shared/src/blotto-events';
import {
  COMPLAINT_REFERENCE_PATTERN,
  canonicalComplaintAnswerMessage,
  canonicalComplaintMessage,
} from './complaint-message';
import { REVIEW_SIGNATURE_WINDOW_MS, isCanonicalIsoInstant, type SubmissionRefusal } from './auth';
import { COMPLAINT_ACKNOWLEDGE_WORKING_DAYS, COMPLAINT_RESOLVE_DAYS } from './complaint-windows';

/**
 * The published response windows live in `complaint-windows.ts` (a module
 * with no imports, so the copy can quote them without this file's crypto);
 * re-exported here for the service and its tests.
 */
export { COMPLAINT_ACKNOWLEDGE_WORKING_DAYS, COMPLAINT_RESOLVE_DAYS };

/**
 * The five categories, and whether a wallet signature is required.
 *
 * `signatureRequired` is the whole of §2.2's rule, in one table, so the
 * form and the service cannot disagree about which is which.
 */
export const COMPLAINT_CATEGORIES = {
  /** A decision I want challenged — a flag, a forfeited prize, a refusal. */
  decision: { signatureRequired: true },
  /** A payment problem — a prize or a refund that did not arrive. */
  payment: { signatureRequired: true },
  /** A problem with the site. */
  site: { signatureRequired: false },
  /** Data protection — access, correction, objection, erasure. */
  data_protection: { signatureRequired: false },
  /** Something else. */
  other: { signatureRequired: false },
} as const;

export type ComplaintCategory = keyof typeof COMPLAINT_CATEGORIES;

export const COMPLAINT_CATEGORY_KEYS = Object.keys(COMPLAINT_CATEGORIES) as ComplaintCategory[];

/** True when this category may not be submitted without a wallet signature. */
export function signatureRequired(category: ComplaintCategory): boolean {
  return COMPLAINT_CATEGORIES[category].signatureRequired;
}

/** The player's own words: non-empty, bounded like the appeal grounds. */
export const COMPLAINT_TEXT_MAX = 4000;

/** What a player submits. `signature`/`signedAt` are absent when unsigned. */
export interface ComplaintSubmission {
  reference: string;
  category: ComplaintCategory;
  /** The complainant's address. Required when the category needs a signature. */
  wallet?: string | null;
  /** The pool it is about, base58, or null. */
  pool?: string | null;
  text: string;
  /** Canonical ISO instant the signature covers. */
  signedAt?: string | null;
  /** Base64 Ed25519 over `canonicalComplaintMessage`, by `wallet`. */
  signature?: string | null;
}

/** One row of a complaint's append-only thread. */
export interface ComplaintRow {
  reference: string;
  /** `lodged` is the player's; the rest are the operator's. */
  kind: 'lodged' | 'acknowledged' | 'resolved';
  wallet: string | null;
  category: ComplaintCategory;
  pool: string | null;
  /** The player's own words on `lodged`; the operator's note otherwise. */
  body: string;
  /**
   * The signature of whoever AUTHORED this row, base64 Ed25519 — the
   * player's on a signed `lodged`, the desk's registry key on an
   * `acknowledged` or `resolved`, and NULL only on an unsigned lodge.
   *
   * One column with one meaning, rather than a second for the operator's:
   * every row is signed by its own author, and the two canonical messages
   * are domain-separated (`complaint-message.ts`) so neither signature can
   * ever verify as the other. The player-facing `signed` flag reads the
   * LODGE row alone (`complaintStatus`), so a signed answer never makes an
   * unsigned complaint look signed.
   */
  signature: string | null;
  /** The instant that author's signature covers, verbatim. */
  signedAt: string | null;
  /**
   * Whose registry key answered — base58, and NULL on `lodged`, which is the
   * player's own row.
   *
   * This is what makes the terms' "answered by someone other than whoever
   * made the original one wherever that is possible" checkable rather than
   * merely asserted. The original decision carries its own `decidedBy` in
   * the review log, so comparing the two says whether the undertaking was
   * kept on any given complaint. Nothing ENFORCES the difference — that was
   * the predecessor rule, and a one-member registry made the right it
   * protected unexercisable (audit O24) — so the record is the mechanism.
   */
  decidedBy: string | null;
  /** When the service received it (service clock, ISO). */
  receivedAt: string;
}

/**
 * What a player is told when they ask after their complaint. Deliberately
 * NOT the whole row: the status, when it was received, and whether it was
 * signed. The body comes back too — it is their own words.
 */
export interface ComplaintStatus {
  reference: string;
  status: 'received' | 'acknowledged' | 'resolved';
  category: ComplaintCategory;
  receivedAt: string;
  /** True when the lodge carried a verified wallet signature. */
  signed: boolean;
  /** The player's own words, as lodged. */
  text: string;
  /** The operator's latest note, when there is one. */
  note: string | null;
  /** The windows the terms publish, so the page never types a figure. */
  acknowledgeWorkingDays: number;
  resolveDays: number;
}

export interface ComplaintStore {
  /** Append one row. Never updates, never deletes. */
  append(row: ComplaintRow): Promise<void>;
  /** Every row for one reference, oldest first. */
  listFor(reference: string): Promise<ComplaintRow[]>;
  /**
   * The desk's queue: the LODGE of every complaint that has not been
   * resolved, newest first.
   *
   * Only the lodge row, because that is the complaint; the thread is read
   * per reference when somebody opens one. A resolved complaint is not the
   * desk's problem, which is what `complaints_open` indexes on.
   */
  listOpen(limit: number): Promise<ComplaintRow[]>;
}

/** An in-memory store for tests and for a service with no database. */
export class MemoryComplaintStore implements ComplaintStore {
  private readonly rows: ComplaintRow[] = [];

  async append(row: ComplaintRow): Promise<void> {
    this.rows.push(row);
  }

  async listFor(reference: string): Promise<ComplaintRow[]> {
    return this.rows.filter((r) => r.reference === reference);
  }

  async listOpen(limit: number): Promise<ComplaintRow[]> {
    const resolved = new Set(this.rows.filter((r) => r.kind === 'resolved').map((r) => r.reference));
    return this.rows
      .filter((r) => r.kind === 'lodged' && !resolved.has(r.reference))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }
}

/** Derive the status a player is shown from the thread (any order). */
export function complaintStatus(thread: readonly ComplaintRow[]): ComplaintStatus | null {
  const lodged = thread.find((r) => r.kind === 'lodged');
  if (!lodged) return null;
  // The LATEST operator row decides the status; the thread is append-only,
  // so "latest" is the last one appended, and a resolved complaint that is
  // re-opened is a new row rather than an edit.
  const operatorRows = thread.filter((r) => r.kind !== 'lodged');
  const last = operatorRows.length > 0 ? operatorRows[operatorRows.length - 1] : null;
  return {
    reference: lodged.reference,
    status: last === null ? 'received' : last.kind === 'resolved' ? 'resolved' : 'acknowledged',
    category: lodged.category,
    receivedAt: lodged.receivedAt,
    signed: lodged.signature !== null,
    text: lodged.body,
    note: last?.body ?? null,
    acknowledgeWorkingDays: COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
    resolveDays: COMPLAINT_RESOLVE_DAYS,
  };
}

/**
 * Why a submission cannot be lodged as a matter of RULE, or null.
 *
 * `signature_required` is the one a player can act on: they chose a category
 * that needs a signature and sent none, and the form says so before they
 * type. `already_lodged` protects the reference: a client generates it, so a
 * collision — or a replayed submission — must not overwrite a record.
 */
export type ComplaintRefusal = 'malformed' | 'signature_required' | 'already_lodged';

export function complaintRuleRefusal(
  submission: ComplaintSubmission,
  existing: readonly ComplaintRow[]
): ComplaintRefusal | null {
  if (!COMPLAINT_REFERENCE_PATTERN.test(submission.reference)) return 'malformed';
  if (!COMPLAINT_CATEGORY_KEYS.includes(submission.category)) return 'malformed';
  const text = submission.text.trim();
  if (text.length === 0 || submission.text.length > COMPLAINT_TEXT_MAX) return 'malformed';
  if (existing.length > 0) return 'already_lodged';
  if (signatureRequired(submission.category)) {
    if (!submission.wallet || !submission.signature || !submission.signedAt) {
      return 'signature_required';
    }
  }
  return null;
}

/**
 * The signature and its freshness, when one was sent. Returns null when the
 * submission is unsigned AND unsigned is allowed for it — the caller has
 * already run `complaintRuleRefusal`, which is where a missing but required
 * signature is refused.
 *
 * The two causes are NAMED rather than collapsed, for the reason `appeals.ts`
 * gives at length: a device clock a few minutes out produces a genuine
 * signature that fails freshness, and answering "the signature did not
 * verify" sends the complainant to look for a problem that is not there.
 * Nothing leaks by saying which — the submitter signs with their own key
 * over a message naming their own wallet.
 */
export function complaintSignatureRefusal(
  submission: ComplaintSubmission,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): SubmissionRefusal | null {
  if (!submission.signature || !submission.signedAt || !submission.wallet) return null;
  try {
    if (!isCanonicalIsoInstant(submission.signedAt)) return 'bad_timestamp';
    const at = Date.parse(submission.signedAt);
    if (Math.abs(nowMs - at) > windowMs) return 'clock_skew';
    const signature = Uint8Array.from(Buffer.from(submission.signature, 'base64'));
    if (signature.length !== 64) return 'bad_signature';
    return nacl.sign.detached.verify(
      canonicalComplaintMessage({
        reference: submission.reference,
        wallet: submission.wallet,
        category: submission.category,
        pool: submission.pool ?? null,
        text: submission.text,
        signedAt: submission.signedAt,
      }),
      signature,
      base58Decode(submission.wallet)
    )
      ? null
      : 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}

/**
 * An operator's answer to a complaint, as it arrives on the wire.
 *
 * `decidedBy` is not a claim the caller makes about themselves — it is the
 * key the signature must verify against, and it must be in the founder-owned
 * registry. That is what turns the stored `decided_by` into evidence.
 */
export interface ComplaintAnswerSubmission {
  reference: string;
  kind: 'acknowledged' | 'resolved';
  /** The registry key answering — base58. */
  decidedBy: string;
  /** What the player is told. Inside the signed bytes. */
  note: string;
  /** Canonical ISO instant, inside the signed bytes. */
  decidedAt: string;
  /** base64 Ed25519 over `canonicalComplaintAnswerMessage`. */
  signature: string;
}

/** The longest answer the desk can record. Generous; a bound, not a style. */
export const COMPLAINT_NOTE_MAX = 2000;

/**
 * How many open complaints the queue serves at once.
 *
 * Bounded because the queue route returns players' own words: an unbounded
 * `limit` would let one authorised request return the entire table in a
 * single response, which is a worse thing to leak, to log, or to leave in a
 * proxy cache than a page of it.
 */
export const COMPLAINT_QUEUE_DEFAULT = 50;
export const COMPLAINT_QUEUE_MAX = 200;

/**
 * May this answer be recorded?
 *
 * Mirrors `auth.ts::reviewSubmissionRefusal` limb for limb, deliberately: an
 * operator write to the complaints record is the same KIND of act as one to
 * the decision log, and two slightly different auth rules over two
 * append-only operator tables is the drift that produces a hole in one of
 * them. Registry membership, a canonical instant, freshness, then the
 * signature over the shared canonical bytes.
 *
 * The CALLER is told one undifferentiated `unauthorized`; the reason is
 * named in the log, which the caller cannot reach (B-35). Otherwise the
 * route is a membership oracle for the founder-owned registry.
 *
 * PHASE-N-REVIEW (2026-09-22): NO PER-KEY BUDGET here, unlike `/decisions`,
 * and the asymmetry is deliberate rather than overlooked. A decision moves a
 * share; an answer records a sentence against a reference that must already
 * exist, and a duplicate signature is refused as a replay. Adding a budget
 * means a `countBy` on this store, and I would rather this route stay small
 * enough to read than gain a counter nothing has yet needed. What would
 * change it: a second desk key, or any sign of a flood. It is recorded in
 * the change report rather than left in a diff.
 */
export function complaintAnswerRefusal(
  registry: { members: readonly string[] },
  answer: ComplaintAnswerSubmission,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): SubmissionRefusal | null {
  try {
    if (!registry.members.includes(answer.decidedBy)) return 'not_member';
    if (!isCanonicalIsoInstant(answer.decidedAt)) return 'bad_timestamp';
    const at = Date.parse(answer.decidedAt);
    if (Math.abs(nowMs - at) > windowMs) return 'clock_skew';
    const signature = Uint8Array.from(Buffer.from(answer.signature, 'base64'));
    if (signature.length !== 64) return 'bad_signature';
    return nacl.sign.detached.verify(
      canonicalComplaintAnswerMessage({
        reference: answer.reference,
        kind: answer.kind,
        decidedBy: answer.decidedBy,
        note: answer.note,
        signedAt: answer.decidedAt,
      }),
      signature,
      base58Decode(answer.decidedBy)
    )
      ? null
      : 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}

/**
 * Has this exact answer already been recorded?
 *
 * The same guard the decision log has (B-23), and honest for the accidental
 * case too: an operator whose response was lost and who retries is told the
 * answer is on the record, which is the truth and what they needed.
 */
export function isAnswerReplay(
  thread: readonly ComplaintRow[],
  signature: string
): boolean {
  // Scoped to the operator's rows. The two canonical messages are
  // domain-separated, so a player's lodge signature could never verify as an
  // answer in the first place — but a replay check that can only ever look
  // at answers cannot be confused by one.
  return thread.some((r) => r.kind !== 'lodged' && r.signature === signature);
}

/** The submission as the row it becomes. */
export function lodgedRow(submission: ComplaintSubmission, receivedAt: string): ComplaintRow {
  const signed = Boolean(submission.signature && submission.signedAt && submission.wallet);
  return {
    reference: submission.reference,
    kind: 'lodged',
    // An UNSIGNED submission's wallet is not recorded. It is unproven, it is
    // personal data we would be holding for nothing, and the data-minimisation
    // ruling of 2026-09-15 is that we hold what a mechanism needs and no more.
    // A player who wants their address on the record signs.
    wallet: signed ? (submission.wallet as string) : null,
    category: submission.category,
    pool: submission.pool ?? null,
    body: submission.text,
    signature: signed ? (submission.signature as string) : null,
    signedAt: signed ? (submission.signedAt as string) : null,
    // The player's own row. Nobody has answered it yet, by definition.
    decidedBy: null,
    receivedAt,
  };
}

/**
 * The operator's row: an acknowledgement or an answer, appended rather than
 * written over the lodge.
 *
 * `decidedBy` is required here and not optional. The terms undertake that a
 * challenge is answered by someone other than whoever made the original
 * decision wherever that is possible, and the only thing that can make that
 * checkable is a record of who answered — the original decider is already in
 * the review log. A signature is required to write one of these rows in the
 * first place, so the key is in hand at the moment the row is built; making
 * it optional would let the one field the undertaking rests on go missing by
 * omission.
 */
export function answeredRow(
  reference: string,
  kind: 'acknowledged' | 'resolved',
  answer: {
    decidedBy: string;
    note: string;
    category: ComplaintCategory;
    pool?: string | null;
    /** The desk's signature over the canonical answer message, when signed. */
    signature?: string | null;
    /** The instant that signature covers, verbatim. */
    signedAt?: string | null;
  },
  receivedAt: string
): ComplaintRow {
  return {
    reference,
    kind,
    // An operator's row carries no player address: the lodge already holds
    // whatever address the complaint proved, and repeating it here would
    // hold the same personal data twice for nothing.
    wallet: null,
    category: answer.category,
    pool: answer.pool ?? null,
    body: answer.note,
    signature: answer.signature ?? null,
    signedAt: answer.signedAt ?? null,
    decidedBy: answer.decidedBy,
    receivedAt,
  };
}

/**
 * May this (wallet, reference) pair read this thread?
 *
 * The reference is the player's handle on their own complaint, and the
 * status route must not become a way to read other people's. A thread whose
 * lodge carries a wallet is served only to that wallet. An unsigned lodge
 * recorded no wallet, so there is nobody to restrict it to: the reference
 * alone is the handle, and whoever holds it is whoever was given it. Every
 * refusal is the SAME 404 — "wrong wallet" would confirm the reference
 * exists.
 *
 * PHASE-N-REVIEW (2026-09-19): this used to require a reader of an unsigned
 * complaint to supply NO wallet. That guarded nothing — the identical
 * request without the `wallet` parameter already read the row — and it broke
 * the one reader who most needs the route: a player who complained while
 * locked out of their wallet, got back in, and came back to /complaints to
 * see where it had got to. The form sends the signed-in wallet with every
 * lookup (`app/src/complaints/complaint-client.tsx`), so that player was
 * told their own complaint did not exist. The published wording was always
 * the rule below — `COPY.complaints.referenceKeep` says the signer reads a
 * SIGNED complaint, and says nothing narrower about an unsigned one. Found
 * by the end-to-end walk of the form, not by a unit test: the test asserted
 * the code as written.
 */
export function mayReadComplaint(
  thread: readonly ComplaintRow[],
  wallet: string | null
): boolean {
  const lodged = thread.find((r) => r.kind === 'lodged');
  if (!lodged) return false;
  if (lodged.wallet === null) return true;
  return wallet === lodged.wallet;
}
