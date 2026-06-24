import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectFareConstruction,
  parseBookingDetails,
  parseSearchResponse,
} from "./types.js";
import { extractBookingDetailsPayload } from "../browser/batch.js";
import { normalize } from "../render/normalize.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../fixtures/result_full.json", import.meta.url)), "utf8"),
);

describe("parseSearchResponse", () => {
  it("parses the live fixture without throwing", () => {
    const resp = parseSearchResponse(fixture);
    expect(resp.solutionList.solutions.length).toBe(25);
    expect(resp.solutionList.solutionCount).toBe(32);
  });

  it("parses a payload wrapped under `response`", () => {
    const resp = parseSearchResponse({ response: fixture });
    expect(resp.solutionList.solutions.length).toBe(25);
  });
});

const bookingFixture = readFileSync(
  fileURLToPath(new URL("../../fixtures/booking_details_multipart.txt", import.meta.url)),
  "utf8",
);

describe("collectFareConstruction", () => {
  it("pulls the NUC fare-construction lines out of the live detail fixture", () => {
    const details = parseBookingDetails(extractBookingDetailsPayload(bookingFixture));
    const lines = collectFareConstruction(details);
    expect(lines).toEqual([
      "BOS B6 LON 70.00OL8LBVL1 NUC 70.00 END ROE 1.00 XT 23.40US 5.60AY 250.00YR 4.50XF BOS4.50",
    ]);
  });

  it("dedupes repeated lines and ignores non-fareCalculations `lines`", () => {
    const node = {
      lines: ["NOT A FARE"],
      tickets: [
        { pricings: [{ fareCalculations: [{ lines: ["A NUC 1"] }, { lines: ["A NUC 1"] }] }] },
      ],
    };
    expect(collectFareConstruction(node)).toEqual(["A NUC 1"]);
  });

  it("returns an empty array when there is no fare construction", () => {
    expect(collectFareConstruction({ foo: { bar: [1, 2] } })).toEqual([]);
  });
});

describe("normalize", () => {
  it("flattens solutions into an agent-friendly shape", () => {
    const result = normalize(parseSearchResponse(fixture));
    expect(result.count).toBe(32);
    expect(result.shown).toBe(25);
    expect(result.minPrice).toBe("USD440.00");

    const first = result.solutions[0]!;
    expect(first.total).toBe("USD439.81");
    expect(first.slices).toHaveLength(2);
    expect(first.slices[0]!.origin).toBe("BOS");
    expect(first.slices[0]!.destination).toBe("LAX");
    expect(first.slices[0]!.flights).toEqual(["UA360"]);
    expect(first.slices[0]!.stops).toBe(0);
    expect(first.slices[0]!.carrier).toBe("UA");
    expect(first.slices[1]!.warnings).toContain("OVERNIGHT");
  });
});
