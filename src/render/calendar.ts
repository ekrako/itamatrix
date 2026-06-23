import Table from "cli-table3";
import chalk from "chalk";
import type { CalendarResponse } from "../model/types.js";

/** One day of the price calendar: lowest fare found for that departure date. */
export interface CalendarEntry {
  date: string; // YYYY-MM-DD
  price: string; // display string, e.g. "USD439.81"
  priceValue: number; // numeric amount, for sorting/min
}

export interface FlatCalendar {
  entries: CalendarEntry[];
  minPrice?: string;
  minDate?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const PRICE_RE = /(\d[\d,]*\.?\d*)/;

/**
 * The calendar response shape is unconfirmed (no fixture — DESIGN P3), so rather
 * than bind to a specific schema we deep-scan the payload for objects that pair
 * a date with a price and keep the lowest price per date. When a real fixture is
 * captured this can be tightened to a zod schema.
 */
export function normalizeCalendar(resp: CalendarResponse, limit?: number): FlatCalendar {
  const byDate = new Map<string, CalendarEntry>();
  for (const { date, price } of scanForFares(resp)) {
    const value = parsePrice(price);
    if (value == null) continue;
    const prev = byDate.get(date);
    if (!prev || value < prev.priceValue) {
      byDate.set(date, { date, price, priceValue: value });
    }
  }

  const entries = capCheapest([...byDate.values()], limit).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const cheapest = entries.reduce<CalendarEntry | undefined>(
    (min, e) => (!min || e.priceValue < min.priceValue ? e : min),
    undefined,
  );
  return { entries, minPrice: cheapest?.price, minDate: cheapest?.date };
}

/** Keep the `limit` cheapest dates (the point of a price calendar); all when unset. */
function capCheapest(entries: CalendarEntry[], limit?: number): CalendarEntry[] {
  if (limit == null || entries.length <= limit) return entries;
  return [...entries].sort((a, b) => a.priceValue - b.priceValue).slice(0, limit);
}

/** Yields {date, price} pairs found anywhere in the response tree. */
function* scanForFares(node: unknown): Generator<{ date: string; price: string }> {
  if (Array.isArray(node)) {
    for (const item of node) yield* scanForFares(item);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const date = pickValue(obj, /date|departure/i, isIsoDate);
  const price = pickValue(obj, /price|total|fare|amount/i, isPriceLike);
  if (date && price) yield { date: date.slice(0, 10), price };

  for (const value of Object.values(obj)) yield* scanForFares(value);
}

function pickValue(
  obj: Record<string, unknown>,
  keyRe: RegExp,
  valueOk: (v: string) => boolean,
): string | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && keyRe.test(k) && valueOk(v)) return v;
  }
  return undefined;
}

function isIsoDate(v: string): boolean {
  return ISO_DATE_RE.test(v);
}

function isPriceLike(v: string): boolean {
  return PRICE_RE.test(v);
}

function parsePrice(price: string): number | null {
  const m = price.match(PRICE_RE);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function renderCalendarJson(cal: FlatCalendar): string {
  return JSON.stringify(cal, null, 2);
}

export function renderCalendarTable(cal: FlatCalendar): string {
  if (cal.entries.length === 0) {
    return chalk.yellow("No fares found for the given date range.");
  }

  const table = new Table({
    head: [chalk.bold("Date"), chalk.bold("Lowest fare")],
    style: { head: [], border: [] },
  });

  for (const e of cal.entries) {
    const cheapest = e.date === cal.minDate;
    const price = cheapest ? chalk.green.bold(e.price) : chalk.green(e.price);
    table.push([cheapest ? chalk.bold(e.date) : e.date, price]);
  }

  const header = chalk.dim(
    `${cal.entries.length} dates` +
      (cal.minPrice ? ` · cheapest ${cal.minPrice} on ${cal.minDate}` : ""),
  );
  return `${header}\n${table.toString()}`;
}
