# `territories.json` — what is blocked, and why each row is there

**Founder-owned.** The lists in `territories.json` are changed only on a founder instruction, and
every change lands in its own commit saying so. This file is the legend: one row per code, the PID
§9 line it implements, and whether it is confirmed or still waiting on something.

**The schema and the fail-closed rules are not restated here.** They live in
`backend/packet/src/territories.ts`, which is the only parser, and `scripts/check-territories.ts`
enforces that this file and the JSON agree.

---

## Posture

`block-list` since 2026-08-28 (founder instruction): the service is available everywhere **except**
the codes in `blocked`. `allowed` must be empty under this posture and the parser refuses a
schedule where it is not.

An unresolvable location is refused, in every posture. That is not in the lists — it is the
behaviour of `territoryAllowed`, which returns false for a missing or malformed country, and of the
four layers above it.

---

## Live — schedule version 5 (2026-09-22)

Eighteen country codes: the fourteen rows of PID §9 marked confirmed (version 3, founder
instruction 2026-09-12); the United States at country level (version 4, founder instruction
2026-09-21 — see the note under the table); and Spain, France and Italy (version 5, founder
instruction **2026-09-18**, landed 2026-09-22 — see D-B3-4 in the register for why the date of the
instruction is earlier than the version that carries it).

| Code | Territory | PID §9 line | Status |
|---|---|---|---|
| `IN` | India | "Blocked: India" | Confirmed |
| `BE` | Belgium | "Blocked: … Belgium"; §8.3 "any chance element" | Confirmed |
| `AU` | Australia | "Australia (caution — blocked until a specific opinion)"; §11 D7 | Confirmed |
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
| `US` | United States | §9 names twelve **states**, not the country; §11 D9 | Confirmed as a **country-level** block, founder instruction 2026-09-21 |
| `ES` | Spain | §9 lists Spain as "open subject to counsel confirmation"; superseded by founder instruction 2026-09-18 | Blocked pending a written opinion. Counsel brief Part 6.3: on a lay reading, paid competitions of skill with cash prizes need a state authorisation there whatever the answer on chance. Reopens only on counsel's written confirmation |
| `FR` | France | §9 lists France as "open subject to counsel confirmation"; superseded by founder instruction 2026-09-18 | As `ES` |
| `IT` | Italy | §9 lists Italy as "open subject to counsel confirmation"; superseded by founder instruction 2026-09-18 | As `ES` |

**The US row is wider than PID §9 asks for, deliberately.** §9 blocks twelve states. Blocking
those twelve is not possible today — see *The US states* below — and the choice was between a
schedule that names them and silently admits every one, and a country-level block that is
enforceable now. The founder took the second on 2026-09-21 (register row D-B3-3). It is the
stricter of the two and can be narrowed to the twelve the day a region-capable source is
contracted; nothing about it is irreversible.

"GCC" is the Gulf Cooperation Council, whose membership is those six states.

---

## Held — not in the schedule, and why

### The US states — held on a technical constraint, not on the decision

PID §9 blocks **Washington State** (confirmed) and eleven more marked *(verify)*: `US-AZ`, `US-AR`,
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
   adapter reporting `resolvesRegion = true`. Founder-owned: it is a vendor choice and a cost.
2. **Sign-off on the eleven** marked *(verify)*. `US-WA` is already confirmed in §9 and is held only
   by (1).

`scripts/check-territories.ts` fails the build if a sub-national code is added while no configured
source can resolve a region, so this cannot be got wrong quietly.

### The sanctions set — held pending counsel

PID §9 says "sanctioned" without enumerating. The master prompt of 2026-09-12 proposed `IR`, `KP`,
`SY`, `CU`, `RU`, `BY`, `VE`, plus `UA-43` / `UA-14` / `UA-09` for Crimea, Donetsk and Luhansk, and
marked the row **"do not merge with a guessed list"**. Founder ruling 2026-09-13: hold it.

**Holding it opens nothing.** Sanctions are screened on every entry by a separate path —
`backend/sanctions/`, checking the wallet against OFAC SDN, Chainalysis and OpenSanctions — which
runs whatever this file says and refuses on a hit. That path checks live lists and named
individuals, which a country code cannot do. When counsel settles the set, these rows become a
belt-and-braces duplicate of it rather than the only control.

The three Ukrainian oblast codes are sub-national and are additionally held by the geo constraint
above.

### Not blocked, and deliberately so

PID §9's "open subject to counsel confirmation" list — the UK, Germany, the Nordics, Ireland, the
Netherlands, Canada ex-Ontario, Brazil, Mexico, Colombia, Chile, Japan, South Korea — is **not** a
block list and nothing from it belongs in this file.

Two parts of that list have since moved and are no longer open:

- **Spain, France and Italy** are in the Live table by founder instruction 2026-09-18, for the
  reason on their rows. The rest of the list stays open until counsel says otherwise.
- **The remaining ~39 US states** were on it. They are now refused too, along with the twelve §9
  names, because `US` is blocked at country level (2026-09-21). They are not open, and this list no
  longer implies they are.

---

## Changing this file

1. Get the founder instruction in writing, with the codes.
2. Edit `territories.json` — codes alphabetised, `version` incremented, `updated` set to the date of
   the instruction. Strict JSON: the parser allows no comments.
3. Add a row to the table above. `scripts/check-territories.ts` fails if a code is in one and not the
   other, in either direction.
4. Confirm a display name exists in `app/src/rules/territoryNames.ts` — the same check enforces it,
   so that no player is ever told they are blocked by a page reading `SG`.
5. Commit on its own, titled `founder-instruction <date>: …`.

Bumping `version` is visible to players: the rules page publishes it beside the list.
