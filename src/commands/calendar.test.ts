import { describe, it, expect, vi } from "vitest";
import {
  parseDepartRange,
  runCalendarCommand,
  type CalendarCommandOptions,
} from "./calendar.js";
import type { CalendarSpec } from "../model/spec.js";

const captured: CalendarSpec[] = [];
vi.mock("../browser/session.js", () => ({
  runCalendar: (spec: CalendarSpec) => {
    captured.push(spec);
    return Promise.resolve({ calendarSliceList: { days: [] } });
  },
}));

const opts = (over: Partial<CalendarCommandOptions> = {}): CalendarCommandOptions => ({
  departRange: "2026-08-01:2026-08-31",
  tripLength: 7,
  adults: 1,
  limit: 25,
  format: "json",
  cache: false,
  ...over,
});

describe("parseDepartRange", () => {
  it("splits START:END into trimmed dates", () => {
    expect(parseDepartRange("2026-08-01:2026-08-31")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("rejects a range without exactly two parts", () => {
    expect(() => parseDepartRange("2026-08-01")).toThrow(/START:END/);
  });

  it("rejects a malformed date in the range", () => {
    expect(() => parseDepartRange("2026/08/01:2026-08-31")).toThrow(/must be a valid date/);
  });
});

describe("runCalendarCommand validation/wiring", () => {
  it("builds a calendar spec and uppercases airports", async () => {
    captured.length = 0;
    await runCalendarCommand("bos", "lax", opts({ tripLength: 5 }));
    expect(captured[0]).toMatchObject({
      origin: "BOS",
      dest: "LAX",
      departFrom: "2026-08-01",
      departTo: "2026-08-31",
      tripLength: 5,
    });
  });

  it("rejects a start after the end", async () => {
    await expect(
      runCalendarCommand("BOS", "LAX", opts({ departRange: "2026-08-31:2026-08-01" })),
    ).rejects.toThrow(/start must be on or before end/);
  });

  it("rejects a negative --trip-length", async () => {
    await expect(
      runCalendarCommand("BOS", "LAX", opts({ tripLength: -1 })),
    ).rejects.toThrow(/--trip-length must be an integer >= 0/);
  });

  it("rejects a non-numeric --trip-length (NaN)", async () => {
    await expect(
      runCalendarCommand("BOS", "LAX", opts({ tripLength: NaN })),
    ).rejects.toThrow(/--trip-length must be an integer >= 0/);
  });

  it("rejects an invalid --limit", async () => {
    await expect(
      runCalendarCommand("BOS", "LAX", opts({ limit: 0 })),
    ).rejects.toThrow(/--limit must be an integer >= 1/);
  });
});
