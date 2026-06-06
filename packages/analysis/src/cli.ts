#!/usr/bin/env node
import { analyzeFile } from "./index.js";

interface ParsedArgs {
  command: "analyze";
  inputPath: string;
  outPath: string;
  force: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);
    await analyzeFile({
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

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "analyze") {
    throw new Error("Expected command: analyze");
  }

  let inputPath: string | undefined;
  let outPath: string | undefined;
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
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
