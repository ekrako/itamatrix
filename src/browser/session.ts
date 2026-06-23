import { chromium, type Browser, type Page } from "playwright";
import type { CalendarSpec, MultiCitySpec, SearchSpec } from "../model/spec.js";
import { driveCalendarForm, driveMultiCityForm, driveSearchForm } from "./forms.js";
import { extractCalendarPayload, extractSearchPayload } from "./batch.js";
import {
  parseCalendarResponse,
  parseSearchResponse,
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
