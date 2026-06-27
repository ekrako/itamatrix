# itamatrix

A command-line interface to [ITA Matrix](https://matrix.itasoftware.com/search)
(Google's airfare search engine). Output auto-detects context: a TTY gets a
human-readable table, a pipe gets JSON for scripting and AI agents.

See [DESIGN.md](DESIGN.md) for architecture and
[skills/itamatrix/references/ROUTING_CODES.md](skills/itamatrix/references/ROUTING_CODES.md)
for the ITA routing/extension code language.

## Install

```bash
npx itamatrix search BOS LAX --depart 2026-08-10
```

Or install globally:

```bash
npm install -g itamatrix
```

itamatrix drives a headless Chromium (Google's anti-bot JS must run). The
bundled Playwright browser is required once:

```bash
npx playwright install chromium
```

If it is missing, itamatrix prints this exact command.

## Usage

```bash
# Round-trip
itamatrix search BOS LAX --depart 2026-08-10 --return 2026-08-17 \
  --adults 1 --cabin business --stops 1 --carriers UA,AA --limit 20

# Multi-city
itamatrix multicity \
  --leg JFK:NRT:2026-08-10 --leg NRT:SIN:2026-08-15 --leg SIN:JFK:2026-08-20

# Price calendar (lowest fare per departure date)
itamatrix calendar BOS LAX --depart-range 2026-08-01:2026-08-31 --trip-length 7

# Global: --json | --table to force output format
```

Each query takes 30–60 s — Matrix itself is slow server-side.

## Caching

Results are cached on disk keyed by the full search spec, so a repeated query
returns instantly instead of re-driving the browser. Applies to every command.

| Flag | Meaning |
|------|---------|
| (default) | use cache; entries are fresh for 60 minutes |
| `--cache-ttl <minutes>` | change the freshness window (e.g. `--cache-ttl 5`) |
| `--no-cache` | bypass the cache and always query live |

Cache location: `$XDG_CACHE_HOME/itamatrix`, falling back to `~/.cache/itamatrix`.
Caching is best-effort — a read/write failure degrades silently to a live query.

## Agent skill

[`skills/itamatrix/SKILL.md`](skills/itamatrix/SKILL.md) is a Claude Code agent
skill that turns a natural-language trip request ("cheapest business-class
nonstop to London on oneworld next August") into the right command plus ITA
[routing/extension codes](skills/itamatrix/references/ROUTING_CODES.md), then runs the CLI.

Install it with [`npx skills`](https://www.npmjs.com/package/skills) straight
from the repo:

```bash
npx skills add ekrako/itamatrix          # discovers skills/itamatrix/SKILL.md
npx skills add ekrako/itamatrix -g       # install globally (user-level)
```

Or drop the `skills/` directory into an agent's skill path manually.

The skill's **Command reference** section is generated from the CLI's own
commander definitions, so it can't drift from the real flags:

```bash
npm run gen:skill          # regenerate after changing the CLI
npm run gen:skill:check    # CI/pre-commit: fail if the skill is stale
```

A `core.hooksPath` pre-commit hook (`.githooks/pre-commit`, installed by `npm
install`'s `prepare` step) runs the skill-drift check, `typecheck`, and
`lint:md` on every commit.

## Development

```bash
npm run dev -- search BOS LAX --depart 2026-08-10   # run from source
npm test                                            # vitest
npm run typecheck
npm run lint:md                                     # markdownlint-cli2
npm run build
```
