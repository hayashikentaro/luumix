import {
  parseTrackAnalysisMetadata,
  type TrackAnalysisMetadata,
} from "@luumix/metadata";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const EVALUATION_SCHEMA_VERSION = 1;

const bpmJudgments = ["correct", "half", "double", "wrong", "unknown"] as const;
const beatGridJudgments = [
  "aligned",
  "shifted",
  "unstable",
  "wrong",
  "unknown",
] as const;
const downbeatJudgments = [
  "correct",
  "wrongPhase",
  "ambiguous",
  "unknown",
] as const;
const transitionJudgments = [
  "plausible",
  "tooEarly",
  "tooLate",
  "wrong",
  "unknown",
] as const;
const overallJudgments = [
  "usable",
  "needsManualCorrection",
  "reject",
  "unknown",
] as const;

export type BpmJudgment = (typeof bpmJudgments)[number];
export type BeatGridJudgment = (typeof beatGridJudgments)[number];
export type DownbeatJudgment = (typeof downbeatJudgments)[number];
export type TransitionJudgment = (typeof transitionJudgments)[number];
export type OverallJudgment = (typeof overallJudgments)[number];

export interface AnalysisEvaluationNote {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  sourceContentHash: string;
  sourcePathHint: string;
  createdAt: string;
  expected: {
    bpm: number | null;
    downbeatPhaseId: string | null;
    notes: string[];
  };
  observed: {
    tempoCandidateId: string | null;
    beatGridCandidateId: string | null;
    downbeatCandidateId: string | null;
    mixInTransitionId: string | null;
    mixOutTransitionId: string | null;
  };
  judgment: {
    bpm: BpmJudgment;
    beatGrid: BeatGridJudgment;
    downbeat: DownbeatJudgment;
    transitions: TransitionJudgment;
    overall: OverallJudgment;
  };
  corrections: {
    bpm: number | null;
    firstBeatSec: number | null;
    firstDownbeatSec: number | null;
    mixInSec: number[];
    mixOutSec: number[];
  };
  notes: string[];
}

export interface InitEvaluationOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
}

export interface ValidateEvaluationOptions {
  inputPath: string;
}

export class EvaluationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationValidationError";
  }
}

export function createEvaluationTemplate(
  metadata: TrackAnalysisMetadata,
  createdAt = new Date(),
): AnalysisEvaluationNote {
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    sourceContentHash: metadata.sourceFile.contentHash,
    sourcePathHint: metadata.sourceFile.path,
    createdAt: createdAt.toISOString(),
    expected: {
      bpm: null,
      downbeatPhaseId: null,
      notes: [
        "Edit sourcePathHint if the generated path reveals private information.",
      ],
    },
    observed: {
      tempoCandidateId: metadata.analysis.defaults.tempoCandidateId ?? null,
      beatGridCandidateId: metadata.analysis.defaults.beatGridCandidateId ?? null,
      downbeatCandidateId: metadata.analysis.defaults.downbeatCandidateId ?? null,
      mixInTransitionId: metadata.analysis.defaults.mixInTransitionId ?? null,
      mixOutTransitionId: metadata.analysis.defaults.mixOutTransitionId ?? null,
    },
    judgment: {
      bpm: "unknown",
      beatGrid: "unknown",
      downbeat: "unknown",
      transitions: "unknown",
      overall: "unknown",
    },
    corrections: {
      bpm: null,
      firstBeatSec: null,
      firstDownbeatSec: null,
      mixInSec: [],
      mixOutSec: [],
    },
    notes: [],
  };
}

export async function writeEvaluationTemplate(
  options: InitEvaluationOptions,
): Promise<AnalysisEvaluationNote> {
  await assertInputFile(options.inputPath, "Input metadata file");
  await assertOutputWritable(options.outPath, options.force);

  const metadata = parseTrackAnalysisMetadata(
    await readJsonFile(options.inputPath, "analysis metadata"),
  );
  const evaluation = parseAnalysisEvaluation(createEvaluationTemplate(metadata));

  await writeJsonFile(options.outPath, evaluation);
  return evaluation;
}

export async function validateEvaluationFile(
  options: ValidateEvaluationOptions,
): Promise<AnalysisEvaluationNote> {
  await assertInputFile(options.inputPath, "Evaluation file");

  return parseAnalysisEvaluation(
    await readJsonFile(options.inputPath, "evaluation"),
  );
}

