import { runSearch, runSearchWithDetails } from "../browser/session.js";
import { withCache } from "../cache.js";
import { normalize, type FlatResult } from "../render/normalize.js";
import { renderJson } from "../render/json.js";
import { renderTable } from "../render/table.js";
import { type Cabin, type SearchSpec, type StopLimit } from "../model/spec.js";
import {
  carriersToRouting,
  requireIsoDate,
  requirePageLimit,
  resolveCacheOptions,
  toItineraryDetails,
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
  /** Also open the top result's detail page for fare construction + Google Flights link. */
  details?: boolean;
}

/** Validates input, runs a one-way/round-trip search, and renders table or JSON. */
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

  const result = await search(spec, opts);
  return opts.format === "json" ? renderJson(result) : renderTable(result);
}

/**
 * `--details` needs a live browser session (it drills into the detail page using
 * the in-flight solution session), so it bypasses the cache; the plain path stays
 * cached.
 */
async function search(spec: SearchSpec, opts: SearchCommandOptions): Promise<FlatResult> {
  if (opts.details) {
    const { search: response, details } = await runSearchWithDetails(spec, {
      headful: opts.headful,
    });
    const result = normalize(response, opts.limit);
    return details ? { ...result, details: toItineraryDetails(details) } : result;
  }
  const response = await withCache("search", spec, resolveCacheOptions(opts), () =>
    runSearch(spec, { headful: opts.headful }),
  );
  return normalize(response, opts.limit);
}

/** `--routing` wins; otherwise `--carriers UA,AA` becomes the routing `UA,AA+`. */
export function resolveRouting(opts: SearchCommandOptions): string | undefined {
  return opts.routing ?? carriersToRouting(opts.carriers);
}

/** Throws on bad origin/dest, dates, return-before-depart, or trip-control values. */
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
