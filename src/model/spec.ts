/** Normalized search request the CLI builds and the browser driver consumes. */
export interface SearchSpec {
  origin: string;
  dest: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD; present => round-trip
  adults: number;
  /** Matrix page size; defaults to 25 (Matrix default). */
  limit: number;
  /** Advanced controls (P2). Omitted fields keep Matrix defaults. */
  cabin?: Cabin;
  stops?: StopLimit;
  extraStops?: StopLimit;
  /** ITA routing codes (the flight path) — see docs/ROUTING_CODES.md. */
  routing?: string;
  /** ITA extension codes (faring & filters) — see docs/ROUTING_CODES.md. */
  ext?: string;
}

/** One leg of a multi-city trip. Routing/ext are per-slice in Matrix. */
export interface Slice {
  origin: string;
  dest: string;
  departDate: string; // YYYY-MM-DD
  routing?: string;
  ext?: string;
}

/** Shared advanced controls applied to a whole trip (P3 multicity/calendar). */
export interface TripOptions {
  adults: number;
  limit: number;
  cabin?: Cabin;
  stops?: StopLimit;
  extraStops?: StopLimit;
}

/** Multi-city request: N independent legs (DESIGN P3). */
export interface MultiCitySpec extends TripOptions {
  slices: Slice[];
}

/**
 * Price-calendar request: lowest fare per departure date across a range, for a
 * fixed trip length (DESIGN P3, "See calendar of lowest fares").
 */
export interface CalendarSpec extends TripOptions {
  origin: string;
  dest: string;
  departFrom: string; // YYYY-MM-DD, inclusive
  departTo: string; // YYYY-MM-DD, inclusive
  /** Nights between departure and return; omit for one-way calendar. */
  tripLength?: number;
  routing?: string;
  ext?: string;
}

export type Cabin = "cheapest" | "premium-economy" | "business" | "first";
export type StopLimit = "any" | "none" | "1" | "2";

/** Matrix Cabin dropdown option labels, keyed by CLI value. */
export const CABIN_LABELS: Record<Cabin, string> = {
  cheapest: "Cheapest available",
  "premium-economy": "Premium Economy",
  business: "Business class or higher",
  first: "First class",
};

/** Matrix Stops dropdown option labels, keyed by CLI value. */
export const STOPS_LABELS: Record<StopLimit, string> = {
  any: "No limit",
  none: "Nonstop only",
  "1": "Up to 1 stop",
  "2": "Up to 2 stops",
};

/** Matrix Extra stops dropdown option labels, keyed by CLI value. */
export const EXTRA_STOPS_LABELS: Record<StopLimit, string> = {
  any: "No limit",
  none: "No extra stops",
  "1": "Up to 1 extra stop",
  "2": "Up to 2 extra stops",
};

export function isRoundTrip(spec: SearchSpec): boolean {
  return Boolean(spec.returnDate);
}

/** True when any advanced control is set and the panel must be expanded. */
export function hasAdvancedControls(spec: SearchSpec): boolean {
  return Boolean(spec.cabin || spec.stops || spec.extraStops || spec.routing || spec.ext);
}
