# itamatrix — CLI for ITA Matrix flight search

A command-line interface to [ITA Matrix](https://matrix.itasoftware.com/search) (Google's
airfare search engine). Dual-purpose output: human-readable tables for interactive use,
JSON for scripting and AI agents.

## Goals

- Query Matrix from the terminal: one-way, round-trip, multi-city, price calendar.
- Expose advanced controls (cabin, stops, carriers, ITA routing codes).
- Output auto-detects context: TTY → table, piped → JSON (`--json` / `--table` to force).
- Distribute via npm (`npx itamatrix`).

## Non-goals (v1)

- Booking / purchase (Matrix doesn't sell tickets; it's search-only).
- Account/login features (Matrix is anonymous — see findings).
- Real-time price monitoring / alerts.

---

## Findings — live probe (cookieless, 2026-06)

Captured by driving the real site with Playwright and intercepting network traffic.

1. **No auth.** `/search` loads anonymously; no login wall, no cookie required.

2. **Search state is base64-encoded JSON in the URL.** Submitting a search redirects to
   `/flights?search=<base64>`. The decoded payload is the canonical, reconstructable
   search spec:

   ```json
   {
     "type": "round-trip",
     "slices": [{
       "origin": ["BOS"], "dest": ["LAX"],
       "dates": { "searchDateType": "specific",
                  "departureDate": "2026-08-10", "returnDate": "2026-08-17", "...": "..." }
     }],
     "options": { "cabin": "COACH", "stops": "-1", "extraStops": "1",
                  "allowAirportChanges": "true", "showOnlyAvailable": "true" },
     "pax": { "adults": "1" }
   }
   ```

3. **Real backend endpoint:**

   ```text
   POST https://content-alkalimatrix-pa.googleapis.com/v1/search?key=AIza…&alt=json
   headers: x-alkali-application-key: applications/matrix
            x-alkali-auth-apps-namespace: alkali_v2
            x-alkali-auth-entities-namespace: alkali_v2
            content-type: application/json
   body: {
     "summarizers": ["solutionList","carrierStopMatrix","itineraryPriceSlider",
                     "itinerary{Carrier,Origins,Destinations,StopCount}List",
                     "itinerary{Departure,Arrival}TimeRanges","durationSliderItinerary",
                     "currencyNotice","warningsItinerary"],
     "inputs": { "slices":[…], "pax":{"adults":1}, "cabin":"COACH",
                 "page":{"current":1,"size":25}, "sorts":"default",
                 "maxLegsRelativeToMin":1, "changeOfAirport":true, "checkAvailability":true },
     "summarizerSet": "wholeTrip",
     "bgProgramResponse": "!LC-lL0vN…"   // BotGuard token — see blocker
   }
   ```

4. **Result schema** (`result_full.json` saved as fixture):

   ```text
   response.solutionList: { solutions[25], minPrice, solutionCount, pages }
     solution: { displayTotal:"USD439.81", passengerCount, pricings,
                 itinerary:{ slices:[{ origin{code,name}, destination, departure, arrival,
                                       flights:["UA2210"], cabins:["COACH"], duration,
                                       ext.warnings:["OVERNIGHT"] }] },
                 ext:{ price, pricePerMile } }
   response.{carrierStopMatrix, itineraryPriceSlider, *TimeRanges, itineraryStopCountList}  // facets
   ```

5. **BotGuard — present but surmountable.** The search body carries `bgProgramResponse`, an
   anti-bot token minted by Google's `Waa/Create` + `bg.js`. Verified by probe:
   - **Pure-HTTP client is not viable** — cannot forge the token; must run Google's JS.
   - **Bundled Playwright Chromium, headless, WORKS** (3/3 reliable, ~30–55 s) with two cheap
     stealth tweaks: strip `"Headless"` from the UA string + hide `navigator.webdriver`.
     No system Chrome, no display, no `xvfb` needed.
   - **Earlier "headless blocked" was a false alarm** — it was a *timeout*, not a block.
     Matrix searches genuinely take **40–60 s**; short cutoffs left the spinner spinning.
     Use a ≥90 s timeout.
   - **Direct nav to `/flights?search=…` does NOT trigger a search** — the search call
     only fires from the in-app Search-button flow. The base64 URL encodes *state*, not a query.

