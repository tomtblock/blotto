/*
 * The operator identity the terms of service and the privacy notice name
 * (2026-09-19), from the founder-owned `config/operator.json`.
 *
 * NO COMPANY EXISTS YET, so every value ships `null` and both pages render
 * an explicit "not yet set" — never a placeholder that reads as real, and
 * never a guess. This follows `app/src/app/custody/custody.config.ts`
 * exactly, and for its stated reason: a page that invents a value would be
 * worse than none. A terms document naming an operator that does not exist
 * would be worse still, because a player would be agreeing with nobody.
 *
 * The gap is deliberately visible, and `scripts/check-operator-identity.ts`
 * keeps it that way: the schema is required on every cluster, and a MAINNET
 * deploy is refused while any value is null. Filling the file in is a
 * one-file founder action once the operating entity exists.
 */

import operatorConfig from '@config/operator.json';
import { COPY } from '@/copy';

/** A value the documents render, or null → "not yet set". */
export interface OperatorValue {
  value: string | null;
}

export interface OperatorIdentity {
  /** The entity a player's agreement is with. */
  legalName: OperatorValue;
  /** Its registered company identifier. */
  companyNumber: OperatorValue;
  /** Its registered address. */
  registeredAddress: OperatorValue;
  /** Where a formal notice under the terms is sent. */
  noticeAddress: OperatorValue;
  /** The law the terms are governed by. */
  governingLaw: OperatorValue;
  /** The courts that have jurisdiction. */
  jurisdiction: OperatorValue;
  /** The authority a data-protection complaint may go to. */
  supervisoryAuthority: OperatorValue;
  /** The founder's last-edited date. */
  updated: string;
  /** True while ANY value is unset — both documents say so at the top. */
  anyUnset: boolean;
}

const val = (v: string | null | undefined): OperatorValue => ({
  value: v === null || v === undefined || v.trim() === '' ? null : v,
});

export function operatorIdentity(): OperatorIdentity {
  // The JSON's `version` is a number and every other field a nullable
  // string, so the document is read field by field rather than through one
  // index signature — which TypeScript rightly refuses.
  const c: Record<string, unknown> = operatorConfig;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const fields = {
    legalName: val(str(c.legalName)),
    companyNumber: val(str(c.companyNumber)),
    registeredAddress: val(str(c.registeredAddress)),
    noticeAddress: val(str(c.noticeAddress)),
    governingLaw: val(str(c.governingLaw)),
    jurisdiction: val(str(c.jurisdiction)),
    supervisoryAuthority: val(str(c.supervisoryAuthority)),
  };
  return {
    ...fields,
    updated: str(c.updated) ?? '',
    anyUnset: Object.values(fields).some((f) => f.value === null),
  };
}

/** What a page prints for a value: the value, or the explicit not-yet-set. */
export function operatorText(v: OperatorValue): string {
  return v.value ?? COPY.operator.notYetSet;
}
