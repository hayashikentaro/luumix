import {
  METADATA_SCHEMA_VERSION,
  parseTrackAnalysisMetadata,
  type FeatureSummary,
  type BeatGridCandidate,
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
import { estimateTempoCandidates } from "./tempo.js";

export { estimateBeatGridCandidates } from "./beat-grid.js";
export type { BeatGridEstimationInput } from "./beat-grid.js";
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
      downbeatCandidates: [],
      structureCandidates: [],
      transitionCandidates: {
        mixIn: [],
        mixOut: [],
        avoid: [],
      },
      riskSignals: {
        tempoUnstable: isTempoUnstable(tempoCandidates),
        downbeatAmbiguous: true,
        doubleTempoAmbiguous: hasDerivedTempoAlternatives(tempoCandidates),
        lowConfidence: isLowConfidenceAnalysis(tempoCandidates, beatGridCandidates),
        notes: buildRiskNotes(tempoCandidates, beatGridCandidates),
      },
      defaults: {
        ...(primaryTempoCandidate ? { tempoCandidateId: primaryTempoCandidate.id } : {}),
        ...(primaryBeatGridCandidate
          ? { beatGridCandidateId: primaryBeatGridCandidate.id }
          : {}),
        autoMix: {
          status: "rejected",
          reasons: [
            "Downbeat and bar-phase analysis are not implemented, so this track is not safe for automatic mixing.",
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
): boolean {
  const primaryBeatGrid = beatGridCandidates.find(
    (candidate) => candidate.id === "beat-grid-primary",
  );

  return (
    isLowConfidenceTempo(tempoCandidates) ||
    !primaryBeatGrid ||
    primaryBeatGrid.confidence < 0.5
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
      "Downbeat analysis is not implemented.",
    ];
  }

  return [
    "Tempo candidates are heuristic estimates from low-level feature summaries.",
    "Beat grid candidates are heuristic phase alignments against low-level feature summaries.",
    "Downbeat analysis is not implemented.",
  ];
}