6. **Results now arrive via `/batch`, not `/v1/search`** (verified P1, 2026-06). The live
   site issues `POST content-alkalimatrix-pa.googleapis.com/batch` returning
   `multipart/mixed`; one part is an `application/http` wrapper whose JSON body is the
   search result (top-level `solutionList`, `carrierStopMatrix`, … — same shape as
   `result_full.json`). Many `/batch` calls fire (autocomplete, facets), so the driver
   inspects bodies and picks the part containing `solutionList`. Form driving notes:
   trip type is a `[role=tab]` ("Round Trip"/"One Way"); origin/dest are two
   `[role=combobox]` "Add airport" autocompletes (pick first option); round-trip dates are
   `input.mat-start-date`/`input.mat-end-date`, one-way is `input.mat-datepicker-input`
   (M/D/YYYY, set via `fill()` + blur, then click the calendar backdrop to commit).

---

## Architecture

**Browser-driven, bundled Playwright Chromium, headless.** Google's JS must run to mint the
BotGuard token, but headless bundled Chromium suffices with light stealth — no system Chrome,
no display.

Per query:

```text
launch chromium (headless) with UA stripped of "Headless" + navigator.webdriver hidden
  → goto /search
  → set origin / dest / dates / options (native-setter value injection, not clicks)
  → click Search
  → intercept POST content-alkalimatrix-pa…/v1/search response  (timeout ≥90 s)
  → parse JSON → render (table | json)
```

One browser instance is reused across the process lifetime. A **persistent daemon** (warm
BotGuard session, IPC from CLI) is a later optimization for sub-second repeat queries.

### Layout

```text
itamatrix/
  src/
    cli.ts                 # commander; TTY-detect → table|json
    browser/session.ts     # launch chrome, drive form, click, intercept /v1/search
    browser/forms.ts       # set slices/dates/pax/cabin/stops via native setters
    model/types.ts         # zod schemas derived from result_full.json
    render/table.ts
    render/json.ts
    commands/search.ts
    commands/multicity.ts
    commands/calendar.ts
  fixtures/result_full.json
```

### Command surface

```text
itamatrix search BOS LAX --depart 2026-08-10 --return 2026-08-17 \
  --pax 1 --cabin economy --stops 1 --carriers UA,AA --sort price --limit 20

itamatrix multicity \
  --leg JFK:NRT:2026-08-10 --leg NRT:SIN:2026-08-15 --leg SIN:JFK:2026-08-20

itamatrix calendar BOS LAX --depart-range 2026-08-01:2026-08-31 --trip-length 7

# global: --json | --table  --currency USD  --routing "<ITA routing codes>"
```

### Full option set

Extracted from the live form (incl. Advanced Controls). Every Matrix control is exposed.
"API field" = where it lands in the `/v1/search` `inputs` (or the base64 `options`/`pax`).

**Trip type** — `search` (round-trip via `--return`), `--one-way`, `multicity` command.
Maps to `slices` count + symmetry.

**Per-slice routing** (repeatable per leg):

| CLI flag | Control | Values | API field |
|----------|---------|--------|-----------|
| `<ORIGIN>` | Origin | airport/city codes, multiple OK | `slices[].origins[]` |
| `<DEST>` | Destination | airport/city codes, multiple OK | `slices[].destinations[]` |
| `--routing "<codes>"` | Routing Codes | ITA path language (carriers, vias, operators) — see [skills/itamatrix/references/ROUTING_CODES.md](skills/itamatrix/references/ROUTING_CODES.md) | passed through, per slice |
| `--ext "<codes>"` | Extension Codes | ITA faring & filter codes (`f bc=`, `MAXDUR`, `-OVERNIGHTS`…) — see [skills/itamatrix/references/ROUTING_CODES.md](skills/itamatrix/references/ROUTING_CODES.md) | passed through, per slice |

**Dates & times** (per slice):

| CLI flag | Control | Values | API field |
|----------|---------|--------|-----------|
| `--depart` / `--return` | Start/End date | `YYYY-MM-DD` | `slices[].date` |
| `--date-basis` | Departure / Arrival | `depart` \| `arrive` | `slices[].isArrivalDate` |
| `--date-window` | This day only / day before / day after / +/-1 / +/-2 | `0`,`-1`,`+1`,`1`,`2` | `slices[].dateModifier{minus,plus}` |
| `--times` | Preferred times | `early-am,am,midday,afternoon,evening,night` (6 windows) | `slices[].filter.times` |
| `--calendar` | "See calendar of lowest fares" | flag → calendar mode | `searchDateType: lowestFare` |

