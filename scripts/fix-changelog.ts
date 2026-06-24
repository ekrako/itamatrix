#!/usr/bin/env tsx
/**
 * Normalize CHANGELOG.md so it passes markdownlint. semantic-release's
 * conventional-changelog template mixes heading levels: the first release is an
 * `#` title while later "compare" releases are `## [x.y.z]`, and section headings
 * ("Bug Fixes", "Features") land at an inconsistent level. That produced MD001
 * (skipped level) and MD024 (duplicate "Bug Fixes") failures.
 *
 * This rewrites every heading by semantics: a version heading (carries a date or a
 * compare link) becomes `##`; any other heading (a section) becomes `###`, so each
 * section is a child of its release. Section names then repeat only across distinct
 * parents — handled by MD024 `siblings_only` in .markdownlint-cli2.jsonc. Idempotent.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../CHANGELOG.md");
if (!existsSync(PATH)) process.exit(0);

const isVersionHeading = (line: string): boolean =>
  /\d{4}-\d{2}-\d{2}|compare\//.test(line);

const normalizeHeadings = (text: string): string =>
  text
    .split("\n")
    .map((line) => {
      const heading = line.match(/^#{1,6} (.*)$/);
      if (!heading) return line;
      return `${isVersionHeading(line) ? "## " : "### "}${heading[1]}`;
    })
    .join("\n");

const fixed = normalizeHeadings(readFileSync(PATH, "utf8"))
  .replace(/\n{3,}/g, "\n\n") // MD012: collapse runs of blank lines
  .replace(/[ \t]+$/gm, "") // MD009: strip trailing whitespace
  .replace(/\s*$/, "\n"); // MD047: exactly one trailing newline

writeFileSync(PATH, fixed);