export function parseAnalysisEvaluation(input: unknown): AnalysisEvaluationNote {
  if (!isRecord(input)) {
    throw new EvaluationValidationError("Evaluation note must be a JSON object.");
  }

  assertLiteral(input.schemaVersion, EVALUATION_SCHEMA_VERSION, "schemaVersion");
  assertString(input.sourceContentHash, "sourceContentHash");
  assertString(input.sourcePathHint, "sourcePathHint");
  assertIsoTimestamp(input.createdAt, "createdAt");

  const expected = assertRecord(input.expected, "expected");
  assertNullableNumber(expected.bpm, "expected.bpm");
  assertNullableString(expected.downbeatPhaseId, "expected.downbeatPhaseId");
  assertStringArray(expected.notes, "expected.notes");

  const observed = assertRecord(input.observed, "observed");
  assertNullableString(observed.tempoCandidateId, "observed.tempoCandidateId");
  assertNullableString(
    observed.beatGridCandidateId,
    "observed.beatGridCandidateId",
  );
  assertNullableString(
    observed.downbeatCandidateId,
    "observed.downbeatCandidateId",
  );
  assertNullableString(observed.mixInTransitionId, "observed.mixInTransitionId");
  assertNullableString(
    observed.mixOutTransitionId,
    "observed.mixOutTransitionId",
  );

  const judgment = assertRecord(input.judgment, "judgment");
  assertOneOf(judgment.bpm, bpmJudgments, "judgment.bpm");
  assertOneOf(judgment.beatGrid, beatGridJudgments, "judgment.beatGrid");
  assertOneOf(judgment.downbeat, downbeatJudgments, "judgment.downbeat");
  assertOneOf(
    judgment.transitions,
    transitionJudgments,
    "judgment.transitions",
  );
  assertOneOf(judgment.overall, overallJudgments, "judgment.overall");

  const corrections = assertRecord(input.corrections, "corrections");
  assertNullableNumber(corrections.bpm, "corrections.bpm");
  assertNullableNumber(corrections.firstBeatSec, "corrections.firstBeatSec");
  assertNullableNumber(
    corrections.firstDownbeatSec,
    "corrections.firstDownbeatSec",
  );
  assertNumberArray(corrections.mixInSec, "corrections.mixInSec");
  assertNumberArray(corrections.mixOutSec, "corrections.mixOutSec");
  assertStringArray(input.notes, "notes");

  return input as unknown as AnalysisEvaluationNote;
}

async function assertInputFile(path: string, label: string): Promise<void> {
  const inputStat = await stat(path).catch((error: unknown) => {
    throw new Error(`${label} not found: ${path}`, { cause: error });
  });

  if (!inputStat.isFile()) {
    throw new Error(`${label} path must be a file: ${path}`);
  }
}

async function assertOutputWritable(path: string, force = false): Promise<void> {
  const outputExists = await stat(path)
    .then(() => true)
    .catch(() => false);

  if (outputExists && !force) {
    throw new Error(`Output already exists, use --force to overwrite: ${path}`);
  }
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} JSON: ${message}`, { cause: error });
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertLiteral<T>(
  value: unknown,
  expected: T,
  label: string,
): asserts value is T {
  if (value !== expected) {
    throw new EvaluationValidationError(
      `${label} must be ${String(expected)}.`,
    );
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new EvaluationValidationError(`${label} must be an object.`);
  }

  return value;
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EvaluationValidationError(`${label} must be a non-empty string.`);
  }
}

function assertNullableString(
  value: unknown,
  label: string,
): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new EvaluationValidationError(`${label} must be a string or null.`);
  }
}

function assertNullableNumber(
  value: unknown,
  label: string,
): asserts value is number | null {
  if (value !== null && typeof value !== "number") {
    throw new EvaluationValidationError(`${label} must be a number or null.`);
  }
}

function assertNumberArray(value: unknown, label: string): asserts value is number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new EvaluationValidationError(`${label} must be an array of numbers.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new EvaluationValidationError(`${label} must be an array of strings.`);
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assertString(value, label);

  if (Number.isNaN(Date.parse(value))) {
    throw new EvaluationValidationError(`${label} must be an ISO timestamp.`);
  }
}

function assertOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
  label: string,
): asserts value is T[number] {
  if (typeof value !== "string" || !options.includes(value)) {
    throw new EvaluationValidationError(
      `${label} must be one of: ${options.join(", ")}.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
