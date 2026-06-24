import type { SearchResponse, Solution } from "../model/types.js";

/** Flat, agent-friendly view of a single itinerary. */
export interface FlatSlice {
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  flights: string[];
  carrier?: string;
  stops: number;
  durationMinutes?: number;
  warnings: string[];
}

export interface FlatSolution {
  id: string;
  total: string;
  pricePerMile?: string;
  carriers: string[];
  slices: FlatSlice[];
}

/**
 * Per-itinerary detail surfaced by `--details` (fetched only for the top result).
 * `fareConstruction` is ITA's NUC breakdown ("can be useful to travel agents");
 * `googleFlightsUrl` is the detail page's "Open in Google Flights" deep link.
 */
export interface ItineraryDetails {
  fareConstruction: string[];
  googleFlightsUrl?: string;
}

export interface FlatResult {
  count: number;
  shown: number;
  minPrice?: string;
  solutions: FlatSolution[];
  details?: ItineraryDetails;
}

/**
 * IATA carrier codes are two characters and may contain a digit (e.g. JetBlue
 * `B6`), so take the leading two-char code rather than stripping all digits.
 */
function parseCarrier(flight?: string): string | undefined {
  return flight?.match(/^[A-Z0-9]{2}/)?.[0];
}

function flattenSolution(sol: Solution): FlatSolution {
  const slices: FlatSlice[] = sol.itinerary.slices.map((s) => ({
    origin: s.origin.code,
    destination: s.destination.code,
    departure: s.departure,
    arrival: s.arrival,
    flights: s.flights,
    carrier: parseCarrier(s.flights[0]),
    stops: Math.max(0, s.flights.length - 1),
    durationMinutes: s.duration,
    warnings: s.ext?.warnings?.types ?? [],
  }));

  return {
    id: sol.id,
    total: sol.displayTotal,
    pricePerMile: sol.ext?.pricePerMile,
    carriers: sol.itinerary.carriers.map((c) => c.code),
    slices,
  };
}

/**
 * `limit` caps how many solutions are returned. Matrix paginates server-side
 * (default 25); we can't reliably drive its page-size control, so we slice the
 * returned page here to honor `--limit` consistently across commands.
 */
export function normalize(resp: SearchResponse, limit?: number): FlatResult {
  const list = resp.solutionList;
  const all = list.solutions.map(flattenSolution);
  const solutions = limit != null ? all.slice(0, limit) : all;
  return {
    count: list.solutionCount ?? resp.solutionCount ?? all.length,
    shown: solutions.length,
    minPrice: list.minPrice,
    solutions,
  };
}
