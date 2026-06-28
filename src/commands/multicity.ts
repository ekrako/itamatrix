import { runMultiCity, runMultiCityWithDetails } from "../browser/session.js";
import { withCache } from "../cache.js";
import { normalize, type FlatResult } from "../render/normalize.js";
import { renderJson } from "../render/json.js";
import { renderTable } from "../render/table.js";
import {
  type Cabin,
  type MultiCitySpec,
  type Slice,
  type StopLimit,
} from "../model/spec.js";
import {
  requireDateBasis,
  requireIsoDate,
  requirePageLimit,
  resolveCacheOptions,
  toItineraryDetails,
  validateTripControls,
  type CacheControlOptions,
  type OutputFormat,
} from "./shared.js";

export interface MultiCityCommandOptions extends CacheControlOptions {
  legs: string[]; // each "ORIGIN:DEST:YYYY-MM-DD[:depart|arrive]"
  adults: number;
  limit: number;
  cabin?: string;
  stops?: string;
  extraStops?: string;
  routing?: string;
  ext?: string;
  format: OutputFormat;
  headful?: boolean;
  /** Also open the top result's detail page for fare construction + Google Flights link. */
  details?: boolean;
}

/** Parses/validates legs, runs the multi-city search, and renders table or JSON. */
export async function runMultiCityCommand(opts: MultiCityCommandOptions): Promise<string> {
  const slices = parseLegs(opts);
  validateTripControls(opts);
  requirePageLimit(opts.limit);

  const spec: MultiCitySpec = {
    slices,
    adults: opts.adults,
    limit: opts.limit,
    cabin: opts.cabin as Cabin | undefined,
    stops: opts.stops as StopLimit | undefined,
    extraStops: opts.extraStops as StopLimit | undefined,
  };

  const result = await multicity(spec, opts);
  return opts.format === "json" ? renderJson(result) : renderTable(result);
}

/** `--details` drills into the top result live, so it bypasses the cache (see search.ts). */
async function multicity(
  spec: MultiCitySpec,
  opts: MultiCityCommandOptions,
): Promise<FlatResult> {
  if (opts.details) {
    const { search: response, details } = await runMultiCityWithDetails(spec, {
      headful: opts.headful,
    });
    const result = normalize(response, opts.limit);
    return details ? { ...result, details: toItineraryDetails(details) } : result;
  }
  const response = await withCache("multicity", spec, resolveCacheOptions(opts), () =>
    runMultiCity(spec, { headful: opts.headful }),
  );
  return normalize(response, opts.limit);
}

/** Parses `--leg ORIGIN:DEST:DATE` flags into slices; `--routing`/`--ext` apply to all. */
export function parseLegs(opts: MultiCityCommandOptions): Slice[] {
  if (!opts.legs || opts.legs.length < 2) {
    throw new Error("multicity needs at least 2 --leg ORIGIN:DEST:DATE values");
  }
  return opts.legs.map((raw, i) => toSlice(raw, i, opts));
}

/**
 * Parses one `ORIGIN:DEST:DATE[:BASIS]` leg, applying shared routing/ext, into a
 * Slice. The optional 4th field sets that leg's date basis (`depart`|`arrive`).
 */
function toSlice(raw: string, index: number, opts: MultiCityCommandOptions): Slice {
  const parts = raw.split(":");
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(
      `--leg #${index + 1} must be ORIGIN:DEST:YYYY-MM-DD[:depart|arrive], got "${raw}"`,
    );
  }
  const origin = parts[0]!.trim();
  const dest = parts[1]!.trim();
  const date = parts[2]!.trim();
  if (!origin || !dest) {
    throw new Error(`--leg #${index + 1} is missing an origin or destination`);
  }
  requireIsoDate(date, `--leg #${index + 1} date`);
  return {
    origin: origin.toUpperCase(),
    dest: dest.toUpperCase(),
    departDate: date,
    dateBasis: requireDateBasis(parts[3]?.trim(), `--leg #${index + 1} basis`),
    routing: opts.routing,
    ext: opts.ext,
  };
}
