import {
  parseTrackAnalysisMetadata,
  type AnalysisDefaults,
  type AutoMixStatus,
  type BeatGridCandidate,
  type DownbeatCandidate,
  type RiskSignals,
  type SourceFileMetadata,
  type StructureCandidate,
  type TempoCandidate,
  type TrackAnalysisMetadata,
  type TransitionCandidates,
} from "@luumix/metadata";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PROMPT_INPUT_VERSION = 1;
const MAX_TIMING_SAMPLES = 12;

export interface AiReviewInputOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
}

export interface AiReviewInput {
  promptInputVersion: typeof PROMPT_INPUT_VERSION;
  source: Pick<
    SourceFileMetadata,
    "durationSec" | "sampleRate" | "channels" | "codec" | "container"
  >;
  riskSignals: RiskSignals;
  tempoCandidates: TempoCandidate[];
  beatGridCandidates: BeatGridCandidateSummary[];
  downbeatCandidates: DownbeatCandidateSummary[];
  structureCandidates: StructureCandidate[];
  transitionCandidates: TransitionCandidates;
  defaults: AnalysisDefaults;
  reviewerTask: {
    select: Array<
      | "selectedTempoCandidateId"
      | "selectedBeatGridCandidateId"
      | "selectedDownbeatCandidateId"
      | "selectedMixInTransitionId"
      | "selectedMixOutTransitionId"
    >;
    classifyAutoMixStatusAs: AutoMixStatus[];
    provideReasons: boolean;
  };
  constraints: string[];
}

export interface BeatGridCandidateSummary
  extends Omit<BeatGridCandidate, "beatsSec"> {
  beatCount: number;
  firstBeatsSec: number[];
}

export interface DownbeatCandidateSummary
  extends Omit<DownbeatCandidate, "downbeatsSec"> {
  downbeatCount: number;
  firstDownbeatsSec: number[];
}

export async function writeAiReviewInput(
  options: AiReviewInputOptions,
): Promise<AiReviewInput> {
  await assertInputFile(options.inputPath);
  await assertOutputWritable(options.outPath, options.force);

  const metadata = await readAnalysisMetadata(options.inputPath);
  const input = createAiReviewInput(metadata);

  await writeJsonFile(options.outPath, input);
  return input;
}

export function createAiReviewInput(
  metadata: TrackAnalysisMetadata,
): AiReviewInput {
  return {
    promptInputVersion: PROMPT_INPUT_VERSION,
    source: {
      durationSec: metadata.sourceFile.durationSec,
      sampleRate: metadata.sourceFile.sampleRate,
      channels: metadata.sourceFile.channels,
      codec: metadata.sourceFile.codec,
      container: metadata.sourceFile.container,
    },
    riskSignals: metadata.analysis.riskSignals,
    tempoCandidates: metadata.analysis.tempoCandidates,
    beatGridCandidates: metadata.analysis.beatGridCandidates.map(
      summarizeBeatGridCandidate,
    ),
    downbeatCandidates: metadata.analysis.downbeatCandidates.map(
      summarizeDownbeatCandidate,
    ),
    structureCandidates: metadata.analysis.structureCandidates,
    transitionCandidates: metadata.analysis.transitionCandidates,
    defaults: metadata.analysis.defaults,
    reviewerTask: {
      select: [
        "selectedTempoCandidateId",
        "selectedBeatGridCandidateId",
        "selectedDownbeatCandidateId",
        "selectedMixInTransitionId",
        "selectedMixOutTransitionId",
      ],
      classifyAutoMixStatusAs: ["approved", "risky", "rejected"],
      provideReasons: true,
    },
    constraints: [
      "Do not invent candidate IDs; choose only IDs present in this input.",
      "You may reject the track when the candidates are weak, ambiguous, or unsuitable for automatic mixing.",
      "Prefer risky over approved when uncertain.",
      "Optimize for focused-work background mixing, not club performance.",
    ],
  };
}

function summarizeBeatGridCandidate(
  candidate: BeatGridCandidate,
): BeatGridCandidateSummary {
  const { beatsSec, ...summary } = candidate;
  return {
    ...summary,
    beatCount: beatsSec.length,
    firstBeatsSec: beatsSec.slice(0, MAX_TIMING_SAMPLES),
  };
}

function summarizeDownbeatCandidate(
  candidate: DownbeatCandidate,
): DownbeatCandidateSummary {
  const { downbeatsSec, ...summary } = candidate;
  return {
    ...summary,
    downbeatCount: downbeatsSec.length,
    firstDownbeatsSec: downbeatsSec.slice(0, MAX_TIMING_SAMPLES),
  };
}

async function readAnalysisMetadata(path: string): Promise<TrackAnalysisMetadata> {
  try {
    return parseTrackAnalysisMetadata(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid analysis metadata: ${message}`, { cause: error });
  }
}

async function assertInputFile(path: string): Promise<void> {
  const inputStat = await stat(path).catch((error: unknown) => {
    throw new Error(`Input metadata file not found: ${path}`, { cause: error });
  });

  if (!inputStat.isFile()) {
    throw new Error(`Input metadata path must be a file: ${path}`);
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

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
