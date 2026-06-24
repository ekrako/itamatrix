import Table from "cli-table3";
import chalk from "chalk";
import type { FlatResult, FlatSolution, ItineraryDetails } from "./normalize.js";

function fmtTime(iso: string): string {
  // "2026-08-10T06:21-04:00" -> "08-10 06:21"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  if (!m) return iso;
  return `${m[2]}-${m[3]} ${m[4]}`;
}

/** Formats minutes as `6h30`; empty string when undefined. */
function fmtDuration(min?: number): string {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** One line per slice: route, times, stops/duration, flight numbers, warnings. */
function summarizeSlice(sol: FlatSolution): string {
  return sol.slices
    .map((s) => {
      const route = `${s.origin}→${s.destination}`;
      const stops = s.stops === 0 ? "nonstop" : `${s.stops} stop`;
      const dur = fmtDuration(s.durationMinutes);
      const times = `${fmtTime(s.departure)}→${fmtTime(s.arrival)}`;
      const warn = s.warnings.length ? ` ${chalk.yellow(s.warnings.join(","))}` : "";
      return `${route} ${times} ${chalk.dim(`${stops} ${dur}`)} ${s.flights.join(" ")}${warn}`;
    })
    .join("\n");
}

/** Renders results as a colored terminal table, with an optional details footer. */
export function renderTable(result: FlatResult): string {
  if (result.solutions.length === 0) {
    return chalk.yellow("No flights found.");
  }

  const table = new Table({
    head: [chalk.bold("Price"), chalk.bold("Carrier"), chalk.bold("Itinerary")],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  for (const sol of result.solutions) {
    table.push([
      chalk.green(sol.total),
      sol.carriers.join(",") || "—",
      summarizeSlice(sol),
    ]);
  }

  const header = chalk.dim(
    `${result.shown} of ${result.count} results` +
      (result.minPrice ? ` · from ${result.minPrice}` : ""),
  );
  const footer = result.details ? `\n${renderDetails(result.details)}` : "";
  return `${header}\n${table.toString()}${footer}`;
}

/** Top-result detail footer: fare construction (for travel agents) + Google Flights link. */
function renderDetails(details: ItineraryDetails): string {
  const lines = [chalk.bold("\nTop result")];
  if (details.fareConstruction.length) {
    lines.push(chalk.dim("Fare Construction (can be useful to travel agents):"));
    lines.push(...details.fareConstruction.map((l) => `  ${l}`));
  }
  if (details.googleFlightsUrl) {
    lines.push(`${chalk.bold("Open in Google Flights:")} ${details.googleFlightsUrl}`);
  }
  return lines.join("\n");
}
