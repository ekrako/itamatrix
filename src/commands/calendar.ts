import { runCalendar } from "../browser/session.js";
import { withCache } from "../cache.js";
import {
  normalizeCalendar,
  renderCalendarJson,
  renderCalendarTable,
} from "../render/calendar.js";
import { type Cabin, type CalendarSpec, type StopLimit } from "../model/spec.js";
import {
  requireDateBasis,
  requireIsoDate,
  resolveCacheOptions,
  validateTripControls,
  type CacheControlOptions,
  type OutputFormat,
} from "./shared.js";

export interface CalendarCommandOptions extends CacheControlOptions {
  departRange: string; // "YYYY-MM-DD:YYYY-MM-DD"
  tripLength?: number;
  dateBasis?: string;
  returnDateBasis?: string;
  adults: number;
  limit: number;
  cabin?: string;
  stops?: string;
  extraStops?: string;
  routing?: string;
  ext?: string;
  format: OutputFormat;
  headful?: boolean;
}

export async function runCalendarCommand(
  origin: string,
  dest: string,
  opts: CalendarCommandOptions,
): Promise<string> {
  const { from, to } = parseDepartRange(opts.departRange);
  validate(origin, dest, opts, from, to);

  const spec: CalendarSpec = {
    origin: origin.toUpperCase(),
    dest: dest.toUpperCase(),
    departFrom: from,
    departTo: to,
    tripLength: opts.tripLength,
    dateBasis: requireDateBasis(opts.dateBasis, "--date-basis"),
    returnDateBasis: requireDateBasis(opts.returnDateBasis, "--return-date-basis"),
    adults: opts.adults,
    limit: opts.limit,
    cabin: opts.cabin as Cabin | undefined,
    stops: opts.stops as StopLimit | undefined,
    extraStops: opts.extraStops as StopLimit | undefined,
    routing: opts.routing,
    ext: opts.ext,
  };

  const response = await withCache("calendar", spec, resolveCacheOptions(opts), () =>
    runCalendar(spec, { headful: opts.headful }),
  );
  const cal = normalizeCalendar(response, opts.limit);
  return opts.format === "json" ? renderCalendarJson(cal) : renderCalendarTable(cal);
}

export function parseDepartRange(range: string): { from: string; to: string } {
  const parts = (range ?? "").split(":");
  if (parts.length !== 2) {
    throw new Error(
      `--depart-range must be START:END (YYYY-MM-DD:YYYY-MM-DD), got "${range}"`,
    );
  }
  const from = parts[0]!.trim();
  const to = parts[1]!.trim();
  requireIsoDate(from, "--depart-range start");
  requireIsoDate(to, "--depart-range end");
  return { from, to };
}

function validate(
  origin: string,
  dest: string,
  opts: CalendarCommandOptions,
  from: string,
  to: string,
): void {
  if (!origin || !dest) throw new Error("origin and destination are required");
  if (from > to) throw new Error("--depart-range start must be on or before end");
  if (opts.tripLength != null && (!Number.isInteger(opts.tripLength) || opts.tripLength < 0)) {
    throw new Error("--trip-length must be an integer >= 0");
  }
  validateTripControls(opts);
}
