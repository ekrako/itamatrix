import { describe, it, expect, vi } from "vitest";
import {
  parseLegs,
  runMultiCityCommand,
  type MultiCityCommandOptions,
} from "./multicity.js";
import type { MultiCitySpec } from "../model/spec.js";

const captured: MultiCitySpec[] = [];
vi.mock("../browser/session.js", () => ({
  runMultiCity: (spec: MultiCitySpec) => {
    captured.push(spec);
    return Promise.resolve({ solutionList: { solutions: [] } });
  },
}));

const opts = (over: Partial<MultiCityCommandOptions> = {}): MultiCityCommandOptions => ({
  legs: ["JFK:NRT:2026-08-10", "NRT:SIN:2026-08-15"],
  adults: 1,
  limit: 25,
  format: "json",
  cache: false,
  ...over,
});

describe("parseLegs", () => {
  it("parses and uppercases ORIGIN:DEST:DATE legs", () => {
    const slices = parseLegs(opts({ legs: ["jfk:nrt:2026-08-10", "nrt:sin:2026-08-15"] }));
    expect(slices).toEqual([
      { origin: "JFK", dest: "NRT", departDate: "2026-08-10", routing: undefined, ext: undefined },
      { origin: "NRT", dest: "SIN", departDate: "2026-08-15", routing: undefined, ext: undefined },
    ]);
  });

  it("applies global --routing/--ext to every leg", () => {
    const slices = parseLegs(opts({ routing: "UA+", ext: "-REDEYES" }));
    expect(slices.every((s) => s.routing === "UA+" && s.ext === "-REDEYES")).toBe(true);
  });

  it("rejects fewer than 2 legs", () => {
    expect(() => parseLegs(opts({ legs: ["JFK:NRT:2026-08-10"] }))).toThrow(/at least 2/);
  });

  it("rejects a leg without three colon-separated parts", () => {
    expect(() => parseLegs(opts({ legs: ["JFK-NRT", "NRT:SIN:2026-08-15"] }))).toThrow(
      /ORIGIN:DEST/,
    );
  });

  it("parses an optional 4th basis field per leg", () => {
    const slices = parseLegs(
      opts({ legs: ["JFK:NRT:2026-08-10:arrive", "NRT:SIN:2026-08-15"] }),
    );
    expect(slices.map((s) => s.dateBasis)).toEqual(["arrive", undefined]);
  });

  it("rejects an unknown leg basis", () => {
    expect(() =>
      parseLegs(opts({ legs: ["JFK:NRT:2026-08-10:landing", "NRT:SIN:2026-08-15"] })),
    ).toThrow(/basis must be one of/);
  });

  it("rejects a leg with a malformed date", () => {
    expect(() =>
      parseLegs(opts({ legs: ["JFK:NRT:08/10", "NRT:SIN:2026-08-15"] })),
    ).toThrow(/must be a valid date/);
  });
});

describe("runMultiCityCommand spec wiring", () => {
  it("builds an N-slice spec with shared controls", async () => {
    captured.length = 0;
    await runMultiCityCommand(opts({ cabin: "business", stops: "1" }));
    expect(captured[0]).toMatchObject({
      cabin: "business",
      stops: "1",
      slices: [{ origin: "JFK" }, { origin: "NRT" }],
    });
  });

  it("rejects an unknown --cabin before launching the browser", async () => {
    await expect(runMultiCityCommand(opts({ cabin: "economy" }))).rejects.toThrow(
      /--cabin must be one of/,
    );
  });
});
