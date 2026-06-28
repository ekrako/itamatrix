#!/usr/bin/env node
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import {
  runSearchCommand,
  type OutputFormat,
  type SearchCommandOptions,
} from "./commands/search.js";
import { runMultiCityCommand } from "./commands/multicity.js";
import { runCalendarCommand } from "./commands/calendar.js";
import { carriersToRouting } from "./commands/shared.js";

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

/** Commander parser that accepts only whole integers (rejects "1.5", "2foo"). */
function intArg(flag: string): (value: string) => number {
  return (value) => {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new InvalidArgumentError(`${flag} must be an integer, got "${value}"`);
    }
    return parseInt(value, 10);
  };
}

function run(action: () => Promise<string>): Promise<void> {
  return action()
    .then((out) => {
      process.stdout.write(out + "\n");
    })
    .catch((err) => {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    });
}

function resolveFormat(json?: boolean, table?: boolean): OutputFormat {
  if (json) return "json";
  if (table) return "table";
  // Auto-detect: TTY → table, piped → json.
  return process.stdout.isTTY ? "table" : "json";
}

// Read version from package.json so it tracks semantic-release bumps (which only
// update package.json, never this file). dist/cli.js sits one dir below package root.
const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export const program = new Command();

program
  .name("itamatrix")
  .description("CLI for ITA Matrix flight search")
  .version(version)
  .option("--json", "force JSON output")
  .option("--table", "force table output")
  .option("--no-cache", "bypass the result cache (always query live)")
  .option(
    "--cache-ttl <minutes>",
    "max age of a cached result in minutes (default 60)",
    intArg("--cache-ttl"),
  );

program
  .command("search")
  .description("Search one-way or round-trip flights")
  .argument("<origin>", "origin airport/city code")
  .argument("<dest>", "destination airport/city code")
  .requiredOption("--depart <date>", "departure date (YYYY-MM-DD)")
  .option("--return <date>", "return date (YYYY-MM-DD) → round-trip")
  .option("--one-way", "force one-way (ignore --return)")
  .option(
    "--date-basis <basis>",
    "interpret --depart as depart | arrive date (default depart)",
  )
  .option(
    "--return-date-basis <basis>",
    "interpret --return as depart | arrive date (default: same as --date-basis)",
  )
  .option("--adults <n>", "number of adults", intArg("--adults"), 1)
  .option("--limit <n>", "max results, 1-25 (one Matrix page)", intArg("--limit"), 25)
  .option("--cabin <cabin>", "cheapest | premium-economy | business | first")
  .option("--stops <stops>", "any | none | 1 | 2")
  .option("--extra-stops <stops>", "any | none | 1 | 2")
  .option("--carriers <list>", "comma-separated carriers, e.g. UA,AA (sugar for --routing)")
  .option("--routing <codes>", "ITA routing codes (path) — see references/ROUTING_CODES.md")
  .option("--ext <codes>", "ITA extension codes (faring/filters) — see references/ROUTING_CODES.md")
  .option(
    "--details",
    "also fetch the top result's fare construction + Google Flights link (live, skips cache)",
  )
  .option("--headful", "show the browser window (debug)")
  .action(async (origin: string, dest: string, cmdOpts, command) => {
    const globals = command.parent.opts();
    const opts: SearchCommandOptions = {
      depart: cmdOpts.depart,
      return: cmdOpts.return,
      oneWay: cmdOpts.oneWay,
      dateBasis: cmdOpts.dateBasis,
      returnDateBasis: cmdOpts.returnDateBasis,
      adults: cmdOpts.adults,
      limit: cmdOpts.limit,
      cabin: cmdOpts.cabin,
      stops: cmdOpts.stops,
      extraStops: cmdOpts.extraStops,
      carriers: cmdOpts.carriers,
      routing: cmdOpts.routing,
      ext: cmdOpts.ext,
      details: cmdOpts.details,
      headful: cmdOpts.headful,
      format: resolveFormat(globals.json, globals.table),
      cache: globals.cache,
      cacheTtlMinutes: globals.cacheTtl,
    };
    await run(() => runSearchCommand(origin, dest, opts));
  });

