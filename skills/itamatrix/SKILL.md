---
name: itamatrix
description: >-
  Search flights on ITA Matrix from natural language. Use when the user wants to
  find flights, compare fares, build a multi-city trip, or scan a price calendar,
  and especially when the request implies advanced constraints (specific carriers,
  alliances, connection hubs to force or avoid, layover limits, cabin/fare rules).
  Translates the request into the `itamatrix` CLI plus ITA routing/extension codes.
license: MIT
metadata:
  display_name:
    he: itamatrix — חיפוש טיסות ב-ITA Matrix
  display_description:
    he: >-
      חיפוש טיסות ב-ITA Matrix משפה טבעית. שימושי כשרוצים למצוא טיסות, להשוות
      מחירים, לבנות מסלול רב-יעדים, או לסרוק לוח מחירים — במיוחד עם אילוצים
      מתקדמים (חברות תעופה, בריתות, מסופי קונקשן, מגבלות עצירה, מחלקה/כללי תעריף).
      מתרגם את הבקשה לפקודות ה-CLI ולקודי ניתוב/הרחבה של ITA.
  tags:
    en:
      - flights
      - airfare
      - ita-matrix
      - travel
      - multi-city
      - price-calendar
      - fare-construction
    he:
      - טיסות
      - מחירי-טיסות
      - ITA-Matrix
      - נסיעות
      - רב-יעדים
      - לוח-מחירים
      - בניית-תעריף
---

# itamatrix — natural language → ITA Matrix search

This skill drives the `itamatrix` CLI. Your job: turn a natural-language trip
request into the right command + flags, encoding advanced intent as ITA
**routing codes** (the path) and **extension codes** (faring/filters).

## Prerequisites

The CLI ships as `itamatrix` (`npx itamatrix ...` if not installed globally).
On first use it may ask for the browser: `npx playwright install chromium`.
Queries can take a while (Matrix is slow server-side); repeated queries hit the
cache. **Set the command timeout to at least 180 s** — a search may run that long
before returning. Don't kill it early and conclude it failed.

Always run with `--json` so you get structured output to parse and summarize.

## Pick the command

| Request shape | Command |
|---------------|---------|
| One-way or round-trip A→B | `search <origin> <dest> --depart … [--return …]` |
| 3+ distinct legs / open-jaw | `multicity --leg O:D:DATE --leg …` (≥2 legs) |
| "cheapest date to fly", flexible dates | `calendar <origin> <dest> --depart-range S:E [--trip-length N]` |

Codes are airport/city codes (BOS, LON). Dates are `YYYY-MM-DD`. If the user
gives a relative date ("next month"), resolve it to an absolute date first.

## Map intent → flags

Prefer plain flags for simple intent; reach for `--routing`/`--ext` only when a
flag can't express it.

| Intent | Use |
|--------|-----|
| cabin | `--cabin cheapest\|premium-economy\|business\|first` |
| nonstop / max stops | `--stops none\|1\|2` |
| "only UA and AA" (simple) | `--carriers UA,AA` |
| number of travelers | `--adults N` |
| how many results | `--limit N` (1–25 for search/multicity) |
| fare construction + Google Flights link | `--details` (search/multicity) |

## Fare construction & Google Flights link (`--details`)

`--details` (on `search` and `multicity`) opens the **top result's** itinerary
detail page and adds two things to the output:

