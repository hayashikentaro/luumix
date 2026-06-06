import {
  AiReviewSchema,
  parseTrackAnalysisMetadata,
  resolveEffectiveMetadata,
  type AiReview,
  type TrackAnalysisMetadata,
} from "@luumix/metadata";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ApplyAiReviewOptions {
  inputPath: string;
  aiReviewPath: string;
  outPath: string;
  force?: boolean;
}

export class AiReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiReviewValidationError";
  }
}

export function applyAiReview(
  metadata: TrackAnalysisMetadata,
  aiReview: AiReview,
): TrackAnalysisMetadata {
  validateAiReviewCandidateIds(metadata, aiReview);

  const reviewedInput: TrackAnalysisMetadata = {
    ...metadata,
    aiReview,
    effective: null,
  };

  return parseTrackAnalysisMetadata({
    ...reviewedInput,
    effective: resolveEffectiveMetadata(reviewedInput),
  });
}

export async function writeAiReviewedMetadata(
  options: ApplyAiReviewOptions,
): Promise<TrackAnalysisMetadata> {
  await assertInputFile(options.inputPath, "Input metadata file");
  await assertInputFile(options.aiReviewPath, "AI review file");
  await assertOutputWritable(options.outPath, options.force);

  const metadata = await readTrackAnalysisMetadata(options.inputPath);
  const aiReview = await readAiReview(options.aiReviewPath);
  const reviewed = applyAiReview(metadata, aiReview);

  await writeJsonFile(options.outPath, reviewed);
  return reviewed;
}

function validateAiReviewCandidateIds(
  metadata: TrackAnalysisMetadata,
  aiReview: AiReview,
): void {
  validateCandidateId({
    candidates: metadata.analysis.tempoCandidates,
    id: aiReview.selectedTempoCandidateId,
    label: "selectedTempoCandidateId",
  });
  validateCandidateId({
    candidates: metadata.analysis.beatGridCandidates,
    id: aiReview.selectedBeatGridCandidateId,
    label: "selectedBeatGridCandidateId",
  });
  validateCandidateId({
    candidates: metadata.analysis.downbeatCandidates,
    id: aiReview.selectedDownbeatCandidateId,
    label: "selectedDownbeatCandidateId",
  });
  validateCandidateId({
    candidates: metadata.analysis.transitionCandidates.mixIn,
    id: aiReview.selectedMixInTransitionId,
    label: "selectedMixInTransitionId",
  });
  validateCandidateId({
    candidates: metadata.analysis.transitionCandidates.mixOut,
    id: aiReview.selectedMixOutTransitionId,
    label: "selectedMixOutTransitionId",
  });
}

function validateCandidateId(input: {
  candidates: Array<{ id: string }>;
  id: string | undefined;
  label: string;
}): void {
  if (!input.id) {
    return;
  }

  if (!input.candidates.some((candidate) => candidate.id === input.id)) {
    throw new AiReviewValidationError(
      `Invalid ${input.label}: candidate does not exist: ${input.id}`,
    );
  }
}

async function readTrackAnalysisMetadata(
  path: string,
): Promise<TrackAnalysisMetadata> {
  try {
    return parseTrackAnalysisMetadata(await readJsonFile(path, "analysis metadata"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid analysis metadata: ${message}`, { cause: error });
  }
}

async function readAiReview(path: string): Promise<AiReview> {
  try {
    return AiReviewSchema.parse(await readJsonFile(path, "AI review"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid AI review file: ${message}`, { cause: error });
  }
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
