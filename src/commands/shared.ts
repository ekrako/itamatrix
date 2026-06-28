import {
  CABIN_LABELS,
  DATE_BASIS_LABELS,
  STOPS_LABELS,
  type Cabin,
  type DateBasis,
  type StopLimit,
} from "../model/spec.js";
import { collectFareConstruction } from "../model/types.js";
import { DEFAULT_CACHE_TTL_MINUTES, type CacheOptions } from "../cache.js";
import type { DetailCapture } from "../browser/session.js";
import type { ItineraryDetails } from "../render/normalize.js";

export type OutputFormat = "table" | "json";

/** Cache controls shared by every command (`--no-cache`, `--cache-ttl`). */
export interface CacheControlOptions {
  /** Default true; `--no-cache` sets it false. */
  cache?: boolean;
  /** TTL in minutes; defaults to {@link DEFAULT_CACHE_TTL_MINUTES}. */
  cacheTtlMinutes?: number;
}

export function resolveCacheOptions(opts: CacheControlOptions): CacheOptions {
  const minutes = opts.cacheTtlMinutes ?? DEFAULT_CACHE_TTL_MINUTES;
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("--cache-ttl must be a number >= 0 (minutes)");
  }
  return { enabled: opts.cache !== false, ttlMs: minutes * 60_000 };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The driver reads a single Matrix results page; pagination isn't driven, so a
 * `--limit` above the page size can't be honored. Cap it instead of silently
 * returning fewer results than asked. (Multi-page fetch is future work.)
 */
export const MAX_LIMIT = 25;
export const CABINS = Object.keys(CABIN_LABELS) as Cabin[];
export const STOPS = Object.keys(STOPS_LABELS) as StopLimit[];
export const DATE_BASES = Object.keys(DATE_BASIS_LABELS) as DateBasis[];

/** Validates a date-basis flag value, returning it typed; undefined passes through. */
export function requireDateBasis(value: string | undefined, flag: string): DateBasis | undefined {
  if (value === undefined) return undefined;
  if (!DATE_BASES.includes(value as DateBasis)) {
    throw new Error(`${flag} must be one of ${DATE_BASES.join(", ")}, got "${value}"`);
  }
  return value as DateBasis;
}

/** Shared cabin/stops/extra-stops/adults/limit validation across all commands. */
export interface TripControlOptions {
  adults: number;
  limit: number;
  cabin?: string;
  stops?: string;
  extraStops?: string;
}

export function validateTripControls(opts: TripControlOptions): void {
  if (!Number.isInteger(opts.adults) || opts.adults < 1) {
    throw new Error("--adults must be an integer >= 1");
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1) {
    throw new Error("--limit must be an integer >= 1");
  }
  if (opts.cabin && !CABINS.includes(opts.cabin as Cabin)) {
    throw new Error(`--cabin must be one of ${CABINS.join(", ")}, got "${opts.cabin}"`);
  }
  if (opts.stops && !STOPS.includes(opts.stops as StopLimit)) {
    throw new Error(`--stops must be one of ${STOPS.join(", ")}, got "${opts.stops}"`);
  }
  if (opts.extraStops && !STOPS.includes(opts.extraStops as StopLimit)) {
    throw new Error(
      `--extra-stops must be one of ${STOPS.join(", ")}, got "${opts.extraStops}"`,
    );
  }
}

/**
 * Reject a page-size `--limit` above {@link MAX_LIMIT}. Used by the page-based
 * commands (search, multicity); calendar's `--limit` is a display cap, not a page
 * size, so it does not call this.
 */
export function requirePageLimit(limit: number): void {
  if (limit > MAX_LIMIT) {
    throw new Error(
      `--limit cannot exceed ${MAX_LIMIT} (one Matrix results page; pagination is not yet supported)`,
    );
  }
}

/**
 * `--carriers UA,AA` → `(UA,AA)+`: one or more segments on *any* listed carrier.
 * The alternatives must be grouped before the `+` repeat operator, otherwise ITA
 * reads `UA,AA+` as "a single UA segment, or one-or-more AA segments", which
 * drops valid connecting itineraries (e.g. all-UA multi-leg). Returns undefined
 * when no carriers are given.
 */
export function carriersToRouting(carriers?: string): string | undefined {
  if (!carriers) return undefined;
  const codes = carriers
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length) return undefined;
  return codes.length === 1 ? `${codes[0]}+` : `(${codes.join(",")})+`;
}

/** Shapes a browser-captured top-result detail into the flat render view. */
export function toItineraryDetails(capture: DetailCapture): ItineraryDetails {
  return {
    fareConstruction: collectFareConstruction(capture.bookingDetails),
    googleFlightsUrl: capture.googleFlightsUrl,
  };
}

export function requireIsoDate(value: string, flag: string): void {
  if (!DATE_RE.test(value) || !isRealCalendarDate(value)) {
    throw new Error(`${flag} must be a valid date (YYYY-MM-DD), got "${value}"`);
  }
}

/** True only for an existing calendar date — rejects e.g. 2026-13-99, 2026-02-31. */
function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
