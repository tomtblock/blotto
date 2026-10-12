# Third-party notices

This repository is Apache-2.0 (see [`LICENSE`](LICENSE)). One dependency of the on-chain program
carries a licence of its own that asks for its text to travel with the work, and it is reproduced
here.

## Metaplex Core (`mpl-core` 0.12.0)

- **What it is:** the Metaplex Core client crate. The program
  (`programs/blotto_cup`) links its CPI builders to create each pool's pass collection and to mint
  the passes (`programs/blotto_cup/src/pass.rs`), and the deployed program calls the Metaplex Core
  program on chain.
- **Its licence:** the *Metaplex(TM) NFT Open Source License, Version 1.0 (Oct. 2022)* — not
  Apache-2.0, although it describes itself as "Apache-style". The full text is in
  [`third-party/mpl-core/LICENSE`](third-party/mpl-core/LICENSE), copied byte for byte from the
  published crate (SHA-256 `18f025513b3ad665d57ab359e11ab593f240ecd46b59eb5092ef03418f1bf0f7`).
- **Why it is here:** that licence treats a work that links to it as a derivative work and making
  one available on a blockchain as distribution, and on distribution asks that recipients receive a
  copy of the licence and that its notices are kept (§4(a)). This file and the copy beside it are
  how this repository does that. Whether anything more is needed is a question for counsel
  ([`docs/counsel-brief/COUNSEL-BRIEF_Blotto-Cup_v1.md`](docs/counsel-brief/COUNSEL-BRIEF_Blotto-Cup_v1.md),
  Part 11).

Every other crate and package in the dependency trees was checked on 2026-10-11 and is under a
permissive licence (Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, Unicode-3.0); none is GPL, AGPL
or MPL. See [`docs/security/SCANNER-TRIAGE-2026-10-11.md`](docs/security/SCANNER-TRIAGE-2026-10-11.md),
item F.
