/**
 * Matrix returns search results inside a `multipart/mixed` `/batch` response:
 * each part is an `application/http` wrapper around a JSON body. Rather than
 * parse MIME framing, scan the raw text for balanced top-level JSON objects and
 * return the first one that looks like a search result (`solutionList`).
 */
export function extractSearchPayload(batchBody: string): unknown | null {
  for (const obj of jsonObjects(batchBody)) {
    if (obj && typeof obj === "object" && "solutionList" in obj) return obj;
  }
  return null;
}

/**
 * The itinerary-detail page issues its own `/batch` whose part carries a
 * `bookingDetails` body (priced solution: fare construction, taxes, segments).
 */
export function extractBookingDetailsPayload(batchBody: string): unknown | null {
  for (const obj of jsonObjects(batchBody)) {
    if (obj && typeof obj === "object" && "bookingDetails" in obj) return obj;
  }
  return null;
}

/**
 * Keys the price-calendar ("lowest fare") response is expected to carry. The
 * exact shape is unconfirmed (no captured fixture yet — DESIGN P3); this matches
 * any plausible calendar summarizer, and `normalizeCalendar` deep-scans for
 * date→price pairs so it tolerates which key actually wins.
 */
const CALENDAR_KEYS = [
  "calendarSliceList",
  "lowestFareCalendar",
  "overlayPriceBuckets",
  "dateGridList",
  "monthOfYearList",
];

export function extractCalendarPayload(batchBody: string): unknown | null {
  for (const obj of jsonObjects(batchBody)) {
    if (!obj || typeof obj !== "object") continue;
    const root =
      "response" in obj ? (obj as { response: unknown }).response : obj;
    if (root && typeof root === "object" && hasCalendarKey(root as object)) {
      return obj;
    }
  }
  return null;
}

/** True if `obj` carries any of the known price-calendar summary keys. */
function hasCalendarKey(obj: object): boolean {
  return CALENDAR_KEYS.some((k) => k in obj);
}

/** Yields every balanced, parseable top-level `{...}` object in `text`. */
function* jsonObjects(text: string): Generator<unknown> {
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const end = matchBrace(text, i);
    if (end === -1) break;
    const slice = text.slice(i, end + 1);
    try {
      yield JSON.parse(slice);
    } catch {
      // Not a self-contained object at this position; skip past the brace.
    }
    i = end + 1;
  }
}

/** Index of the `}` matching the `{` at `start`, string/escape aware; -1 if none. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}
