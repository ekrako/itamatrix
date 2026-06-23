import { z } from "zod";

/**
 * Zod schemas for the subset of the `/v1/search` response that P1 consumes.
 *
 * Derived from `fixtures/result_full.json`. The live schema is far larger; we
 * parse leniently (`.passthrough()` on objects, optional facets) so unrelated
 * schema drift in fields we ignore never fails a search.
 */

export const PlaceSchema = z
  .object({
    code: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

export const CarrierSchema = z
  .object({
    code: z.string(),
    shortName: z.string().optional(),
  })
  .passthrough();

export const SliceSchema = z
  .object({
    origin: PlaceSchema,
    destination: PlaceSchema,
    departure: z.string(),
    arrival: z.string(),
    flights: z.array(z.string()).default([]),
    cabins: z.array(z.string()).default([]),
    duration: z.number().optional(),
    ext: z
      .object({
        warnings: z
          .object({ types: z.array(z.string()).default([]) })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const ItinerarySchema = z
  .object({
    slices: z.array(SliceSchema),
    carriers: z.array(CarrierSchema).default([]),
    distance: z
      .object({ units: z.string(), value: z.number() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const SolutionSchema = z
  .object({
    id: z.string(),
    displayTotal: z.string(),
    passengerCount: z.number().optional(),
    itinerary: ItinerarySchema,
    ext: z
      .object({
        price: z.string().optional(),
        pricePerMile: z.string().optional(),
        totalPrice: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const SolutionListSchema = z
  .object({
    solutions: z.array(SolutionSchema).default([]),
    minPrice: z.string().optional(),
    solutionCount: z.number().optional(),
    pages: z
      .object({ count: z.number(), current: z.number() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const SearchResponseSchema = z
  .object({
    solutionList: SolutionListSchema,
    solutionCount: z.number().optional(),
  })
  .passthrough();

export type Place = z.infer<typeof PlaceSchema>;
export type Carrier = z.infer<typeof CarrierSchema>;
export type Slice = z.infer<typeof SliceSchema>;
export type Solution = z.infer<typeof SolutionSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** The raw `/v1/search` body wraps the payload under `response`. */
export function parseSearchResponse(raw: unknown): SearchResponse {
  return SearchResponseSchema.parse(unwrapResponse(raw));
}

/**
 * The price-calendar response shape is unconfirmed (no fixture — DESIGN P3), so
 * we keep it as an opaque record and let `normalizeCalendar` deep-scan for
 * date→price pairs. Parsing only unwraps the `response` envelope and asserts an
 * object, surfacing a clear error if the body is not what we expect.
 */
export type CalendarResponse = Record<string, unknown>;

export function parseCalendarResponse(raw: unknown): CalendarResponse {
  const root = unwrapResponse(raw);
  if (!root || typeof root !== "object") {
    throw new Error("Calendar response was not a JSON object");
  }
  return root as CalendarResponse;
}

function unwrapResponse(raw: unknown): unknown {
  return raw && typeof raw === "object" && "response" in raw
    ? (raw as { response: unknown }).response
    : raw;
}
