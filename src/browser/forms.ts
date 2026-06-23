import type { Page } from "playwright";
import type {
  CalendarSpec,
  MultiCitySpec,
  SearchSpec,
  TripOptions,
} from "../model/spec.js";
import {
  CABIN_LABELS,
  EXTRA_STOPS_LABELS,
  STOPS_LABELS,
  hasAdvancedControls,
  isRoundTrip,
} from "../model/spec.js";

/**
 * Drives the Matrix search form and clicks Search.
 *
 * NOTE: this layer is intentionally thin and is the part most coupled to the
 * live DOM (DESIGN.md "Trade-offs"). Selectors target the Angular Material
 * markup observed on matrix.itasoftware.com/search. If Matrix restructures the
 * form, failures surface here with a clear message.
 */
export async function driveSearchForm(page: Page, spec: SearchSpec): Promise<void> {
  const roundTrip = isRoundTrip(spec);
  await selectTripType(page, roundTrip);
  await fillAirport(page, 0, spec.origin);
  await fillAirport(page, 1, spec.dest);
  await fillDates(page, spec.departDate, roundTrip ? spec.returnDate : undefined);
  await setAdults(page, spec.adults);
  await setAdvancedControls(page, spec, roundTrip);
  await clickSearch(page);
}

/**
 * Drives the multi-city form: selects the Multi-City tab, materialises one row
 * per leg, fills each leg's origin/destination/date, then applies the shared
 * cabin/stops controls and clicks Search. The response is the same
 * `solutionList` shape as a normal search (N slices instead of 1–2).
 */
export async function driveMultiCityForm(
  page: Page,
  spec: MultiCitySpec,
): Promise<void> {
  await page.getByRole("tab", { name: /multi[\s-]?city/i }).click();
  await ensureLegRows(page, spec.slices.length);

  for (const [i, leg] of spec.slices.entries()) {
    await fillAirport(page, 2 * i, leg.origin);
    await fillAirport(page, 2 * i + 1, leg.dest);
    await commitDate(page.locator("input.mat-datepicker-input").nth(i), leg.departDate);
  }
  await dismissOverlay(page);
  await setAdults(page, spec.adults);
  await setMultiCityAdvanced(page, spec);
  await clickSearch(page);
}

/**
 * Drives the price-calendar form: "See calendar of lowest fares" over a
 * departure-date range. With `tripLength` it's a round-trip calendar; without,
 * one-way. Selectors here are provisional — the calendar UI/response could not
 * be captured for P3 (DESIGN), so this is the thinnest, most likely-to-drift
 * layer; failures surface with a clear message.
 */
export async function driveCalendarForm(
  page: Page,
  spec: CalendarSpec,
): Promise<void> {
  const roundTrip = spec.tripLength != null;
  await selectTripType(page, roundTrip);
  await fillAirport(page, 0, spec.origin);
  await fillAirport(page, 1, spec.dest);

  await page
    .getByText(/see calendar of lowest fares/i)
    .first()
    .click();

  await commitDate(page.locator("input.mat-start-date"), spec.departFrom);
  await commitDate(page.locator("input.mat-end-date"), spec.departTo);
  if (spec.tripLength != null) {
    const len = page.locator('input[formcontrolname="tripLength"]');
    await len.fill(String(spec.tripLength));
    await len.dispatchEvent("change");
  }
  await dismissOverlay(page);
  await setAdults(page, spec.adults);
  await setGlobalControls(page, spec, spec.routing, spec.ext, roundTrip);
  await clickSearch(page);
}

/**
 * Expands "Show Advanced Controls" and applies cabin/stops/routing/extension.
 * All controls live behind this panel; we open it only when a control is set.
 * Routing/extension are per-slice: Matrix mirrors them on the return slice
 * (formcontrolname `routingRet`/`extRet`) for symmetric round-trips.
 */
async function setAdvancedControls(
  page: Page,
  spec: SearchSpec,
  roundTrip: boolean,
): Promise<void> {
  if (!hasAdvancedControls(spec)) return;

  await openAdvancedPanel(page);
  await applyCabinStops(page, spec);
  if (spec.routing) {
    await fillFormControl(page, "routing", spec.routing);
    if (roundTrip) await fillFormControl(page, "routingRet", spec.routing);
  }
  if (spec.ext) {
    await fillFormControl(page, "ext", spec.ext);
    if (roundTrip) await fillFormControl(page, "extRet", spec.ext);
  }
}

/**
 * Adds "Add Flight" rows until the form has `count` legs. The default number of
 * rows Matrix renders has drifted (currently one), so derive it from the live
 * combobox count (two per leg) rather than assuming a fixed starting point.
 */
async function ensureLegRows(page: Page, count: number): Promise<void> {
  const addLeg = page.getByRole("button", { name: /add (another )?flight/i });
  const comboboxes = page.getByRole("combobox", { name: "Add airport" });
  for (let existing = (await comboboxes.count()) / 2; existing < count; existing++) {
    await addLeg.click();
    await comboboxes.nth(2 * existing + 1).waitFor({ state: "visible", timeout: 15_000 });
  }
}

