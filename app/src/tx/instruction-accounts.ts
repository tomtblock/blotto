/*
 * Instruction account helpers.
 *
 * Carried from the predecessor repository's instruction-builder module, which was
 * otherwise entirely the old product's instruction encoders and was not carried.
 * This one function is transport-level and product-neutral, so it lives on its own
 * rather than inside a builder file that does not exist yet.
 *
 * `execute.ts` uses it to name the writable accounts a transaction touches, which
 * is what the priority-fee estimate is scoped to — a fee estimate over the whole
 * chain is meaningless, one over the accounts actually contended for is not.
 */

import { AccountRole, address, type Address, type Instruction } from "@solana/kit";

/** Every account an instruction writes to, as addresses. */
export function writableAccounts(instruction: Instruction): Address[] {
  return (instruction.accounts ?? [])
    .filter(
      (a) =>
        a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
    )
    .map((a) => address(a.address));
}
