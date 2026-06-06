import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AnalysisEvaluationNote,
  type BeatGridJudgment,
  type BpmJudgment,
  type DownbeatJudgment,
  type OverallJudgment,
  type TransitionJudgment,
  validateEvaluationFile,
} from "./evaluation.js";

const bpmJudgments: BpmJudgment[] = [
  "correct",
  "half",
  "double",
  "wrong",
  "unknown",
];
const beatGridJudgments: BeatGridJudgment[] = [
  "aligned",
  "shifted",
  "unstable",
  "wrong",
  "unknown",
];
const downbeatJudgments: DownbeatJudgment[] = [
  "correct",
  "wrongPhase",
  "ambiguous",
  "unknown",
];
const transitionJudgments: TransitionJudgment[] = [
  "plausible",
  "tooEarly",
  "tooLate",
  "wrong",
  "unknown",
];
const overallJudgments: OverallJudgment[] = [
  "usable",
  "needsManualCorrection",
  "reject",
  "unknown",
];

export type EvaluationSummaryFormat = "json" | "markdown";

export interface EvaluationSummaryOptions {
  inputPaths: string[];
  outPath: string;
  force?: boolean;
  format?: EvaluationSummaryFormat;
}

export interface EvaluationNoteSummary {
  sourceContentHash: string;
  sourcePathHint: string;
  expectedNotes: string[];
  notes: string[];
}

export interface EvaluationSummary {
  summaryVersion: 1;
  total: number;
  judgments: {
    bpm: Record<BpmJudgment, number>;
    beatGrid: Record<BeatGridJudgment, number>;
    downbeat: Record<DownbeatJudgment, number>;
    transitions: Record<TransitionJudgment, number>;
    overall: Record<OverallJudgment, number>;
  };
  correctionCounts: {
    bpm: number;
    firstBeatSec: number;
    firstDownbeatSec: number;
    mixInSec: number;
    mixOutSec: number;
  };
  notes: EvaluationNoteSummary[];
}

export function summarizeEvaluations(
  evaluations: AnalysisEvaluationNote[],
): EvaluationSummary {
  if (evaluations.length === 0) {
    throw new Error("No evaluation notes were provided.");
  }

  const summary: EvaluationSummary = {
    summaryVersion: 1,
    total: evaluations.length,
    judgments: {
      bpm: createCountMap(bpmJudgments),
      beatGrid: createCountMap(beatGridJudgments),
      downbeat: createCountMap(downbeatJudgments),
      transitions: createCountMap(transitionJudgments),
      overall: createCountMap(overallJudgments),
    },
    correctionCounts: {
      bpm: 0,
      firstBeatSec: 0,
      firstDownbeatSec: 0,
      mixInSec: 0,
      mixOutSec: 0,
    },
    notes: [],
  };

  for (const evaluation of evaluations) {
    summary.judgments.bpm[evaluation.judgment.bpm] += 1;
    summary.judgments.beatGrid[evaluation.judgment.beatGrid] += 1;
    summary.judgments.downbeat[evaluation.judgment.downbeat] += 1;
    summary.judgments.transitions[evaluation.judgment.transitions] += 1;
    summary.judgments.overall[evaluation.judgment.overall] += 1;

    if (evaluation.corrections.bpm != null) {
      summary.correctionCounts.bpm += 1;
    }
    if (evaluation.corrections.firstBeatSec != null) {
      summary.correctionCounts.firstBeatSec += 1;
    }
    if (evaluation.corrections.firstDownbeatSec != null) {
      summary.correctionCounts.firstDownbeatSec += 1;
    }
    if (evaluation.corrections.mixInSec.length > 0) {
      summary.correctionCounts.mixInSec += 1;
    }
    if (evaluation.corrections.mixOutSec.length > 0) {
      summary.correctionCounts.mixOutSec += 1;
    }

    if (evaluation.notes.length > 0 || evaluation.expected.notes.length > 0) {
      summary.notes.push({
        sourceContentHash: evaluation.sourceContentHash,
        sourcePathHint: evaluation.sourcePathHint,
        expectedNotes: evaluation.expected.notes,
        notes: evaluation.notes,
      });
    }
  }

  return summary;
}