- **Fare Construction** — the NUC fare-basis breakdown ITA labels "can be useful
  to travel agents" (e.g. `BOS B6 LON 70.00OL8LBVL1 NUC 70.00 END ROE 1.00 XT
  …`). Surface it verbatim; agents/ticketing desks read it directly.
- **Open in Google Flights** — the detail page's deep link
  (`google.com/travel/flights?tfs=…&source=ita_matrix`) for the same itinerary.

It costs an extra page navigation and **bypasses the cache** (the link needs the
live solution session), so only pass it when the user wants the fare detail or a
hand-off link. Detail is best-effort: if the page can't be opened the search
results still return, just without the `details` block. In JSON it's a top-level
`details: { fareConstruction, googleFlightsUrl }`; in table output it's a footer
under the results. **Show both to the user when present.**

## Encode advanced intent → routing / extension codes

Read **[references/ROUTING_CODES.md](references/ROUTING_CODES.md)** for the full
grammar before constructing codes. Rules of thumb:

- **Path intent → `--routing`.** Which carriers/airports/operators and in what
  order. E.g. "via Tokyo or Seoul" → `--routing NRT,ICN`; "force a Dallas
  connection" → `--routing X:DFW`; "American, avoid Charlotte" → `--routing "AA+ ~CLT"`.
- **Filter / fare intent → `--ext`.** Layover limits, durations, alliance, no
  red-eyes, fare basis. Separate commands with `;`. E.g. "short layovers, no
  overnights" → `--ext "MINCONNECT 0:45; MAXCONNECT 2:00; -OVERNIGHTS"`;
  "business on oneworld" → `--ext "+CABIN business; ALLIANCE oneworld"`.
- Don't mix the two fields. Path goes in `--routing`, filters/fares in `--ext`.
- The `f` faring grammar is community-documented, not official — let Matrix
  validate. Don't over-restrict locally.

### High-leverage patterns (see the reference doc's "Power-user strategies")

- **Force a stopover/overnight** — Matrix has no stopover command; fake it with a
  big minimum connection. "Overnight in Tokyo" → `--routing X:NRT --ext "MINCONNECT 12:00"`;
  24 h+ stopover → `MINCONNECT 30:00`.
- **Mileage credit / specific metal** — force operating carrier in `--routing` (`O:LH+`)
  and the crediting program via `--ext "ALLIANCE star-alliance"`.
- **Upgrade/earning fare buckets** — pin booking class with `--ext "f bc=w|bc=v"`.
- **Time format gotcha**: `--ext` uses `h:mm` (`MINCONNECT 12:00`); the inline
  `--routing / minconnect 720` form uses raw minutes. Prefer `--ext`.

## Workflow

1. Parse the request: route(s), dates, travelers, and any constraints.
2. Choose the command; resolve relative dates to absolute.
3. Map constraints to flags first; encode the rest as `--routing` / `--ext`
   using the reference doc.
4. **Echo the constructed command to the user before running** — especially the
   routing/extension codes, so they can confirm or correct the intent.
5. Run with `--json`, parse, and present the results clearly (price, carriers,
   stops, duration). On a CLI error, read the message — it names the bad flag —
   and fix the command rather than guessing.

## Command reference

The block below is generated from the CLI's own command/option definitions by
`scripts/gen-skill.ts` — do not edit it by hand. Run `npm run gen:skill` after
changing the CLI; `npm run gen:skill:check` (pre-commit hook) fails if it drifts.

<!-- BEGIN GENERATED: command-reference -->

Global options (precede the subcommand):

| Option | Meaning |
|--------|---------|
| `-V, --version` | output the version number |
| `--json` | force JSON output |
| `--table` | force table output |
| `--no-cache` | bypass the result cache (always query live) |
| `--cache-ttl <minutes>` | max age of a cached result in minutes (default 60) |

### `search <origin> <dest>`

Search one-way or round-trip flights

| Option | Meaning |
|--------|---------|
| `--depart <date>` | departure date (YYYY-MM-DD) |
| `--return <date>` | return date (YYYY-MM-DD) → round-trip |
| `--one-way` | force one-way (ignore --return) |
| `--adults <n>` | number of adults (default `1`) |
| `--limit <n>` | max results, 1-25 (one Matrix page) (default `25`) |
| `--cabin <cabin>` | cheapest \| premium-economy \| business \| first |
| `--stops <stops>` | any \| none \| 1 \| 2 |
| `--extra-stops <stops>` | any \| none \| 1 \| 2 |
| `--carriers <list>` | comma-separated carriers, e.g. UA,AA (sugar for --routing) |
| `--routing <codes>` | ITA routing codes (path) — see references/ROUTING_CODES.md |
| `--ext <codes>` | ITA extension codes (faring/filters) — see references/ROUTING_CODES.md |
| `--details` | also fetch the top result's fare construction + Google Flights link (live, skips cache) |
| `--headful` | show the browser window (debug) |

### `multicity`

Search a multi-city itinerary (N legs)

| Option | Meaning |
|--------|---------|
| `--leg <ORIGIN:DEST:DATE>` | a leg, e.g. JFK:NRT:2026-08-10 (repeatable, >= 2) |
| `--adults <n>` | number of adults (default `1`) |
| `--limit <n>` | max results, 1-25 (one Matrix page) (default `25`) |
| `--cabin <cabin>` | cheapest \| premium-economy \| business \| first |
| `--stops <stops>` | any \| none \| 1 \| 2 |
| `--extra-stops <stops>` | any \| none \| 1 \| 2 |
| `--carriers <list>` | comma-separated carriers, e.g. UA,AA (sugar for --routing) |
| `--routing <codes>` | ITA routing codes applied to every leg |
| `--ext <codes>` | ITA extension codes applied to every leg |
| `--details` | also fetch the top result's fare construction + Google Flights link (live, skips cache) |
| `--headful` | show the browser window (debug) |

### `calendar <origin> <dest>`

Price calendar: lowest fare per departure date over a range

| Option | Meaning |
|--------|---------|
| `--depart-range <start:end>` | YYYY-MM-DD:YYYY-MM-DD |
| `--trip-length <nights>` | round-trip nights; omit for one-way |
| `--adults <n>` | number of adults (default `1`) |
| `--limit <n>` | show only the N cheapest dates (default `25`) |
| `--cabin <cabin>` | cheapest \| premium-economy \| business \| first |
| `--stops <stops>` | any \| none \| 1 \| 2 |
| `--extra-stops <stops>` | any \| none \| 1 \| 2 |
| `--carriers <list>` | comma-separated carriers, e.g. UA,AA (sugar for --routing) |
| `--routing <codes>` | ITA routing codes |
| `--ext <codes>` | ITA extension codes |
| `--headful` | show the browser window (debug) |

<!-- END GENERATED: command-reference -->

## Examples

> "Cheapest business-class flight from Boston to London next August, oneworld only, nonstop."

```bash
itamatrix --json search BOS LON --depart 2026-08-15 \
  --cabin business --stops none --ext "ALLIANCE oneworld"
```

> "Round the world: JFK to Tokyo, Tokyo to Singapore, Singapore home. Avoid overnight layovers."

```bash
itamatrix --json multicity \
  --leg JFK:NRT:2026-08-10 --leg NRT:SIN:2026-08-15 --leg SIN:JFK:2026-08-20 \
  --ext "-OVERNIGHTS"
```

> "Boston to Singapore in October, but I want a long overnight stopover in Tokyo."

```bash
itamatrix --json search BOS SIN --depart 2026-10-10 \
  --routing "X:NRT" --ext "MINCONNECT 12:00; MAXCONNECT 30:00"
```

> "What's the cheapest week in August to do a 7-night trip BOS→LAX on United?"

```bash
itamatrix --json calendar BOS LAX \
  --depart-range 2026-08-01:2026-08-31 --trip-length 7 --carriers UA
```

> "Cheapest BOS→LON next August, and give me the fare construction and a Google Flights link for the top one."

```bash
itamatrix --json search BOS LON --depart 2026-08-15 --details
# → result.details.fareConstruction[] + result.details.googleFlightsUrl
```
