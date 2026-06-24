import { describe, it, expect } from "vitest";
import { parseSearchResponse } from "../model/types.js";
import { normalize } from "./normalize.js";
import { renderJson } from "./json.js";
import { renderTable } from "./table.js";

const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\[[0-9;]*m/g, "");

/** Minimal hand-built `/v1/search`-shaped payload exercising normalize edges. */
const payload = {
  solutionList: {
    minPrice: "USD200.00",
    solutionCount: 3,
    pages: { count: 1, current: 1 },
    solutions: [
      {
        id: "A1",
        displayTotal: "USD200.00",
        ext: { pricePerMile: "USD0.05" },
        itinerary: {
          carriers: [{ code: "DL" }],
          slices: [
            {
              origin: { code: "JFK" },
              destination: { code: "SFO" },
              departure: "2026-08-10T08:00-04:00",
              arrival: "2026-08-10T14:30-07:00",
              flights: ["DL100", "DL200"], // 1 stop
              cabins: ["COACH"],
              duration: 390,
              ext: { warnings: { types: ["OVERNIGHT"] } },
            },
          ],
        },
      },
      {
        id: "A2",
        displayTotal: "USD250.00",
        itinerary: {
          carriers: [],
          slices: [
            {
              origin: { code: "JFK" },
              destination: { code: "SFO" },
              departure: "2026-08-10T09:00-04:00",
              arrival: "2026-08-10T12:30-07:00",
              flights: [], // no flights → no carrier, 0 stops
              cabins: [],
            },
          ],
        },
      },
    ],
  },
};

describe("normalize edges", () => {
  const result = normalize(parseSearchResponse(payload));

  it("counts stops from segment count", () => {
    expect(result.solutions[0]!.slices[0]!.stops).toBe(1);
  });

  it("derives carrier from the first flight number", () => {
    expect(result.solutions[0]!.slices[0]!.carrier).toBe("DL");
  });

  it("keeps the two-char code for alphanumeric carriers (e.g. B6287 → B6)", () => {
    const payload = parseSearchResponse({
      solutionList: {
        solutions: [
          {
            id: "x",
            displayTotal: "USD100",
            itinerary: {
              carriers: [{ code: "B6" }],
              slices: [
                {
                  origin: { code: "BOS" },
                  destination: { code: "JFK" },
                  departure: "2026-08-10T08:00",
                  arrival: "2026-08-10T09:30",
                  flights: ["B6287"],
                },
              ],
            },
          },
        ],
        solutionCount: 1,
      },
    });
    expect(normalize(payload).solutions[0]!.slices[0]!.carrier).toBe("B6");
  });

  it("handles a slice with no flights", () => {
    const s = result.solutions[1]!.slices[0]!;
    expect(s.stops).toBe(0);
    expect(s.carrier).toBeUndefined();
  });

  it("surfaces count and minPrice", () => {
    expect(result.count).toBe(3);
    expect(result.shown).toBe(2);
    expect(result.minPrice).toBe("USD200.00");
  });

  it("caps shown solutions at limit while keeping the full count", () => {
    const capped = normalize(parseSearchResponse(payload), 1);
    expect(capped.solutions).toHaveLength(1);
    expect(capped.shown).toBe(1);
    expect(capped.count).toBe(3);
  });
});

describe("renderJson", () => {
  it("round-trips through JSON.parse", () => {
    const result = normalize(parseSearchResponse(payload));
    const parsed = JSON.parse(renderJson(result));
    expect(parsed.solutions).toHaveLength(2);
    expect(parsed.solutions[0].total).toBe("USD200.00");
  });
});

describe("renderTable", () => {
  it("renders prices, routes and warnings", () => {
    const out = stripAnsi(renderTable(normalize(parseSearchResponse(payload))));
    expect(out).toContain("USD200.00");
    expect(out).toContain("JFK→SFO");
    expect(out).toContain("1 stop");
    expect(out).toContain("OVERNIGHT");
    expect(out).toContain("2 of 3 results");
  });

  it("reports an empty result set", () => {
    const empty = normalize(parseSearchResponse({ solutionList: { solutions: [] } }));
    expect(stripAnsi(renderTable(empty))).toMatch(/No flights found/);
  });

  it("appends a fare-construction + Google Flights footer when details are present", () => {
    const result = {
      ...normalize(parseSearchResponse(payload)),
      details: {
        fareConstruction: ["BOS B6 LON 70.00 NUC 70.00 END ROE 1.00"],
        googleFlightsUrl: "https://www.google.com/travel/flights?tfs=ABC&source=ita_matrix",
      },
    };
    const out = stripAnsi(renderTable(result));
    expect(out).toContain("Fare Construction (can be useful to travel agents):");
    expect(out).toContain("BOS B6 LON 70.00 NUC 70.00 END ROE 1.00");
    expect(out).toContain("Open in Google Flights: https://www.google.com/travel/flights?tfs=ABC");
  });

  it("omits the footer when there are no details", () => {
    const out = stripAnsi(renderTable(normalize(parseSearchResponse(payload))));
    expect(out).not.toContain("Fare Construction");
  });
});
