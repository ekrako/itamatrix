import { runSearch } from "../browser/session.js";
import { withCache } from "../cache.js";
import { normalize } from "../render/normalize.js";
import { renderJson } from "../render/json.js";
import { renderTable } from "../render/table.js";
import { type Cabin, type SearchSpec, type StopLimit } from "../model/spec.js";
import {
  carriersToRouting,
  requireIsoDate,
  requirePageLimit,
  resolveCacheOptions,
  validateTripControls,
  type CacheControlOptions,
  type OutputFormat,
} from "./shared.js";

export type { OutputFormat };

export interface SearchCommandOptions extends CacheControlOptions {
  depart: string;
  return?: string;
  oneWay?: boolean;
  adults: number;
  limit: number;
  cabin?: string;
  stops?: string;
  extraStops?: string;
  carriers?: string;
  routing?: string;
  ext?: string;
  format: OutputFormat;
  headful?: boolean;
}

export async function runSearchCommand(
  origin: string,
  dest: string,
  opts: SearchCommandOptions,
): Promise<string> {
  validate(origin, dest, opts);

  const spec: SearchSpec = {
    origin: origin.toUpperCase(),
    dest: dest.toUpperCase(),
    departDate: opts.depart,
    returnDate: opts.oneWay ? undefined : opts.return,
    adults: opts.adults,
    limit: opts.limit,
    cabin: opts.cabin as Cabin | undefined,
    stops: opts.stops as StopLimit | undefined,
    extraStops: opts.extraStops as StopLimit | undefined,
    routing: resolveRouting(opts),
    ext: opts.ext,
  };

  const response = await withCache("search", spec, resolveCacheOptions(opts), () =>
    runSearch(spec, { headful: opts.headful }),
  );
  const result = normalize(response, opts.limit);
  return opts.format === "json" ? renderJson(result) : renderTable(result);
}

/** `--routing` wins; otherwise `--carriers UA,AA` becomes the routing `UA,AA+`. */
export function resolveRouting(opts: SearchCommandOptions): string | undefined {
  return opts.routing ?? carriersToRouting(opts.carriers);
}

function validate(origin: string, dest: string, opts: SearchCommandOptions): void {
  if (!origin || !dest) throw new Error("origin and destination are required");
  requireIsoDate(opts.depart, "--depart");
  if (opts.return && !opts.oneWay) {
    requireIsoDate(opts.return, "--return");
    if (opts.return < opts.depart) {
      throw new Error("--return must be on or after --depart");
    }
  }
  validateTripControls(opts);
  requirePageLimit(opts.limit);
}
