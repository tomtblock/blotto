# 2026-09-14 — the "Not available here" block on www, and the welcome note's signature

**Produced:** 2026-09-14, after the founder reported being refused at `www.blotto.gg` from Argentina
and again from Ireland over a VPN.
**Two subjects, one change set:** an operational defect that needs a founder action (§1–§4, no code
change fixes it) and a copy instruction that is implemented here (§5).

---

## 1. The headline: it was never about the country

**Every visitor to `www.blotto.gg` is refused, everywhere in the world.** Argentina and Ireland are
not on the block list, and neither is any country the founder was refused from. The territory check
never ran at all — the browser could not reach the entry service, and the client fails closed.

The entry service itself is healthy and answers correctly. Read from this container at 02:5x UTC:

```
GET https://blotto-packet.fly.dev/health  → {"ok":true,"service":"packet",...}
GET https://blotto-packet.fly.dev/geo     → {"allowed":true}
```

## 2. The cause: `www.blotto.gg` is not in `BLOTTO_APP_ORIGINS`

The services answer a browser only for origins named in that variable. Asked with each origin in
turn, the live packet service says:

| `Origin:` sent | `Access-Control-Allow-Origin` returned |
|---|---|
| `https://blotto.gg` | `https://blotto.gg` — allowed |
| `https://blotto-jade.vercel.app` | `https://blotto-jade.vercel.app` — allowed |
| **`https://www.blotto.gg`** | **absent — refused** |

The same is true of the indexer (`blotto-indexer.fly.dev`), which reads from the same variable.

And `www` is the origin that matters: the apex redirects to it. `https://blotto.gg/rules` ends at
`https://www.blotto.gg/gate?next=%2Frules`. So every browser on the live site sends the one origin
neither service will answer.

What the browser then does is not an error the page can read: a cross-origin response without that
header is discarded by the browser and `fetch` rejects. `entry/geo-gate.ts` catches, and — by
design (D-B3) — answers `blocked`. `play-client.tsx` renders the territory panel.

This is a config drift, not a code defect. `docs/go-live-devnet.md` §5 already says the variable
takes "your domain, **its www form** and the Vercel address", and its §8 troubleshooting table
already carries the row: *"not available in your region" for everyone → domain missing from
`BLOTTO_APP_ORIGINS`*. The www form was never added.

## 3. The fix — founder action, about three minutes

Nothing in this repository can set it: it is a GitHub **repository Variable**, and the deploy
workflow is what pushes it to both Fly apps.

1. GitHub → the repository → **Settings → Secrets and variables → Actions → Variables** tab.
2. Edit **`BLOTTO_APP_ORIGINS`**. Add the www form, comma-separated, no trailing slash. It should
   read (keeping whatever is already there):

   ```
   https://blotto.gg,https://www.blotto.gg,https://blotto-jade.vercel.app
   ```

3. GitHub → **Actions → deploy-backend → Run workflow**, on `main`. It refuses any other branch.
4. Check it took, from anywhere:

   ```
   curl -sS -D- -o /dev/null -H "Origin: https://www.blotto.gg" https://blotto-packet.fly.dev/geo
   ```

   The answer must include `access-control-allow-origin: https://www.blotto.gg`. Then reload the
   site; the panel should be gone.

**The alternative fix, if the founder prefers it:** point the Vercel domain the other way, so `www`
redirects to the apex instead. Then the browser's origin is `https://blotto.gg`, which is already
allowed, and no variable changes. One or the other — not both halves of neither.

## 4. What else was broken by the same cause, and what was not

Server-rendered pages fetch from the Next.js server, where no browser origin check applies, so they
were unaffected and the site looked healthy. Everything the BROWSER asks a backend for was refused:

| Surface | Call | State before the fix |
|---|---|---|
| Play | `GET /geo` on the packet service | refused → "Not available here" for everyone |
| Entry itself | `POST /packet` | would have been refused the same way |
| Notifications bell, profile, verify, admin treasury | the indexer, from the browser | refused |
| Home, pools, pool pages | the indexer, from the Next server | fine — which is why the site looked normal |

Sign-in was unaffected (Privy has its own domain list, and `www` is evidently in it — the founder
was signed in while being refused).

## 5. Why it read as a territory block, and why that copy is not changed here

The panel names the fourteen blocked territories and says "Access is blocked by location" for BOTH
refusals a visitor can hit: a real block, and a check that could not be completed. That is not an
oversight — it is founder instruction 2026-09-12 §3.3.1, recorded at `copy/index.ts`
(`gate.territoryBlocked`): do not tell a visitor their location could not be determined, because
that narrates the mechanism rather than stating the rule.

**The consequence, stated plainly: when the check fails, the site tells a visitor in an allowed
country that their country is blocked.** Tonight that cost several hours. Distinguishing the two
would mean a third state — "we could not complete the check" — that still refuses entry and still
opens no door; the pay path renders only on an explicit `{ allowed: true }`.

**Not done here, because §3.3.1 is a founder instruction on a compliance-facing control and this
architect does not overturn one at 3am.** It is a founder call, and it is a small change if wanted.

## 6. The welcome note is from the team (founder instruction 2026-09-14)

*"Remove any mention of the name Tom as the founder. Just say 'we are the blotto team' or
something."* Done — no individual is named anywhere in the note or in the code that renders it.

| Was | Is |
|---|---|
| `founderName: 'Tom'`, `founderRole: 'Founder'` | `teamName: 'The Blotto Cup team'` — one field; the role line is gone rather than re-pointed, since there is no person to put a role beside |
| Signature *Tom · Founder · Just now* | *The Blotto Cup team · Just now* |
| *"I'm Tom, the founder. Thank you for joining — I mean that."* | *"We're the Blotto Cup team. Thank you for joining — we mean that."* |
| `components/landing/FounderWelcome.tsx`, testid `founder-welcome` | `components/landing/WelcomeNote.tsx`, testid `welcome-note` |

The other two paragraphs, the "Find a pool" button, the once-per-wallet behaviour and the placement
are unchanged. The wording is still a draft for the founder to re-voice.

`CHANGE-2026-09-13_ui.md` §6.1 keeps the old text as the record of what the 13th shipped, with a
dated line saying it was superseded the same night.

## 7. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint` | 0 warnings |
| `scripts/check-language.sh` (§8.7) | clean |
| `vitest` | 61 files, 488 tests, all passing |
| Grep for the name, `founderName`, `founderRole`, `FounderWelcome` across `app/` | no hits outside the one historical comment that records the rename |
| The live CORS evidence in §2 | re-runnable with the curl in §3 step 4 |

The geo finding needs no test: it is a deployment variable, and the assertion that would catch it is
the curl in §3 step 4. Adding that curl to the deploy workflow's post-deploy checks is worth doing
and is not done here — it is a separate change to a workflow this one does not touch.
