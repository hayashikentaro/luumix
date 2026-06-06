import {
  METADATA_SCHEMA_VERSION,
  parseTrackAnalysisMetadata,
  type FeatureSummary,
  type BeatGridCandidate,
  type DownbeatCandidate,
  type TempoCandidate,
  type TrackAnalysisMetadata,
} from "@luumix/metadata";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  extractFeatureSummary,
  type FeatureExtractor,
} from "./features.js";
import {
  probeAudioFile,
  type AudioProbe,
  type AudioProbeResult,
} from "./probe.js";
import { estimateBeatGridCandidates } from "./beat-grid.js";
import {
  estimateDownbeatCandidates,
  isDownbeatAmbiguous,
} from "./downbeat.js";
import {
  estimateStructureCandidates,
  estimateTransitionCandidates,
} from "./structure.js";
import { estimateTempoCandidates } from "./tempo.js";

export {
  applyAiReview,
  writeAiReviewedMetadata,
} from "./ai-review.js";
export type { ApplyAiReviewOptions } from "./ai-review.js";
export {
  createAiReviewInput,
  writeAiReviewInput,
} from "./ai-review-input.js";
export type {
  AiReviewInput,
  AiReviewInputOptions,
  BeatGridCandidateSummary,
  DownbeatCandidateSummary,
} from "./ai-review-input.js";
export {
  writeOverrideTemplate,
  writeResolvedMetadata,
} from "./effective.js";
export type {
  InitOverridesOptions,
  ResolveEffectiveOptions,
} from "./effective.js";
export {
  createEvaluationTemplate,
  parseAnalysisEvaluation,
  validateEvaluationFile,
  writeEvaluationTemplate,
} from "./evaluation.js";
export type {
  AnalysisEvaluationNote,
  BpmJudgment,
  BeatGridJudgment,
  DownbeatJudgment,
  InitEvaluationOptions,
  OverallJudgment,
  TransitionJudgment,
  ValidateEvaluationOptions,
} from "./evaluation.js";
export {
  renderEvaluationSummaryMarkdown,
  summarizeEvaluations,
  writeEvaluationSummary,
} from "./evaluation-summary.js";
export type {
  EvaluationNoteSummary,
  EvaluationSummary,
  EvaluationSummaryFormat,
  EvaluationSummaryOptions,
} from "./evaluation-summary.js";
export { estimateBeatGridCandidates } from "./beat-grid.js";
export type { BeatGridEstimationInput } from "./beat-grid.js";
export {
  estimateDownbeatCandidates,
  isDownbeatAmbiguous,
} from "./downbeat.js";
export type { DownbeatEstimationInput } from "./downbeat.js";
export {
  estimateStructureCandidates,
  estimateTransitionCandidates,
} from "./structure.js";
export type {
  StructureEstimationInput,
  TransitionEstimationInput,
} from "./structure.js";
export { estimateTempoCandidates } from "./tempo.js";
export type { TempoEstimationOptions } from "./tempo.js";

export interface AnalyzeOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
  extractFeatures?: FeatureExtractor;
  probeAudio?: AudioProbe;
}

export async function analyzeFile(options: AnalyzeOptions): Promise<TrackAnalysisMetadata> {
  const inputStat = await stat(options.inputPath).catch((error: unknown) => {
    throw new Error(`Input file not found: ${options.inputPath}`, { cause: error });
  });

  if (!inputStat.isFile()) {
    throw new Error(`Input path must be a file: ${options.inputPath}`);
  }

  const outputExists = await stat(options.outPath)
    .then(() => true)
    .catch(() => false);

  if (outputExists && !options.force) {
    throw new Error(`Output already exists, use --force to overwrite: ${options.outPath}`);
  }

  const content = await readFile(options.inputPath);
  const audioProbe = await (options.probeAudio ?? probeAudioFile)(options.inputPath);
  const featureSummary = await (options.extractFeatures ?? extractFeatureSummary)(
    options.inputPath,
  );
  const metadata = createPlaceholderMetadata({
    audioProbe,
    content,
    featureSummary,
    fileSizeBytes: inputStat.size,
    inputPath: options.inputPath,
  });

  const parsed = parseTrackAnalysisMetadata(metadata);
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  return parsed;
}

