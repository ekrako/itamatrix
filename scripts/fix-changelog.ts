#!/usr/bin/env tsx
/**
 * Normalize CHANGELOG.md so it passes markdownlint. semantic-release's default
 * conventional-changelog template emits section headings as `###` directly under
 * the `#` version title (skips `##` → MD001) and leaves a double blank line after
 * the title (MD012). This rewrites those deterministically; it is idempotent, so
 * it is safe to run on every release and on every commit.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../CHANGELOG.md");
if (!existsSync(PATH)) process.exit(0);

const fixed = readFileSync(PATH, "utf8")
  .replace(/^### /gm, "## ") // MD001: section headings one level below the version title
  .replace(/\n{3,}/g, "\n\n") // MD012: collapse runs of blank lines
  .replace(/[ \t]+$/gm, "") // MD009: strip trailing whitespace
  .replace(/\s*$/, "\n"); // MD047: exactly one trailing newline

writeFileSync(PATH, fixed);
