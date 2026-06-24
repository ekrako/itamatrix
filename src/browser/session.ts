import { chromium, type Browser, type Page } from "playwright";
import type { CalendarSpec, MultiCitySpec, SearchSpec } from "../model/spec.js";
import { driveCalendarForm, driveMultiCityForm, driveSearchForm } from "./forms.js";
import {
  extractBookingDetailsPayload,
  extractCalendarPayload,
  extractSearchPayload,
} from "./batch.js";
import {
  parseBookingDetails,
  parseCalendarResponse,
  parseSearchResponse,
  type BookingDetailsResponse,
  type CalendarResponse,
  type SearchResponse,
} from "../model/types.js";

const SEARCH_URL = "https://matrix.itasoftware.com/search";
// Results arrive in a multipart `/batch` response (not the documented
// `/v1/search`); the relevant part carries a `solutionList` JSON body.
const SEARCH_API_RE = /content-alkalimatrix-pa\.googleapis\.com\/batch/;
const DEFAULT_TIMEOUT_MS = 120_000;

// A real desktop-Chrome UA (no "Headless"); BotGuard rejects the headless UA.
const STEALTH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SessionOptions {
  /** Show the browser window (debugging). Default headless. */
  headful?: boolean;
  /** Max time to wait for the /v1/search response. Matrix is slow (40–60s). */
  timeoutMs?: number;
}

/**
 * One-shot Matrix search: launch Chromium, drive the form, intercept the
 * `/v1/search` response, and return the parsed payload.
 *
 * Bundled headless Chromium works with light stealth (real Chrome UA, hide
 * navigator.webdriver) — Google's BotGuard JS still runs and mints the token.
 */
export async function runSearch(
  spec: SearchSpec,
  opts: SessionOptions = {},
): Promise<SearchResponse> {
  return runDriver(
    (page) => driveSearchForm(page, spec),
    extractSearchPayload,
    parseSearchResponse,
    opts,
  );
}

/** Multi-city search (DESIGN P3): same `solutionList` response as `runSearch`. */
export async function runMultiCity(
  spec: MultiCitySpec,
  opts: SessionOptions = {},
): Promise<SearchResponse> {
  return runDriver(
    (page) => driveMultiCityForm(page, spec),
    extractSearchPayload,
    parseSearchResponse,
    opts,
  );
}

/** Price-calendar search (DESIGN P3): lowest fare per departure date. */
export async function runCalendar(
  spec: CalendarSpec,
  opts: SessionOptions = {},
): Promise<CalendarResponse> {
  return runDriver(
    (page) => driveCalendarForm(page, spec),
    extractCalendarPayload,
    parseCalendarResponse,
    opts,
  );
}

/** A priced itinerary's detail, captured from the Matrix detail page. */
export interface DetailCapture {
  bookingDetails: BookingDetailsResponse;
  googleFlightsUrl?: string;
}

export interface SearchWithDetails {
  search: SearchResponse;
  /** null when the detail page could not be opened/parsed (search still returns). */
  details: DetailCapture | null;
}

/** Like {@link runSearch}, then opens the top result's detail page for its fare construction + Google Flights link. */
export function runSearchWithDetails(
  spec: SearchSpec,
  opts: SessionOptions = {},
): Promise<SearchWithDetails> {
  return runDriverWithDetails((page) => driveSearchForm(page, spec), opts);
}

/** Multi-city counterpart of {@link runSearchWithDetails}. */
export function runMultiCityWithDetails(
  spec: MultiCitySpec,
  opts: SessionOptions = {},
): Promise<SearchWithDetails> {
  return runDriverWithDetails((page) => driveMultiCityForm(page, spec), opts);
}

/**
 * Shared driver: launch Chromium, drive the form, intercept the first `/batch`
 * response that `match` accepts, and parse it. All P1–P3 commands share this;
 * they differ only in how the form is driven and which payload is extracted.
 */
async function runDriver<T>(
  drive: (page: Page) => Promise<void>,
  match: (body: string) => unknown | null,
  parse: (raw: unknown) => T,
  opts: SessionOptions,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const browser = await launch(opts.headful ?? false);
  const page = await newStealthPage(browser);
  const waiter = waitForResponse(page, match, timeoutMs);
  // Never let an unobserved rejection (e.g. browser closed on form failure)
  // crash the process; the real error is surfaced below.
  waiter.promise.catch(() => {});
  try {
    try {
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await drive(page);
    } catch {
      // Navigation/form-driving failures are Playwright errors that leak
      // selectors and local paths; surface a concise, user-safe message.
      throw new Error(
        "Failed to drive the Matrix search form (the site may have changed). Run with --headful to debug.",
      );
    }

    const raw = await waiter.promise;
    return parse(raw);
  } finally {
    // Cancel first: a form/nav failure must clear the pending timeout so the
    // process can exit immediately instead of waiting out `timeoutMs`.
    waiter.cancel();
    await browser.close();
  }
}

