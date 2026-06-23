# ITA Matrix Routing & Extension Codes — reference

Reference for constructing the two advanced per-slice inputs on ITA Matrix: **Routing Codes**
(the flight *path*) and **Extension Codes** (faring & itinerary *filters*). Written for an
agent skill that builds these strings from natural-language intent.

Sources: [Google: Using the ITA Routing Codes](https://support.google.com/faqs/answer/2736497?hl=en),
[Travel Codex routing guide](https://www.travelcodex.com/advanced-routing-language-in-ita/),
[UponArriving extension-code guide](https://www.uponarriving.com/ita-matrix-guide/).

> Two separate fields, per slice. Don't mix them: path goes in **Routing**, faring/filters go in
> **Extension**. Both are optional. Codes are case-insensitive. Within Extension, separate
> multiple commands with `;`.

---

## 1. Routing Codes (the path)

Define which carriers / airports / operators a slice may use, and in what order.

### Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `,` | any-of (OR), **no spaces** | `AA,UA,DL` — any of the three |
| `` (space) | sequence (then) | `UA SFO UA` — UA, via SFO, UA |
| `~` | negation / exclude | `~CLT` — connect anywhere except CLT |
| `+` | one or more | `UA+` — one or more UA flights |
| `*` | zero or more | `AA* DL AA*` — a DL flight somewhere in an AA itinerary |
| `?` | zero or one | `UA?` — optional UA segment |
| `()` | grouping | `(AA,BA) LHR` |

### Tokens

| Token | Meaning | Example |
|-------|---------|---------|
| `XX` | airline (2-letter), marketing carrier by default | `BA` |
| `XX####` | specific flight number | `UA882` |
| `XX####-####` | flight-number range | `UA1000-2000` |
| `AAA` | airport / city (3-letter) as a connection point | `NRT` |
| `C:XX` | force **marketing** carrier | `C:BA` |
| `O:XX` | force **operating** carrier | `O:AA` |
| `X:AAA` | **require** connection at airport | `X:DFW` |
| `N:` | nonstop only (no connections) | `N:` |
| `F:` | direct (single flight number, stops allowed) | `F:` |

### Inline path modifiers (`/ cmd`)

Some filters can be appended inline in the Routing field with a leading slash:

| Modifier | Meaning | Example |
|----------|---------|---------|
| `/ maxconnect mmm` | max connection minutes | `/ maxconnect 120` |
| `/ minconnect mmm` | min connection minutes | `/ minconnect 45` |
| `/ alliance NAME` | restrict to alliance | `/ alliance star-alliance` |

> These overlap with Extension codes; prefer the Extension field for filters and keep Routing
> for the path. Alliance names: `oneworld`, `skyteam`, `star-alliance`.

### Routing examples

| Intent | Routing |
|--------|---------|
| Only United, any routing | `UA+` |
| Via Tokyo, Seoul, or Hong Kong | `NRT,ICN,HKG` |
| American, avoid Charlotte | `AA+ ~CLT` |
| Star Alliance carriers only | `UA,LH,NH,SQ,AC,TG+` |
| Force connection in Dallas | `X:DFW` |
| Specific flight then any | `UA882 UA+` |

---

## 2. Extension Codes (faring & filters)

Separate multiple commands with `;`. Within a command, multiple values are space- or
pipe-(`|`)-separated.

### Itinerary filters

| Code | Syntax | Example | Meaning |
|------|--------|---------|---------|
| Max segments | `MAXSTOP n` | `MAXSTOP 2` | cap number of flights |
| Max duration | `MAXDUR h:mm` | `MAXDUR 6:45` | total journey time ceiling |
| Max miles | `MAXMILES n` | `MAXMILES 2900` | distance ceiling |
| Min miles | `MINMILES n` | `MINMILES 2600` | distance floor |
| Min connect | `MINCONNECT h:mm` | `MINCONNECT 1:00` | min layover |
| Max connect | `MAXCONNECT h:mm` | `MAXCONNECT 2:00` | max layover |
| Pad connect | `PADCONNECT h:mm` | `PADCONNECT 0:30` | buffer beyond airline minimum |
| Alliance | `ALLIANCE name` | `ALLIANCE oneworld` | alliance only |
| Allow airlines | `AIRLINES a b` | `AIRLINES BA AF` | only these carriers |
| Disallow airlines | `-AIRLINES a b` | `-AIRLINES AA BA` | block these carriers |
| Allow operating | `OPAIRLINES a` | `OPAIRLINES AA` | by operating carrier |
| Disallow operating | `-OPAIRLINES a` | `-OPAIRLINES AA` | block operating carrier |
| Avoid cities | `-CITIES a b` | `-CITIES DFW ORD` | avoid connection hubs |
| No codeshares | `-CODESHARE` | `-CODESHARE` | exclude codeshare flights |
| No red-eyes | `-REDEYES` | `-REDEYES` | exclude red-eye flights |
| No overnights | `-OVERNIGHTS` | `-OVERNIGHTS` | exclude overnight layovers |
| No props | `-PROPS` | `-PROPS` | exclude propeller aircraft |

### Faring codes (`f` / booking class / fare basis)

| Code | Syntax | Example | Meaning |
|------|--------|---------|---------|
| Require cabin | `+CABIN code` | `+CABIN business` | mandate cabin (`first`/`business`/`premium-coach`/`coach`) |
| Prohibit cabin | `-CABIN code` | `-CABIN coach` | block a cabin |
| Booking class | `f bc=X` | `f bc=y` | require prime booking code |
| Multiple booking | `f bc=X\|bc=Y` | `f bc=y\|bc=b` | any of several booking codes |
| Fare basis | `f ..FFFF` | `f ..yup\|..f` | target fare basis codes |
| Carrier + market + basis | `f CC.AAA+BBB.FFFF` | `f aa.lon+chi.yup` | full fare spec |
| Carrier + basis | `f CC..FFFF` | `f aa..yup` | by airline + fare code |
| Market only | `f .AAA+BBB.` | `f .lon+chi.` | by city pair |
| Wildcard basis | `f ..X-` | `f ..y-\|..b-` | fare-basis prefix patterns |

### Extension examples

| Intent | Extension |
|--------|-----------|
| Short layovers, no overnights | `MINCONNECT 0:45; MAXCONNECT 2:00; -OVERNIGHTS` |
| Business class, oneworld | `+CABIN business; ALLIANCE oneworld` |
| Only BA/AF, full-fare Y | `AIRLINES BA AF; f bc=y` |
| Avoid ORD & DFW, no props | `-CITIES ORD DFW; -PROPS` |
| Cap trip at 9h, 2 stops max | `MAXDUR 9:00; MAXSTOP 2` |

---

## 3. Notes for the skill

- **Validate field placement**: path-shaped intent → Routing; filter/fare intent → Extension.
- **Cabin two ways**: the top-level `--cabin` (search option) sets the *displayed* cabin;
  `+CABIN`/`-CABIN` in Extension enforces it at the fare level. Prefer `--cabin` for simple
  cases; use Extension `+CABIN` when combining with other faring codes.
- **Per slice**: each leg has its own Routing + Extension. Multi-city legs can differ.
- **Uncertainty**: exact `f` faring grammar is community-documented, not officially published;
  the skill should surface the constructed code to the user and let Matrix's own validation
  reject malformed input rather than over-validating locally.
- **Round-trip**: Matrix applies the same routing intent symmetrically unless a return-slice
  routing is given explicitly.
