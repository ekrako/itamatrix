import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCache, cacheDir, DEFAULT_CACHE_TTL_MINUTES } from "./cache.js";

let dir: string;
let prevXdg: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "itamatrix-cache-"));
  prevXdg = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = dir;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = prevXdg;
  rmSync(dir, { recursive: true, force: true });
});

const opts = { enabled: true, ttlMs: DEFAULT_CACHE_TTL_MINUTES * 60_000 };

describe("withCache", () => {
  it("returns the cache dir under XDG_CACHE_HOME", () => {
    expect(cacheDir()).toBe(join(dir, "itamatrix"));
  });

  it("calls the producer once and serves the second call from cache", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });

    const first = await withCache("search", { o: "BOS" }, opts, produce);
    const second = await withCache("search", { o: "BOS" }, opts, produce);

    expect(first).toEqual({ price: 100 });
    expect(second).toEqual({ price: 100 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("treats a different key as a miss", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });

    await withCache("search", { o: "BOS" }, opts, produce);
    await withCache("search", { o: "JFK" }, opts, produce);

    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("separates entries by namespace", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });

    await withCache("search", { x: 1 }, opts, produce);
    await withCache("calendar", { x: 1 }, opts, produce);

    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache entirely when disabled", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });
    const off = { enabled: false, ttlMs: 60_000 };

    await withCache("search", { o: "BOS" }, off, produce);
    await withCache("search", { o: "BOS" }, off, produce);

    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("treats a JSON file of the wrong shape as a miss", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });
    mkdirSync(join(dir, "itamatrix"), { recursive: true });
    // Mirror the key derivation: namespace + sha256(namespace \0 JSON(parts)).
    const parts = { o: "BOS" };
    const digest = createHash("sha256")
      .update("search")
      .update("\0")
      .update(JSON.stringify(parts))
      .digest("hex");
    writeFileSync(join(dir, "itamatrix", `search-${digest}.json`), "{}");

    const result = await withCache("search", parts, opts, produce);

    expect(result).toEqual({ price: 100 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the entry is older than the TTL", async () => {
    const produce = vi.fn().mockResolvedValue({ price: 100 });
    const base = 1_000_000;

    vi.spyOn(Date, "now").mockReturnValue(base);
    await withCache("search", { o: "BOS" }, { enabled: true, ttlMs: 1000 }, produce);

    vi.spyOn(Date, "now").mockReturnValue(base + 2000);
    await withCache("search", { o: "BOS" }, { enabled: true, ttlMs: 1000 }, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