/**
 * Search, then drill into the top result's detail page. The detail capture is
 * best-effort: if the row can't be opened or the `bookingDetails` part never
 * arrives, `details` is null and the search results are still returned. Reuses
 * the same browser/page so the detail page inherits the live solution session.
 */
async function runDriverWithDetails(
  drive: (page: Page) => Promise<void>,
  opts: SessionOptions,
): Promise<SearchWithDetails> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const browser = await launch(opts.headful ?? false);
  const page = await newStealthPage(browser);
  const waiter = waitForResponse(page, extractSearchPayload, timeoutMs);
  waiter.promise.catch(() => {});
  try {
    try {
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await drive(page);
    } catch {
      throw new Error(
        "Failed to drive the Matrix search form (the site may have changed). Run with --headful to debug.",
      );
    }

    const search = parseSearchResponse(await waiter.promise);
    waiter.cancel();
    const details = await captureTopDetails(page, timeoutMs);
    return { search, details };
  } finally {
    waiter.cancel();
    await browser.close();
  }
}

/**
 * Opens the first results row and waits for its `bookingDetails` part, then reads
 * the "Open in Google Flights" link from the DOM (it's rendered client-side, not
 * in the API). Returns null on any failure — detail is an enrichment, never fatal.
 */
async function captureTopDetails(
  page: Page,
  timeoutMs: number,
): Promise<DetailCapture | null> {
  const waiter = waitForResponse(page, extractBookingDetailsPayload, timeoutMs);
  waiter.promise.catch(() => {});
  try {
    if (!(await openFirstSolution(page))) return null;
    const bookingDetails = parseBookingDetails(await waiter.promise);
    return { bookingDetails, googleFlightsUrl: await readGoogleFlightsUrl(page) };
  } catch {
    return null;
  } finally {
    waiter.cancel();
  }
}

/** Clicks into the first itinerary; true if a clickable row was found. */
async function openFirstSolution(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("link").filter({ hasText: /\$|USD|\d:\d/ }).first(),
    page.locator("td a, .mat-row a, [role=row] a").first(),
    page.locator("[role=row]").filter({ hasText: /\$|USD/ }).nth(1),
  ];
  for (const candidate of candidates) {
    try {
      // click() auto-waits for the element; no count() pre-check, which would
      // skip a row that renders a moment later.
      await candidate.click({ timeout: 8_000 });
      return true;
    } catch {
      // Try the next selector; the results DOM has drifted before.
    }
  }
  return false;
}

/** Reads the detail page's "Open in Google Flights" href; undefined if absent. */
async function readGoogleFlightsUrl(page: Page): Promise<string | undefined> {
  const link = page.getByRole("link", { name: /google flights/i }).first();
  try {
    return (await link.getAttribute("href", { timeout: 8_000 })) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Launches Chromium, mapping Playwright's path-leaking errors to safe messages. */
async function launch(headful: boolean): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: !headful,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      throw new Error(
        "Chromium is not installed. Run: npx playwright install chromium",
      );
    }
    // Raw Playwright launch errors leak the browser command and local paths;
    // surface a concise, user-safe message instead.
    throw new Error(
      "Failed to launch the browser. Run with --headful to debug, or reinstall Chromium: npx playwright install chromium",
    );
  }
}

/** New page with a real Chrome UA and `navigator.webdriver` hidden (light stealth). */
async function newStealthPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: STEALTH_UA,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context.newPage();
}

interface ResponseWaiter {
  promise: Promise<unknown>;
  /** Detach the listener and clear the timeout (idempotent). */
  cancel: () => void;
}

/**
 * Resolves with the payload from the first `/batch` response whose body `match`
 * accepts. Many `/batch` calls fire (autocomplete, facets), so we inspect
 * bodies rather than match on URL alone. The returned `cancel` must be called
 * once the caller is done (success or failure) to clear the pending timeout.
 */
function waitForResponse(
  page: Page,
  match: (body: string) => unknown | null,
  timeoutMs: number,
): ResponseWaiter {
  let cancel = (): void => {};
  const promise = new Promise<unknown>((resolve, reject) => {
    const onResponse = (res: import("playwright").Response): void => {
      if (!SEARCH_API_RE.test(res.url()) || res.status() !== 200) return;
      res
        .text()
        .then((body) => {
          const payload = match(body);
          if (!payload) return;
          cancel();
          resolve(payload);
        })
        .catch(() => {});
    };

    const timer = setTimeout(() => {
      cancel();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for search results`));
    }, timeoutMs);

    cancel = () => {
      clearTimeout(timer);
      page.off("response", onResponse);
    };
    page.on("response", onResponse);
  });
  return { promise, cancel: () => cancel() };
}
