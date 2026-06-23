import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSearchResponse } from "./types.js";
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
