import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * File-based result cache. Matrix queries take 30–60 s and are driven by a
 * browser, so repeat queries for the same spec are expensive; caching the raw
 * parsed response makes them instant (DESIGN P4). The cache key is the spec, so
 * output format is irrelevant — render happens after the cache layer.
 */

export interface CacheOptions {
  /** When false, `withCache` always calls the producer and skips read/write. */
  enabled: boolean;
  /** Entries older than this are treated as misses. */
  ttlMs: number;
}

export const DEFAULT_CACHE_TTL_MINUTES = 60;

interface CacheEntry<T> {
  savedAt: number; // epoch ms
  value: T;
}

/** `$XDG_CACHE_HOME/itamatrix` → `~/.cache/itamatrix` → `$TMPDIR/itamatrix`. */
export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "itamatrix");
  const home = homedir();
  if (home) return join(home, ".cache", "itamatrix");
  return join(tmpdir(), "itamatrix");
}

function hashKey(namespace: string, keyParts: unknown): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(JSON.stringify(keyParts))
    .digest("hex");
  return `${namespace}-${digest}`;
}

function entryPath(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

function readEntry<T>(key: string, ttlMs: number, now: number): T | null {
  const path = entryPath(key);
  if (!existsSync(path)) return null;
  try {
    const entry = JSON.parse(readFileSync(path, "utf8")) as Partial<CacheEntry<T>>;
    if (typeof entry?.savedAt !== "number" || !("value" in entry)) return null;
    if (now - entry.savedAt > ttlMs) return null;
    return entry.value as T;
  } catch {
    // Corrupt/unreadable cache file: treat as a miss, never fail the query.
    return null;
  }
}

function writeEntry<T>(key: string, value: T, now: number): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const entry: CacheEntry<T> = { savedAt: now, value };
    writeFileSync(entryPath(key), JSON.stringify(entry));
  } catch {
    // Cache is best-effort; a write failure must not break the command.
  }
}

/**
 * Return a cached response for `keyParts` if present and fresh, otherwise call
 * `produce`, cache its result, and return it. Caching is best-effort: any I/O
 * error degrades to calling `produce` directly.
 */
export async function withCache<T>(
  namespace: string,
  keyParts: unknown,
  opts: CacheOptions,
  produce: () => Promise<T>,
): Promise<T> {
  if (!opts.enabled) return produce();

  const key = hashKey(namespace, keyParts);
  const now = Date.now();
  const hit = readEntry<T>(key, opts.ttlMs, now);
  if (hit !== null) return hit;

  const value = await produce();
  writeEntry(key, value, now);
  return value;
}
