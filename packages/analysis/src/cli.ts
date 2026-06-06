#!/usr/bin/env node
import {
  writeOverrideTemplate,
  writeResolvedMetadata,
} from "./effective.js";
import {
  validateEvaluationFile,
  writeEvaluationTemplate,
} from "./evaluation.js";
import {
  type EvaluationSummaryFormat,
  writeEvaluationSummary,
} from "./evaluation-summary.js";
import { writeAiReviewInput } from "./ai-review-input.js";
import { writeAiReviewedMetadata } from "./ai-review.js";
import { analyzeFile } from "./index.js";
import { writeAnalysisReport } from "./report.js";
import { isAbsolute, resolve } from "node:path";

interface ParsedArgs {
  command:
    | "ai-input"
    | "analyze"
    | "apply-ai-review"
    | "init-overrides"
    | "init-evaluation"
    | "report"
    | "resolve"
    | "summarize-evaluations"
    | "validate-evaluation";
  inputPath: string;
  inputPaths: string[];
  outPath?: string;
  force: boolean;
  format?: EvaluationSummaryFormat;
  aiReviewPath?: string;
  evaluationPath?: string;
  overridesPath?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const args = resolveCliPaths(parseArgs(argv));
    if (args.command === "analyze") {
      await analyzeFile({
        inputPath: args.inputPath,
        outPath: args.outPath!,
        force: args.force,
      });
      return;
    }

    if (args.command === "report") {
      await writeAnalysisReport({
        evaluationPath: args.evaluationPath,
        inputPath: args.inputPath,
        outPath: args.outPath!,
        force: args.force,
      });
      return;
    }

    if (args.command === "ai-input") {
      await writeAiReviewInput({
        inputPath: args.inputPath,
        outPath: args.outPath!,
        force: args.force,
      });
      return;
    }

    if (args.command === "apply-ai-review") {
      await writeAiReviewedMetadata({
        inputPath: args.inputPath,
        aiReviewPath: args.aiReviewPath!,
        outPath: args.outPath!,
        force: args.force,
      });
      return;
    }

    if (args.command === "init-evaluation") {
      await writeEvaluationTemplate({
        inputPath: args.inputPath,
        outPath: args.outPath!,
        force: args.force,
      });
      return;
    }

    if (args.command === "validate-evaluation") {
      await validateEvaluationFile({
        inputPath: args.inputPath,
      });
      console.log(`luumix: evaluation note is valid: ${args.inputPath}`);
      return;
    }

    if (args.command === "summarize-evaluations") {
      await writeEvaluationSummary({
        inputPaths: args.inputPaths,
        outPath: args.outPath!,
        force: args.force,
        format: args.format,
      });
      return;
    }

    if (args.command === "resolve") {
      await writeResolvedMetadata({
        inputPath: args.inputPath,
        outPath: args.outPath!,
        force: args.force,
        overridesPath: args.overridesPath,
      });
      return;
    }

    await writeOverrideTemplate({
      inputPath: args.inputPath,
      outPath: args.outPath!,
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
    inputPaths: args.inputPaths.map(resolveUserPath),
    outPath: args.outPath ? resolveUserPath(args.outPath) : undefined,
    aiReviewPath: args.aiReviewPath
      ? resolveUserPath(args.aiReviewPath)
      : undefined,
    evaluationPath: args.evaluationPath
      ? resolveUserPath(args.evaluationPath)
      : undefined,
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
    command !== "apply-ai-review" &&
    command !== "init-evaluation" &&
    command !== "init-overrides" &&
    command !== "report" &&
    command !== "resolve" &&
    command !== "summarize-evaluations" &&
    command !== "validate-evaluation"
  ) {
    throw new Error(
      "Expected command: analyze, report, ai-input, apply-ai-review, init-evaluation, validate-evaluation, summarize-evaluations, resolve, or init-overrides",
    );
  }

  const inputPaths: string[] = [];
  let outPath: string | undefined;
  let aiReviewPath: string | undefined;
  let evaluationPath: string | undefined;
  let overridesPath: string | undefined;
  let format: EvaluationSummaryFormat | undefined;
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

    if (arg === "--format") {
      const value = rest[index + 1];
      index += 1;
      if (value !== "json" && value !== "markdown") {
        throw new Error("Missing or invalid value for --format: expected json or markdown");
      }
      format = value;
      continue;
    }

    if (arg === "--ai-review") {
      aiReviewPath = rest[index + 1];
      index += 1;
      if (!aiReviewPath) {
        throw new Error("Missing value for --ai-review");
      }
      continue;
    }

    if (arg === "--evaluation") {
      evaluationPath = rest[index + 1];
      index += 1;
      if (!evaluationPath) {
        throw new Error("Missing value for --evaluation");
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

    if (command !== "summarize-evaluations" && inputPaths.length > 0) {
      throw new Error("Expected exactly one input file path");
    }
    inputPaths.push(arg);
  }

  if (inputPaths.length === 0) {
    throw new Error("Missing input file path");
  }

  if (command !== "validate-evaluation" && !outPath) {
    throw new Error("Missing required --out <path>");
  }

  if (command === "apply-ai-review" && !aiReviewPath) {
    throw new Error("Missing required --ai-review <path>");
  }

  if (evaluationPath && command !== "report") {
    throw new Error("--evaluation is only supported by the report command");
  }

  return {
    command,
    inputPath: inputPaths[0]!,
    inputPaths,
    outPath,
    force,
    format,
    aiReviewPath,
    evaluationPath,
    overridesPath,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