export async function writeEvaluationSummary(
  options: EvaluationSummaryOptions,
): Promise<EvaluationSummary> {
  await assertOutputWritable(options.outPath, options.force);

  const evaluationPaths = await resolveEvaluationPaths(options.inputPaths);
  if (evaluationPaths.length === 0) {
    throw new Error("No evaluation files found.");
  }

  const evaluations = await Promise.all(
    evaluationPaths.map((inputPath) => validateEvaluationFile({ inputPath })),
  );
  const summary = summarizeEvaluations(evaluations);
  const format = options.format ?? "json";
  const output =
    format === "markdown"
      ? renderEvaluationSummaryMarkdown(summary)
      : `${JSON.stringify(summary, null, 2)}\n`;

  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, output, "utf8");

  return summary;
}

export function renderEvaluationSummaryMarkdown(
  summary: EvaluationSummary,
): string {
  return [
    "# Luumix Evaluation Summary",
    "",
    `Total evaluations: ${summary.total}`,
    "",
    renderCountTable("BPM", summary.judgments.bpm),
    renderCountTable("Beat Grid", summary.judgments.beatGrid),
    renderCountTable("Downbeat", summary.judgments.downbeat),
    renderCountTable("Transitions", summary.judgments.transitions),
    renderCountTable("Overall", summary.judgments.overall),
    "## Correction Counts",
    "",
    "| Correction | Count |",
    "| --- | ---: |",
    `| BPM | ${summary.correctionCounts.bpm} |`,
    `| First beat | ${summary.correctionCounts.firstBeatSec} |`,
    `| First downbeat | ${summary.correctionCounts.firstDownbeatSec} |`,
    `| Mix-in | ${summary.correctionCounts.mixInSec} |`,
    `| Mix-out | ${summary.correctionCounts.mixOutSec} |`,
    "",
    "## Notes",
    "",
    ...renderNotes(summary.notes),
  ].join("\n");
}

async function resolveEvaluationPaths(inputPaths: string[]): Promise<string[]> {
  if (inputPaths.length === 0) {
    throw new Error("No evaluation input paths provided.");
  }

  const resolved: string[] = [];
  for (const inputPath of inputPaths) {
    const inputStat = await stat(inputPath).catch((error: unknown) => {
      throw new Error(`Evaluation input path not found: ${inputPath}`, {
        cause: error,
      });
    });

    if (inputStat.isDirectory()) {
      const entries = await readdir(inputPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".evaluation.json")) {
          resolved.push(join(inputPath, entry.name));
        }
      }
      continue;
    }

    if (!inputStat.isFile()) {
      throw new Error(`Evaluation input path must be a file or directory: ${inputPath}`);
    }

    resolved.push(inputPath);
  }

  return [...new Set(resolved)].sort();
}

async function assertOutputWritable(path: string, force = false): Promise<void> {
  const outputExists = await stat(path)
    .then(() => true)
    .catch(() => false);

  if (outputExists && !force) {
    throw new Error(`Output already exists, use --force to overwrite: ${path}`);
  }
}

function createCountMap<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function renderCountTable<T extends string>(
  title: string,
  counts: Record<T, number>,
): string {
  return [
    `## ${title}`,
    "",
    "| Judgment | Count |",
    "| --- | ---: |",
    ...Object.entries<number>(counts).map(
      ([judgment, count]) => `| ${judgment} | ${count} |`,
    ),
    "",
  ].join("\n");
}

function renderNotes(notes: EvaluationNoteSummary[]): string[] {
  if (notes.length === 0) {
    return ["No notes recorded.", ""];
  }

  return notes.flatMap((entry) => [
    `### ${entry.sourceContentHash}`,
    "",
    `Path hint: ${entry.sourcePathHint || "(none)"}`,
    "",
    ...entry.expectedNotes.map((note) => `- Expected: ${note}`),
    ...entry.notes.map((note) => `- Note: ${note}`),
    "",
  ]);
}
