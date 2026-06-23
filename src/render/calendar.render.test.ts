import { describe, it, expect } from "vitest";
import { normalizeCalendar, renderCalendarTable } from "./calendar.js";

describe("normalizeCalendar", () => {
  it("deep-scans for date→price pairs regardless of nesting", () => {
    const resp = {
      calendarSliceList: {
        days: [
          { departureDate: "2026-08-01", price: "USD439.81" },
          { departureDate: "2026-08-02", price: "USD512.00" },
        ],
      },
    };
    const cal = normalizeCalendar(resp);
    expect(cal.entries).toHaveLength(2);
    expect(cal.minPrice).toBe("USD439.81");
    expect(cal.minDate).toBe("2026-08-01");
  });

  it("keeps the lowest price when a date appears more than once", () => {
    const resp = {
      a: { date: "2026-08-01", total: "USD600" },
      b: { date: "2026-08-01", total: "USD420.50" },
    };
    const cal = normalizeCalendar(resp);
    expect(cal.entries).toHaveLength(1);
    expect(cal.entries[0]!.price).toBe("USD420.50");
  });

  it("sorts entries by date and trims timestamps to YYYY-MM-DD", () => {
    const resp = {
      x: { departureDate: "2026-08-03T00:00-04:00", fare: "USD300" },
      y: { departureDate: "2026-08-01T00:00-04:00", fare: "USD200" },
    };
    const cal = normalizeCalendar(resp);
    expect(cal.entries.map((e) => e.date)).toEqual(["2026-08-01", "2026-08-03"]);
  });

  it("yields no entries for a payload with no date/price pairs", () => {
    expect(normalizeCalendar({ foo: { bar: 1 } }).entries).toHaveLength(0);
  });

  it("caps to the cheapest N dates when a limit is given, still date-sorted", () => {
    const resp = {
      days: [
        { departureDate: "2026-08-01", price: "USD500" },
        { departureDate: "2026-08-02", price: "USD200" },
        { departureDate: "2026-08-03", price: "USD300" },
      ],
    };
    const cal = normalizeCalendar(resp, 2);
    expect(cal.entries.map((e) => e.date)).toEqual(["2026-08-02", "2026-08-03"]);
    expect(cal.minPrice).toBe("USD200");
  });
});

describe("renderCalendarTable", () => {
  it("renders a friendly message when there are no fares", () => {
    expect(renderCalendarTable({ entries: [] })).toMatch(/No fares found/);
  });

  it("includes each date and the cheapest summary", () => {
    const out = renderCalendarTable(
      normalizeCalendar({
        days: [
          { date: "2026-08-01", price: "USD439.81" },
          { date: "2026-08-02", price: "USD512.00" },
        ],
      }),
    );
    expect(out).toMatch(/2026-08-01/);
    expect(out).toMatch(/cheapest USD439.81/);
  });
});