**Passengers** (`--pax` shorthand or individual):

| CLI flag | Control | Range | API field |
|----------|---------|-------|-----------|
| `--adults` | Adults (18-61) | int | `pax.adults` |
| `--seniors` | Seniors (62+) | int | `pax.seniors` |
| `--youths` | Youths (12-17) | int | `pax.youths` |
| `--children` | Children (2-11) | int | `pax.children` |
| `--infants-seat` | Infants in seat (<2) | int | `pax.infantsInSeat` |
| `--infants-lap` | Infants in lap (<2) | int | `pax.infantsInLap` |

**Trip options:**

| CLI flag | Control | Values | API field |
|----------|---------|--------|-----------|
| `--stops` | Stops | `none`(nonstop) \| `1` \| `2` \| `any`(no limit) | `options.stops` (`0/1/2/-1`) |
| `--extra-stops` | Extra stops | `none` \| `1` \| `2` \| `any` | `options.extraStops` / `maxLegsRelativeToMin` |
| `--cabin` | Cabin | `cheapest` \| `premium-economy` \| `business` \| `first` | `inputs.cabin` (`COACH`/`PREMIUM-COACH`/`BUSINESS-OR-HIGHER`/`FIRST`) |
| `--currency` | Currency | ISO code (e.g. `USD`) | sales currency |
| `--sales-city` | Sales City | airport/city code | sales city |
| `--allow-airport-changes` / `--no-airport-changes` | Allow airport changes | bool (default on) | `inputs.changeOfAirport` |
| `--available-only` / `--all` | Only show available seats | bool (default on) | `inputs.checkAvailability` |

**Output/paging:**

| CLI flag | Meaning |
|----------|---------|
| `--limit N` | page size (Matrix default 25) → `inputs.page.size` |
| `--sort` | `default` \| `price` \| `duration` \| `depart` \| `arrive` → `inputs.sorts` |
| `--json` / `--table` | force output format |

---

## Trade-offs

- **Bundles Chromium (~150 MB); ~30–60 s per query.** Search latency is server-side (Matrix
  itself is slow), not browser overhead — a daemon won't fix it; only result caching would.
- **Coupled to the live DOM + network shape.** Form selectors and the `/v1/search` schema can
  change without notice. Mitigation: thin selector layer (`forms.ts`), zod parse with clear
  errors on schema drift, fixture-based tests.
- **Rejected: pure-HTTP client.** Cleanest and fastest, but impossible — BotGuard token.

---

## Build plan

| Phase | Scope | Ships |
|-------|-------|-------|
| P1 | session driver + `search` (one-way/round-trip) + table/json output | ✅ done |
| P2 | filters/options: cabin, stops, carriers, ITA routing codes | ✅ done |
| P3 | `multicity` (N slices), `calendar` (lowest-fare-per-date) | ✅ done |
| P4 | npm packaging (`npx itamatrix`), result caching | ✅ done |
| P5 | **agent skill** — NL → routing/extension codes via [skills/itamatrix/references/ROUTING_CODES.md](skills/itamatrix/references/ROUTING_CODES.md), wraps the CLI ([skills/itamatrix](skills/itamatrix/SKILL.md)) | ✅ done |

## Open questions

- **`calendar` response schema is unconfirmed.** No live fixture was captured for the
  lowest-fare calendar `/batch` body, so `extractCalendarPayload` matches any plausible
  calendar summarizer key and `normalizeCalendar` deep-scans the payload for date→price
  pairs rather than binding to a schema. Capture a real fixture and tighten to a zod
  schema (like `result_full.json`) once available; calendar form selectors are likewise
  provisional and live in `forms.ts` (the coupled layer).
- Daemon IPC mechanism (unix socket vs local HTTP) — superseded by P4 disk
  result caching (`src/cache.ts`, spec-keyed, 60-min TTL, `--no-cache`/`--cache-ttl`).
  Repeat queries are instant without a warm-process; a daemon stays a non-goal.
- Server/CI use — works as-is (headless, no display needed). Just `npx playwright install chromium`.