program
  .command("multicity")
  .description("Search a multi-city itinerary (N legs)")
  .requiredOption(
    "--leg <ORIGIN:DEST:DATE>",
    "a leg, e.g. JFK:NRT:2026-08-10 or JFK:NRT:2026-08-10:arrive (repeatable, >= 2)",
    collect,
    [],
  )
  .option("--adults <n>", "number of adults", intArg("--adults"), 1)
  .option("--limit <n>", "max results, 1-25 (one Matrix page)", intArg("--limit"), 25)
  .option("--cabin <cabin>", "cheapest | premium-economy | business | first")
  .option("--stops <stops>", "any | none | 1 | 2")
  .option("--extra-stops <stops>", "any | none | 1 | 2")
  .option("--carriers <list>", "comma-separated carriers, e.g. UA,AA (sugar for --routing)")
  .option("--routing <codes>", "ITA routing codes applied to every leg")
  .option("--ext <codes>", "ITA extension codes applied to every leg")
  .option(
    "--details",
    "also fetch the top result's fare construction + Google Flights link (live, skips cache)",
  )
  .option("--headful", "show the browser window (debug)")
  .action(async (cmdOpts, command) => {
    const globals = command.parent.opts();
    await run(() =>
      runMultiCityCommand({
        legs: cmdOpts.leg,
        adults: cmdOpts.adults,
        limit: cmdOpts.limit,
        cabin: cmdOpts.cabin,
        stops: cmdOpts.stops,
        extraStops: cmdOpts.extraStops,
        routing: cmdOpts.routing ?? carriersToRouting(cmdOpts.carriers),
        ext: cmdOpts.ext,
        format: resolveFormat(globals.json, globals.table),
        details: cmdOpts.details,
        headful: cmdOpts.headful,
        cache: globals.cache,
        cacheTtlMinutes: globals.cacheTtl,
      }),
    );
  });

program
  .command("calendar")
  .description("Price calendar: lowest fare per departure date over a range")
  .argument("<origin>", "origin airport/city code")
  .argument("<dest>", "destination airport/city code")
  .requiredOption("--depart-range <start:end>", "YYYY-MM-DD:YYYY-MM-DD")
  .option(
    "--trip-length <nights>",
    "round-trip nights; omit for one-way",
    intArg("--trip-length"),
  )
  .option(
    "--date-basis <basis>",
    "interpret departure dates as depart | arrive (default depart)",
  )
  .option(
    "--return-date-basis <basis>",
    "for a round-trip calendar, return-slice basis: depart | arrive (default: same as --date-basis)",
  )
  .option("--adults <n>", "number of adults", intArg("--adults"), 1)
  .option("--limit <n>", "show only the N cheapest dates", intArg("--limit"), 25)
  .option("--cabin <cabin>", "cheapest | premium-economy | business | first")
  .option("--stops <stops>", "any | none | 1 | 2")
  .option("--extra-stops <stops>", "any | none | 1 | 2")
  .option("--carriers <list>", "comma-separated carriers, e.g. UA,AA (sugar for --routing)")
  .option("--routing <codes>", "ITA routing codes")
  .option("--ext <codes>", "ITA extension codes")
  .option("--headful", "show the browser window (debug)")
  .action(async (origin: string, dest: string, cmdOpts, command) => {
    const globals = command.parent.opts();
    await run(() =>
      runCalendarCommand(origin, dest, {
        departRange: cmdOpts.departRange,
        tripLength: cmdOpts.tripLength,
        dateBasis: cmdOpts.dateBasis,
        returnDateBasis: cmdOpts.returnDateBasis,
        adults: cmdOpts.adults,
        limit: cmdOpts.limit,
        cabin: cmdOpts.cabin,
        stops: cmdOpts.stops,
        extraStops: cmdOpts.extraStops,
        routing: cmdOpts.routing ?? carriersToRouting(cmdOpts.carriers),
        ext: cmdOpts.ext,
        format: resolveFormat(globals.json, globals.table),
        headful: cmdOpts.headful,
        cache: globals.cache,
        cacheTtlMinutes: globals.cacheTtl,
      }),
    );
  });

// Parse only when run as the CLI entrypoint, so tools can import `program` to
// introspect commands/options (see scripts/gen-skill.ts) without triggering a run.
// argv[1] is realpath'd because npm/npx invoke the bin via a symlink, whose path
// would otherwise never match this module's resolved import.meta.url.
function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  program.parseAsync(process.argv);
}
