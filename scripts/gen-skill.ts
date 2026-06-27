#!/usr/bin/env tsx
/**
 * Generate the "Command reference" block of SKILL.md from the
 * CLI's own commander definitions, so the skill can never drift from the flags
 * the CLI actually accepts.
 *
 *   tsx scripts/gen-skill.ts          # rewrite the generated block in place
 *   tsx scripts/gen-skill.ts --check  # exit 1 if the block is stale (pre-commit)
 *
 * Only the region between the BEGIN/END GENERATED markers is touched; the
 * hand-written prose around it is left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Command, Option, Argument } from "commander";
import { program } from "../src/cli.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(HERE, "../SKILL.md");
const BEGIN = "<!-- BEGIN GENERATED: command-reference -->";
const END = "<!-- END GENERATED: command-reference -->";

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function renderArgs(args: readonly Argument[]): string {
  return args
    .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
    .join(" ");
}

function renderOptions(options: readonly Option[]): string {
  const rows = options
    .filter((o) => !o.hidden)
    .map((o) => {
      const dv = o.defaultValue;
      const hasDefault =
        dv !== undefined &&
        dv !== false &&
        dv !== "" &&
        !(Array.isArray(dv) && dv.length === 0);
      const def = hasDefault ? ` (default \`${dv}\`)` : "";
      return `| \`${escapeCell(o.flags)}\` | ${escapeCell(o.description)}${def} |`;
    });
  if (!rows.length) return "_No options._\n";
  return ["| Option | Meaning |", "|--------|---------|", ...rows].join("\n") + "\n";
}

function renderCommand(cmd: Command): string {
  const usage = [cmd.name(), renderArgs(cmd.registeredArguments)]
    .filter(Boolean)
    .join(" ");
  return [
    `### \`${usage}\``,
    "",
    cmd.description(),
    "",
    renderOptions(cmd.options),
  ].join("\n");
}

function renderBlock(): string {
  const subcommands = program.commands
    .filter((c) => c.name() !== "help")
    .map(renderCommand)
    .join("\n");
  return [
    BEGIN,
    "",
    "Global options (precede the subcommand):",
    "",
    renderOptions(program.options),
    subcommands,
    END,
  ].join("\n");
}

function injectBlock(source: string, block: string): string {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `markers not found in ${SKILL_PATH}: expected ${BEGIN} ... ${END}`,
    );
  }
  return source.slice(0, start) + block + source.slice(end + END.length);
}

const check = process.argv.includes("--check");
const current = readFileSync(SKILL_PATH, "utf8");
const updated = injectBlock(current, renderBlock());

if (check) {
  if (current !== updated) {
    process.stderr.write(
      "error: SKILL.md is out of date with the CLI.\n" +
        "       run `npm run gen:skill` and commit the result.\n",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (current !== updated) {
  writeFileSync(SKILL_PATH, updated);
  process.stdout.write("updated SKILL.md\n");
} else {
  process.stdout.write("SKILL.md already up to date\n");
}