export function createPlaceholderMetadata(input: {
  audioProbe: AudioProbeResult;
  content: Buffer;
  featureSummary: FeatureSummary;
  fileSizeBytes: number;
  inputPath: string;
}): TrackAnalysisMetadata {
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const tempoCandidates = estimateTempoCandidates(input.featureSummary);
  const primaryTempoCandidate = tempoCandidates.find(
    (candidate) => candidate.id === "tempo-primary",
  );
  const beatGridCandidates = estimateBeatGridCandidates({
    durationSec: input.audioProbe.durationSec,
    featureSummary: input.featureSummary,
    tempoCandidates,
  });
  const primaryBeatGridCandidate = beatGridCandidates.find(
    (candidate) => candidate.id === "beat-grid-primary",
  );
  const downbeatCandidates = estimateDownbeatCandidates({
    beatGridCandidates,
    durationSec: input.audioProbe.durationSec,
    featureSummary: input.featureSummary,
  });
  const primaryDownbeatCandidate = getHighestConfidenceDownbeat(downbeatCandidates);
  const structureCandidates = estimateStructureCandidates({
    beatGridCandidates,
    downbeatCandidates,
    durationSec: input.audioProbe.durationSec,
    featureSummary: input.featureSummary,
  });
  const transitionCandidates = estimateTransitionCandidates({
    beatGridCandidates,
    downbeatCandidates,
    durationSec: input.audioProbe.durationSec,
    featureSummary: input.featureSummary,
    structureCandidates,
  });
  const defaultMixIn = transitionCandidates.mixIn[0];
  const defaultMixOut = transitionCandidates.mixOut[0];

  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    sourceFile: {
      path: input.inputPath,
      contentHash: `sha256:${contentHash}`,
      fileSizeBytes: input.fileSizeBytes,
      durationSec: input.audioProbe.durationSec,
      sampleRate: input.audioProbe.sampleRate,
      channels: input.audioProbe.channels,
      codec: input.audioProbe.codec,
      container: input.audioProbe.container,
    },
    analysis: {
      featureSummary: input.featureSummary,
      tempoCandidates,
      beatGridCandidates,
      downbeatCandidates,
      structureCandidates,
      transitionCandidates,
      riskSignals: {
        tempoUnstable: isTempoUnstable(tempoCandidates),
        downbeatAmbiguous: isDownbeatAmbiguous(downbeatCandidates),
        doubleTempoAmbiguous: hasDerivedTempoAlternatives(tempoCandidates),
        lowConfidence: isLowConfidenceAnalysis(
          tempoCandidates,
          beatGridCandidates,
          downbeatCandidates,
        ),
        notes: buildRiskNotes(tempoCandidates, beatGridCandidates, downbeatCandidates),
      },
      defaults: {
        ...(primaryTempoCandidate ? { tempoCandidateId: primaryTempoCandidate.id } : {}),
        ...(primaryBeatGridCandidate
          ? { beatGridCandidateId: primaryBeatGridCandidate.id }
          : {}),
        ...(primaryDownbeatCandidate
          ? { downbeatCandidateId: primaryDownbeatCandidate.id }
          : {}),
        ...(defaultMixIn ? { mixInTransitionId: defaultMixIn.id } : {}),
        ...(defaultMixOut ? { mixOutTransitionId: defaultMixOut.id } : {}),
        autoMix: {
          status: "rejected",
          reasons: [
            "Structure and transition candidates are heuristic and not user-confirmed, so this track is not safe for automatic mixing.",
          ],
        },
      },
    },
    aiReview: null,
    manualOverrides: {
      bpm: null,
      beatGrid: null,
      firstBeatSec: null,
      firstDownbeatSec: null,
      mixInSec: [],
      mixOutSec: [],
      autoMixDisabled: false,
    },
    effective: null,
  };
}

function isTempoUnstable(tempoCandidates: TempoCandidate[]): boolean {
  const primary = tempoCandidates.find((candidate) => candidate.id === "tempo-primary");
  return !primary || primary.confidence < 0.6;
}

function isLowConfidenceTempo(tempoCandidates: TempoCandidate[]): boolean {
  const primary = tempoCandidates.find((candidate) => candidate.id === "tempo-primary");
  return !primary || primary.confidence < 0.5;
}

function isLowConfidenceAnalysis(
  tempoCandidates: TempoCandidate[],
  beatGridCandidates: BeatGridCandidate[],
  downbeatCandidates: DownbeatCandidate[],
): boolean {
  const primaryBeatGrid = beatGridCandidates.find(
    (candidate) => candidate.id === "beat-grid-primary",
  );
  const primaryDownbeat = getHighestConfidenceDownbeat(downbeatCandidates);

  return (
    isLowConfidenceTempo(tempoCandidates) ||
    !primaryBeatGrid ||
    primaryBeatGrid.confidence < 0.5 ||
    !primaryDownbeat ||
    primaryDownbeat.confidence < 0.4
  );
}

function hasDerivedTempoAlternatives(tempoCandidates: TempoCandidate[]): boolean {
  return tempoCandidates.some(
    (candidate) =>
      candidate.source === "derived-half" || candidate.source === "derived-double",
  );
}

function buildRiskNotes(
  tempoCandidates: TempoCandidate[],
  beatGridCandidates: BeatGridCandidate[],
  downbeatCandidates: DownbeatCandidate[],
): string[] {
  if (tempoCandidates.length === 0) {
    return [
      "Tempo estimation did not find a plausible candidate from the low-level feature summary.",
      "Beat grid and downbeat analysis were not attempted without a tempo candidate.",
    ];
  }

  if (beatGridCandidates.length === 0) {
    return [
      "Tempo candidates are heuristic estimates from low-level feature summaries.",
      "Beat grid estimation did not find a plausible phase alignment.",
      "Downbeat phase candidates were not generated without a beat grid.",
    ];
  }

  if (downbeatCandidates.length === 0) {
    return [
      "Tempo candidates are heuristic estimates from low-level feature summaries.",
      "Beat grid candidates are heuristic phase alignments against low-level feature summaries.",
      "Downbeat phase candidates were not generated.",
    ];
  }

  return [
    "Tempo candidates are heuristic estimates from low-level feature summaries.",
    "Beat grid candidates are heuristic phase alignments against low-level feature summaries.",
    "Downbeat candidates are four 4/4 phase hypotheses, not confirmed musical downbeats.",
    "Structure and transition candidates are bar-aligned inspection hints, not confirmed DJ-safe mix points.",
  ];
}

function getHighestConfidenceDownbeat(
  candidates: DownbeatCandidate[],
): DownbeatCandidate | undefined {
  return candidates.reduce<DownbeatCandidate | undefined>((best, candidate) => {
    if (!best || candidate.confidence > best.confidence) {
      return candidate;
    }

    return best;
  }, undefined);
}
