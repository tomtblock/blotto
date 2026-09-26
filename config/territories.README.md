# `territories.json` — what is blocked, and why each row is there

**Set by the operator.** The lists in `territories.json` change only on an operator decision, and
every change lands in its own commit saying so. This file is the legend: one row per code, the line
of the original territory schedule it implements, and whether it is confirmed or still waiting on
something. Decision IDs (`D-B3-3` …) resolve in `docs/architecture/DECISIONS.md`.

**The schema and the fail-closed rules are not restated here.** They live in
`backend/packet/src/territories.ts`, which is the only parser, and `scripts/check-territories.ts`
enforces that this file and the JSON agree.

---

## Posture

`block-list` since 2026-08-28 (D-B3): the service is available everywhere **except**
the codes in `blocked`. `allowed` must be empty under this posture and the parser refuses a
schedule where it is not.

An unresolvable location is refused, in every posture. That is not in the lists — it is the
behaviour of `territoryAllowed`, which returns false for a missing or malformed country, and of the
four layers above it.

---

## Live — schedule version 5 (2026-09-22)

Eighteen country codes: the fourteen rows of the original schedule marked confirmed (version 3,
2026-09-12); the United States at country level (version 4, decided 2026-09-21 — D-B3-3, and see
the note under the table); and Spain, France and Italy (version 5, decided 2026-09-18 and landed
2026-09-22 — D-B3-4).

| Code | Territory | Original schedule line | Status |
|---|---|---|---|
| `IN` | India | "Blocked: India" | Confirmed |
| `BE` | Belgium | "Blocked: … Belgium" | Confirmed |
| `AU` | Australia | "Australia (caution — blocked until a specific opinion)" | Confirmed |
| `AE` | United Arab Emirates | "UAE/GCC" | Confirmed |
| `SA` | Saudi Arabia | "UAE/GCC" | Confirmed |
| `QA` | Qatar | "UAE/GCC" | Confirmed |
| `KW` | Kuwait | "UAE/GCC" | Confirmed |
| `BH` | Bahrain | "UAE/GCC" | Confirmed |
| `OM` | Oman | "UAE/GCC" | Confirmed |
| `CN` | China | "China" | Confirmed |
| `HK` | Hong Kong | "Hong Kong" | Confirmed |
| `SG` | Singapore | "Singapore" | Confirmed |
| `MY` | Malaysia | "Malaysia" | Confirmed |
| `ID` | Indonesia | "Indonesia" | Confirmed |
| `US` | United States | the original schedule names twelve **states**, not the country | Confirmed as a **country-level** block, 2026-09-21 (D-B3-3) |
| `ES` | Spain | listed as "open subject to legal confirmation"; superseded 2026-09-18 (D-B3-4) | Blocked pending a written legal opinion. Reopens only on that written confirmation |
| `FR` | France | listed as "open subject to legal confirmation"; superseded 2026-09-18 (D-B3-4) | As `ES` |
| `IT` | Italy | listed as "open subject to legal confirmation"; superseded 2026-09-18 (D-B3-4) | As `ES` |

**The US row is wider than the original schedule, deliberately.** That schedule blocks twelve
states. Blocking those twelve is not possible today — see *The US states* below — and the choice
was between a schedule that names them and silently admits every one, and a country-level block
that is enforceable now. The second was taken on 2026-09-21 (D-B3-3). It is the stricter of the
two and can be narrowed to the twelve once a region-capable source is in place; nothing about it
is irreversible.

"GCC" is the Gulf Cooperation Council, whose membership is those six states.

---

## Held — not in the schedule, and why

### The US states — held on a technical constraint, not on the decision

The original schedule blocks **Washington State** (confirmed) and eleven more marked *(verify)*: `US-AZ`, `US-AR`,
`US-CT`, `US-DE`, `US-LA`, `US-MD`, `US-MT`, `US-SC`, `US-SD`, `US-TN`, `US-VT`.

These are sub-national rules. The schema accepts them — `COUNTRY_OR_REGION` allows `CC-SSS` — but
**the geo vendor of record cannot resolve a region**: IPLocate returns a subdivision *name*
("Washington"), never an ISO 3166-2 code, and reports `resolvesRegion = false`.

The entry service therefore **refuses to start** with any of these in the schedule
(`assertRegionCapability`, `backend/packet/src/service.ts`). That is deliberate, and it is the right
behaviour: a rule that cannot be applied must not look like one that is. The alternative is a
schedule that names twelve states and admits every one of them silently.

**Since 2026-09-21 this holds nothing open.** `US` is blocked at country level, so every one of
the twelve is refused along with the other thirty-eight states. What is still held is the
*narrowing*: replacing the country block with the twelve states, so the rest of the US can be
served. That is what the two items below buy, and until they are bought the country block stands.

Two things must happen before these can be added:

1. **A region-capable geo source** in the composite failover chain (`geo-composite.ts`) — a new
   adapter reporting `resolvesRegion = true`. An operator decision: it is a vendor choice.
2. **Confirmation of the eleven** marked *(verify)*. `US-WA` is already confirmed and is held only
   by (1).

`scripts/check-territories.ts` fails the build if a sub-national code is added while no configured
source can resolve a region, so this cannot be got wrong quietly.

### The sanctions set — held pending legal review

The original schedule says "sanctioned" without enumerating. A proposed set — `IR`, `KP`, `SY`,
`CU`, `RU`, `BY`, `VE`, plus `UA-43` / `UA-14` / `UA-09` for Crimea, Donetsk and Luhansk — was
marked **"do not merge with a guessed list"**, and on 2026-09-13 the operator decided to hold it.

**Holding it opens nothing.** Sanctions are screened on every entry by a separate path —
`backend/sanctions/`, checking the wallet against OFAC SDN, Chainalysis and OpenSanctions — which
runs whatever this file says and refuses on a hit. That path checks live lists and named
individuals, which a country code cannot do. When legal review settles the set, these rows become
a belt-and-braces duplicate of it rather than the only control.

The three Ukrainian oblast codes are sub-national and are additionally held by the geo constraint
above.

### Not blocked, and deliberately so

Territories the original schedule marked "open subject to legal confirmation" are **not** a
block list, and nothing from that list belongs in this file unless a decision moves it into the
Live table.

Two parts of that list have since moved and are no longer open:

- **Spain, France and Italy** are in the Live table (D-B3-4), for the reason on their rows.
- **The remaining ~39 US states** were on it. They are now refused too, along with the twelve
  named states, because `US` is blocked at country level (D-B3-3).

---

## Changing this file

1. Record the operator decision in writing, with the codes.
2. Edit `territories.json` — codes alphabetised, `version` incremented, `updated` set to the date of
   the instruction. Strict JSON: the parser allows no comments.
3. Add a row to the table above. `scripts/check-territories.ts` fails if a code is in one and not the
   other, in either direction.
4. Confirm a display name exists in `app/src/rules/territoryNames.ts` — the same check enforces it,
   so that no player is ever told they are blocked by a page reading `SG`.
5. Commit on its own, titled `territories <date>: …`.

Bumping `version` is visible to players: the rules page publishes it beside the list.
