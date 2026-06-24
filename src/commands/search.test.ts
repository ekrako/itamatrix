import { describe, it, expect, vi } from "vitest";
import { resolveRouting, runSearchCommand, type SearchCommandOptions } from "./search.js";
import type { SearchSpec } from "../model/spec.js";

const captured: SearchSpec[] = [];
const detailsCaptured: SearchSpec[] = [];
vi.mock("../browser/session.js", () => ({
  runSearch: (spec: SearchSpec) => {
    captured.push(spec);
    return Promise.resolve({ solutionList: { solutions: [] } });
  },
  runSearchWithDetails: (spec: SearchSpec) => {
    detailsCaptured.push(spec);
    return Promise.resolve({
      search: { solutionList: { solutions: [] } },
      details: {
        bookingDetails: {
          tickets: [{ pricings: [{ fareCalculations: [{ lines: ["BOS UA LON 1 NUC 1"] }] }] }],
        },
        googleFlightsUrl: "https://www.google.com/travel/flights?tfs=Z&source=ita_matrix",
      },
    });
  },
}));

const opts = (over: Partial<SearchCommandOptions> = {}): SearchCommandOptions => ({
  depart: "2026-08-10",
  adults: 1,
  limit: 25,
  format: "json",
  cache: false,
  ...over,
});

// These all fail validation before any browser launch, so they stay deterministic.
describe("runSearchCommand validation", () => {
  it("rejects a missing origin/destination", async () => {
    await expect(runSearchCommand("", "LAX", opts())).rejects.toThrow(/required/);
  });

  it("rejects a malformed --depart", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ depart: "08-10-2026" })),
    ).rejects.toThrow(/--depart must be a valid date/);
  });

  it("rejects a malformed --return", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ return: "2026/08/17" })),
    ).rejects.toThrow(/--return must be a valid date/);
  });

  it("rejects an impossible calendar date", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ depart: "2026-13-99" })),
    ).rejects.toThrow(/--depart must be a valid date/);
  });

  it("rejects a --return earlier than --depart", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ return: "2026-08-01" })),
    ).rejects.toThrow(/--return must be on or after --depart/);
  });

  it("rejects adults < 1", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ adults: 0 })),
    ).rejects.toThrow(/--adults must be an integer >= 1/);
  });

  it("rejects a non-numeric --adults (NaN) before launching the browser", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ adults: NaN })),
    ).rejects.toThrow(/--adults must be an integer >= 1/);
  });

  it("rejects an invalid --limit", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ limit: 0 })),
    ).rejects.toThrow(/--limit must be an integer >= 1/);
  });

  it("rejects a --limit above the single-page maximum", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ limit: 50 })),
    ).rejects.toThrow(/--limit cannot exceed 25/);
  });

  it("ignores a malformed --return when --one-way is set", async () => {
    const out = await runSearchCommand(
      "BOS",
      "LAX",
      opts({ return: "not-a-date", oneWay: true }),
    );
    expect(out).toContain("\"solutions\"");
  });

  it("rejects an unknown --cabin", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ cabin: "economy" })),
    ).rejects.toThrow(/--cabin must be one of/);
  });

  it("rejects an unknown --stops", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ stops: "3" })),
    ).rejects.toThrow(/--stops must be one of/);
  });

  it("rejects an unknown --extra-stops", async () => {
    await expect(
      runSearchCommand("BOS", "LAX", opts({ extraStops: "lots" })),
    ).rejects.toThrow(/--extra-stops must be one of/);
  });
});

describe("resolveRouting (--carriers sugar)", () => {
  it("turns multiple --carriers into a grouped OR'd routing code", () => {
    expect(resolveRouting({ carriers: "ua,aa" } as SearchCommandOptions)).toBe("(UA,AA)+");
  });

  it("does not group a single carrier", () => {
    expect(resolveRouting({ carriers: "ua" } as SearchCommandOptions)).toBe("UA+");
  });

  it("lets explicit --routing win over --carriers", () => {
    expect(
      resolveRouting({ carriers: "UA,AA", routing: "X:DFW" } as SearchCommandOptions),
    ).toBe("X:DFW");
  });

  it("trims whitespace and drops empties between carriers", () => {
    expect(resolveRouting({ carriers: " ua , , aa " } as SearchCommandOptions)).toBe(
      "(UA,AA)+",
    );
  });

  it("is undefined for an all-empty --carriers", () => {
    expect(resolveRouting({ carriers: " , " } as SearchCommandOptions)).toBeUndefined();
  });

  it("is undefined when neither is given", () => {
    expect(resolveRouting({} as SearchCommandOptions)).toBeUndefined();
  });
});

describe("runSearchCommand spec wiring", () => {
  const opts = (over: Partial<SearchCommandOptions> = {}): SearchCommandOptions => ({
    depart: "2026-08-10",
    adults: 1,
    limit: 25,
    format: "json",
    cache: false,
    ...over,
  });

  it("passes advanced controls and uppercases airports", async () => {
    captured.length = 0;
    await runSearchCommand("bos", "lax", opts({ cabin: "business", stops: "1", ext: "-REDEYES" }));
    expect(captured[0]).toMatchObject({
      origin: "BOS",
      dest: "LAX",
      cabin: "business",
      stops: "1",
      ext: "-REDEYES",
    });
  });

  it("folds --carriers into the routing field", async () => {
    captured.length = 0;
    await runSearchCommand("BOS", "LAX", opts({ carriers: "UA,AA" }));
    expect(captured[0]!.routing).toBe("(UA,AA)+");
  });

  it("drops the return date when --one-way is set", async () => {
    captured.length = 0;
    await runSearchCommand("BOS", "LAX", opts({ return: "2026-08-17", oneWay: true }));
    expect(captured[0]!.returnDate).toBeUndefined();
  });

  it("with --details, routes through the live path and folds in fare construction + GF link", async () => {
    detailsCaptured.length = 0;
    const out = await runSearchCommand("BOS", "LAX", opts({ details: true, format: "json" }));
    expect(detailsCaptured).toHaveLength(1);
    const parsed = JSON.parse(out);
    expect(parsed.details.fareConstruction).toEqual(["BOS UA LON 1 NUC 1"]);
    expect(parsed.details.googleFlightsUrl).toContain("google.com/travel/flights");
  });

  it("leaves advanced controls undefined when unset", async () => {
    captured.length = 0;
    await runSearchCommand("BOS", "LAX", opts());
    const s = captured[0]!;
    expect([s.cabin, s.stops, s.extraStops, s.routing, s.ext]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
