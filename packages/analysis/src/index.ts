import {
  METADATA_SCHEMA_VERSION,
  parseTrackAnalysisMetadata,
  type FeatureSummary,
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
      tempoCandidates: [],
      beatGridCandidates: [],
      downbeatCandidates: [],
      structureCandidates: [],
      transitionCandidates: {
        mixIn: [],
        mixOut: [],
        avoid: [],
      },
      riskSignals: {
        tempoUnstable: true,
        downbeatAmbiguous: true,
        doubleTempoAmbiguous: true,
        lowConfidence: true,
        notes: [
          "Source audio was probed, but rhythm analysis is not implemented.",
        ],
      },
      defaults: {
        autoMix: {
          status: "rejected",
          reasons: [
            "Rhythm analysis is not implemented, so this track is not safe for automatic mixing.",
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
