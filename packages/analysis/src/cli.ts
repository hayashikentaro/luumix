#!/usr/bin/env node
import {
  writeOverrideTemplate,
  writeResolvedMetadata,
} from "./effective.js";
import { writeAiReviewInput } from "./ai-review-input.js";
import { analyzeFile } from "./index.js";
import { writeAnalysisReport } from "./report.js";
import { isAbsolute, resolve } from "node:path";

interface ParsedArgs {
  command: "ai-input" | "analyze" | "init-overrides" | "report" | "resolve";
  inputPath: string;
  outPath: string;
  force: boolean;
  overridesPath?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const args = resolveCliPaths(parseArgs(argv));
    if (args.command === "analyze") {
      await analyzeFile({
        inputPath: args.inputPath,
        outPath: args.outPath,
        force: args.force,
      });
      return;
    }

    if (args.command === "report") {
      await writeAnalysisReport({
        inputPath: args.inputPath,
        outPath: args.outPath,
        force: args.force,
      });
      return;
    }

    if (args.command === "ai-input") {
      await writeAiReviewInput({
        inputPath: args.inputPath,
        outPath: args.outPath,
        force: args.force,
      });
      return;
    }

    if (args.command === "resolve") {
      await writeResolvedMetadata({
        inputPath: args.inputPath,
        outPath: args.outPath,
        force: args.force,
        overridesPath: args.overridesPath,
      });
      return;
    }

    await writeOverrideTemplate({
      inputPath: args.inputPath,
      outPath: args.outPath,
      force: args.force,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`luumix: ${message}`);
    process.exitCode = 1;
  }
}

export function resolveCliPaths(args: ParsedArgs): ParsedArgs {
  return {
    ...args,
    inputPath: resolveUserPath(args.inputPath),
    outPath: resolveUserPath(args.outPath),
    overridesPath: args.overridesPath
      ? resolveUserPath(args.overridesPath)
      : undefined,
  };
}

function resolveUserPath(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }

  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (
    command !== "ai-input" &&
    command !== "analyze" &&
    command !== "init-overrides" &&
    command !== "report" &&
    command !== "resolve"
  ) {
    throw new Error(
      "Expected command: analyze, report, ai-input, resolve, or init-overrides",
    );
  }

  let inputPath: string | undefined;
  let outPath: string | undefined;
  let overridesPath: string | undefined;
  let force = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--out") {
      outPath = rest[index + 1];
      index += 1;
      if (!outPath) {
        throw new Error("Missing value for --out");
      }
      continue;
    }

    if (arg === "--overrides") {
      overridesPath = rest[index + 1];
      index += 1;
      if (!overridesPath) {
        throw new Error("Missing value for --overrides");
      }
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (inputPath) {
      throw new Error("Expected exactly one input file path");
    }
    inputPath = arg;
  }

  if (!inputPath) {
    throw new Error("Missing input file path");
  }

  if (!outPath) {
    throw new Error("Missing required --out <path>");
  }

  return {
    command,
    inputPath,
    outPath,
    force,
    overridesPath,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
