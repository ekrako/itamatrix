import { describe, it, expect } from "vitest";
import {
  CABIN_LABELS,
  EXTRA_STOPS_LABELS,
  STOPS_LABELS,
  hasAdvancedControls,
  isRoundTrip,
  type SearchSpec,
} from "./spec.js";

const base: SearchSpec = {
  origin: "BOS",
  dest: "LAX",
  departDate: "2026-08-10",
  adults: 1,
  limit: 25,
};

describe("isRoundTrip", () => {
  it("is false without a return date", () => {
    expect(isRoundTrip(base)).toBe(false);
  });

  it("is true with a return date", () => {
    expect(isRoundTrip({ ...base, returnDate: "2026-08-17" })).toBe(true);
  });
});

describe("hasAdvancedControls", () => {
  it("is false for a bare spec", () => {
    expect(hasAdvancedControls(base)).toBe(false);
  });

  it("is true when any advanced control is set", () => {
    expect(hasAdvancedControls({ ...base, cabin: "business" })).toBe(true);
    expect(hasAdvancedControls({ ...base, stops: "none" })).toBe(true);
    expect(hasAdvancedControls({ ...base, routing: "UA+" })).toBe(true);
    expect(hasAdvancedControls({ ...base, ext: "-OVERNIGHTS" })).toBe(true);
  });
});

describe("Matrix dropdown label maps", () => {
  it("covers every cabin value with the live option label", () => {
    expect(CABIN_LABELS).toEqual({
      cheapest: "Cheapest available",
      "premium-economy": "Premium Economy",
      business: "Business class or higher",
      first: "First class",
    });
  });

  it("covers every stops value", () => {
    expect(STOPS_LABELS).toEqual({
      any: "No limit",
      none: "Nonstop only",
      "1": "Up to 1 stop",
      "2": "Up to 2 stops",
    });
  });

  it("covers every extra-stops value", () => {
    expect(EXTRA_STOPS_LABELS).toEqual({
      any: "No limit",
      none: "No extra stops",
      "1": "Up to 1 extra stop",
      "2": "Up to 2 extra stops",
    });
  });
});