/** Multi-city: shared cabin/stops globally, routing/ext per leg by row index. */
async function setMultiCityAdvanced(page: Page, spec: MultiCitySpec): Promise<void> {
  const perLeg = spec.slices.some((s) => s.routing || s.ext);
  if (!hasGlobalControls(spec) && !perLeg) return;

  await openAdvancedPanel(page);
  await applyCabinStops(page, spec);
  for (const [i, leg] of spec.slices.entries()) {
    if (leg.routing) await fillIndexedControl(page, "routing", i, leg.routing);
    if (leg.ext) await fillIndexedControl(page, "ext", i, leg.ext);
  }
}

/**
 * Calendar: shared cabin/stops plus optional single routing/ext. Routing/ext are
 * per-slice, so for a round-trip calendar they are mirrored onto the return slice
 * (`routingRet`/`extRet`), matching `setAdvancedControls`.
 */
async function setGlobalControls(
  page: Page,
  opts: TripOptions,
  routing?: string,
  ext?: string,
  roundTrip = false,
): Promise<void> {
  if (!hasGlobalControls(opts) && !routing && !ext) return;

  await openAdvancedPanel(page);
  await applyCabinStops(page, opts);
  if (routing) {
    await fillFormControl(page, "routing", routing);
    if (roundTrip) await fillFormControl(page, "routingRet", routing);
  }
  if (ext) {
    await fillFormControl(page, "ext", ext);
    if (roundTrip) await fillFormControl(page, "extRet", ext);
  }
}

function hasGlobalControls(opts: TripOptions): boolean {
  return Boolean(opts.cabin || opts.stops || opts.extraStops);
}

async function openAdvancedPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: /show advanced controls/i }).click();
}

async function applyCabinStops(page: Page, opts: TripOptions): Promise<void> {
  if (opts.cabin) await selectOption(page, "cabin", CABIN_LABELS[opts.cabin]);
  if (opts.stops) await selectOption(page, "stops", STOPS_LABELS[opts.stops]);
  if (opts.extraStops) {
    await selectOption(page, "extraStops", EXTRA_STOPS_LABELS[opts.extraStops]);
  }
}

/** Per-leg routing/ext share a formcontrolname across rows; target by index. */
async function fillIndexedControl(
  page: Page,
  control: string,
  index: number,
  value: string,
): Promise<void> {
  const input = page.locator(`input[formcontrolname="${control}"]`).nth(index);
  await input.fill(value);
  await input.dispatchEvent("change");
  await input.evaluate((el) => (el as HTMLInputElement).blur());
}

/** Open a Material <mat-select> by formcontrolname and click the labelled option. */
async function selectOption(page: Page, control: string, label: string): Promise<void> {
  await page.locator(`mat-select[formcontrolname="${control}"]`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function fillFormControl(page: Page, control: string, value: string): Promise<void> {
  const input = page.locator(`input[formcontrolname="${control}"]`);
  await input.fill(value);
  await input.dispatchEvent("change");
  await input.evaluate((el) => (el as HTMLInputElement).blur());
}

async function selectTripType(page: Page, roundTrip: boolean): Promise<void> {
  const name = roundTrip ? "Round Trip" : "One Way";
  await page.getByRole("tab", { name, exact: true }).click();
}

/**
 * Fills the nth "Add airport" combobox. Search uses 0/1 (origin/dest);
 * multi-city uses 2·leg / 2·leg+1.
 */
async function fillAirport(page: Page, index: number, code: string): Promise<void> {
  const input = page.getByRole("combobox", { name: "Add airport" }).nth(index);
  await input.click();
  await input.fill("");
  await input.type(code, { delay: 60 });
  const option = page.getByRole("option").first();
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
}

/**
 * The start/end inputs share one Material date-range picker (a single calendar
 * overlay). `fill()` writes the value without a pointer click, so the overlay
 * backdrop can't intercept it; clicking the backdrop afterwards commits the
 * typed values (blur) and closes the calendar — Escape would cancel them.
 * Values are M/D/YYYY (en-US locale).
 */
async function fillDates(page: Page, departIso: string, returnIso?: string): Promise<void> {
  if (returnIso) {
    // Round-trip: a date-range picker with start/end inner inputs.
    await commitDate(page.locator("input.mat-start-date"), departIso);
    await commitDate(page.locator("input.mat-end-date"), returnIso);
  } else {
    // One-way: a single datepicker input.
    await commitDate(page.locator("input.mat-datepicker-input"), departIso);
  }
  await dismissOverlay(page);
}

/** Clicks the calendar backdrop (if open) to commit typed dates and close it. */
async function dismissOverlay(page: Page): Promise<void> {
  const backdrop = page.locator(".cdk-overlay-backdrop").last();
  if (await backdrop.count()) await backdrop.click({ force: true });
}

/** fill() sets the value; blur fires Material's date parse/validation. */
async function commitDate(
  input: ReturnType<Page["getByPlaceholder"]>,
  isoDate: string,
): Promise<void> {
  await input.fill(toUsDate(isoDate));
  await input.dispatchEvent("change");
  await input.evaluate((el) => (el as HTMLInputElement).blur());
}

function toUsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

async function setAdults(page: Page, adults: number): Promise<void> {
  if (adults === 1) return; // Matrix default.
  // Exclude the calendar trip-length field, which is also a numeric input and
  // would otherwise be matched first, swapping the nights and adults values.
  const input = page
    .locator('input[type="number"]:not([formcontrolname="tripLength"])')
    .first();
  await input.fill(String(adults));
  await input.dispatchEvent("change");
}

async function clickSearch(page: Page): Promise<void> {
  await page.getByRole("button", { name: /search/i }).last().click();
}
