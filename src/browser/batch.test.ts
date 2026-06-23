import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractCalendarPayload, extractSearchPayload } from "./batch.js";
import { parseSearchResponse } from "../model/types.js";

const batchBody = readFileSync(
  fileURLToPath(new URL("../../fixtures/batch_multipart.txt", import.meta.url)),
  "utf8",
);

describe("extractSearchPayload", () => {
  it("pulls the solutionList payload out of a multipart /batch body", () => {
    const payload = extractSearchPayload(batchBody);
    expect(payload).not.toBeNull();
    const resp = parseSearchResponse(payload);
    expect(resp.solutionList.solutions.length).toBeGreaterThan(0);
  });

  it("returns null when no part carries a solutionList", () => {
    expect(extractSearchPayload('--b\r\n\r\n{"foo":1}\r\n--b--')).toBeNull();
  });

  it("skips earlier non-result parts and finds a later solutionList", () => {
    const body =
      '--b\r\n\r\n{"airports":["a"]}\r\n' +
      '--b\r\n\r\n{"solutionList":{"solutions":[{"id":"X","displayTotal":"USD1","itinerary":{"slices":[]}}]}}\r\n--b--';
    const payload = extractSearchPayload(body) as { solutionList: { solutions: unknown[] } };
    expect(payload.solutionList.solutions).toHaveLength(1);
  });

  it("ignores a brace inside a JSON string without misparsing", () => {
    const body = '--b\r\n\r\n{"note":"a } brace","solutionList":{"solutions":[]}}\r\n--b--';
    expect(extractSearchPayload(body)).not.toBeNull();
  });
});

describe("extractCalendarPayload", () => {
  it("pulls a part carrying a calendar key out of a /batch body", () => {
    const body =
      '--b\r\n\r\n{"solutionList":{"solutions":[]}}\r\n' +
      '--b\r\n\r\n{"response":{"calendarSliceList":{"days":[]}}}\r\n--b--';
    expect(extractCalendarPayload(body)).not.toBeNull();
  });

  it("returns null when no part has a calendar-shaped payload", () => {
    expect(extractCalendarPayload('--b\r\n\r\n{"solutionList":{}}\r\n--b--')).toBeNull();
  });
});
