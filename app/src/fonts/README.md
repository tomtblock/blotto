# The three faces, self-hosted

These are the latin-subset **variable** woff2 files Google Fonts itself serves, downloaded once and
committed. Nothing here is modified — byte-for-byte what `fonts.gstatic.com` returned.

## Why they are committed rather than fetched

`next/font/google` downloads font files from Google **at build time**. That made every production
build depend on a third-party fetch succeeding, and it failed the way network dependencies fail —
intermittently, and never reproducibly:

| run | commit | app code | result |
|---|---|---|---|
| 403 | `cea3128` | identical | success |
| 404 | `0c77466` | identical | **failure**, 11 minutes later |

Those two commits differ only in `battle-test/` files. The error was
`next/font/google queries have exactly one entry`, which is how Turbopack surfaces a failed or
throttled font fetch rather than as a network error — so it reads like a code fault and is not one.
The same flake failed `app-lighthouse` on `main` on 2026-09-21.

A build that can break because a CDN was slow eventually breaks a **deploy**, not just a check.
Self-hosting removes the dependency entirely.

## What each file is

| file | family | axis committed | used at |
|---|---|---|---|
| `big-shoulders-latin-var.woff2` | Big Shoulders | 600–800 | display face (D1) |
| `space-grotesk-latin-var.woff2` | Space Grotesk | 300–700 | body |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono | 100–800 | numerals, addresses, hashes |

Roughly 99 KB in total, and the browser now fetches them from our own origin, so the page no longer
makes a third-party request to render text either.

## Licensing

All three are under the **SIL Open Font License, Version 1.1**, which permits redistribution
provided the license travels with the files. It does, alongside each font:

- `big-shoulders.OFL.txt`
- `space-grotesk.OFL.txt`
- `jetbrains-mono.OFL.txt`

Each is the upstream text from `github.com/google/fonts/ofl/<family>/OFL.txt`, unmodified.

## Refreshing a file

Only if a family is deliberately updated — there is no routine need, and a stale file is not a
defect. Request the CSS with a modern browser User-Agent (an old one gets ttf instead of woff2),
take the `src` URL from the `@font-face` block whose `unicode-range` contains `U+0000-00FF` (that
is the latin block, and it is **not** the first block in the file), and download it:

```sh
curl -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
```

Verify what you got is really a woff2 before committing it — the first four bytes must be `wOF2`.
A failed fetch writes an HTML error page to the destination just as happily as a font.
