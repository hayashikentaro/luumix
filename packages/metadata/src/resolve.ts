import {
  type AiReview,
  type AnalysisMetadata,
  METADATA_SCHEMA_VERSION,
  type AutoMixDecision,
  type BeatGridCandidate,
  type DownbeatCandidate,
  type EffectiveTrackMetadata,
  type TempoCandidate,
  type TrackAnalysisMetadata,
  type TransitionCandidate,
} from "./types.js";

export class MetadataResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataResolutionError";
  }
}

export function resolveEffectiveMetadata(
  metadata: TrackAnalysisMetadata,
): EffectiveTrackMetadata {
  const tempo = selectTempo(metadata);
  const beatGrid = selectBeatGrid(metadata, tempo);
  const downbeat = selectDownbeat(metadata, beatGrid);
  const mixInSec = selectTransitionTimes(metadata, "mixIn");
  const mixOutSec = selectTransitionTimes(metadata, "mixOut");
  const autoMix = selectAutoMix(metadata);

  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    sourceFile: metadata.sourceFile,
    bpm: tempo.bpm,
    bpmSource: tempo.source,
    beatGrid: {
      source: beatGrid.source,
      candidateId: beatGrid.candidate?.id,
      firstBeatSec: beatGrid.firstBeatSec,
      bpm: tempo.bpm,
      beatsSec: beatGrid.beatsSec,
    },
    downbeat: {
      source: downbeat.source,
      candidateId: downbeat.candidate?.id,
      firstDownbeatSec: downbeat.firstDownbeatSec,
      downbeatsSec: downbeat.downbeatsSec,
    },
    mixInSec,
    mixOutSec,
    autoMix,
  };
}

function selectTempo(metadata: TrackAnalysisMetadata): {
  bpm: number;
  source: "manual" | "aiReview" | "analysis";
  candidate?: TempoCandidate;
} {
  if (metadata.manualOverrides.bpm != null) {
    return { bpm: metadata.manualOverrides.bpm, source: "manual" };
  }

  const aiTempo = selectCandidate(
    metadata.analysis.tempoCandidates,
    metadata.aiReview,
    "selectedTempoCandidateId",
  );
  if (aiTempo) {
    return { bpm: aiTempo.bpm, source: "aiReview", candidate: aiTempo };
  }

  const analysisTempo = findRequired(
    metadata.analysis.tempoCandidates,
    metadata.analysis.defaults.tempoCandidateId,
    "tempo candidate",
  );
  return { bpm: analysisTempo.bpm, source: "analysis", candidate: analysisTempo };
}

function selectBeatGrid(
  metadata: TrackAnalysisMetadata,
  tempo: { bpm: number; source: "manual" | "aiReview" | "analysis" },
): {
  source: "manual" | "aiReview" | "analysis";
  firstBeatSec: number;
  beatsSec: number[];
  candidate?: BeatGridCandidate;
} {
  const manual = metadata.manualOverrides.beatGrid;
  if (manual) {
    return {
      source: "manual",
      firstBeatSec: manual.firstBeatSec,
      beatsSec: [],
    };
  }

  if (metadata.manualOverrides.firstBeatSec != null) {
    return {
      source: "manual",
      firstBeatSec: metadata.manualOverrides.firstBeatSec,
      beatsSec: [],
    };
  }

  const aiBeatGrid = selectCandidate(
    metadata.analysis.beatGridCandidates,
    metadata.aiReview,
    "selectedBeatGridCandidateId",
  );
  if (aiBeatGrid) {
    return {
      source: "aiReview",
      firstBeatSec: aiBeatGrid.firstBeatSec,
      beatsSec: aiBeatGrid.beatsSec,
      candidate: aiBeatGrid,
    };
  }

  const analysisBeatGrid = findRequired(
    metadata.analysis.beatGridCandidates,
    metadata.analysis.defaults.beatGridCandidateId,
    "beat grid candidate",
  );
  return {
    source: tempo.source === "manual" ? "manual" : "analysis",
    firstBeatSec: analysisBeatGrid.firstBeatSec,
    beatsSec: analysisBeatGrid.beatsSec,
    candidate: analysisBeatGrid,
  };
}

function selectDownbeat(
  metadata: TrackAnalysisMetadata,
  beatGrid: { source: "manual" | "aiReview" | "analysis" },
): {
  source: "manual" | "aiReview" | "analysis";
  firstDownbeatSec: number;
  downbeatsSec: number[];
  candidate?: DownbeatCandidate;
} {
  if (metadata.manualOverrides.firstDownbeatSec != null) {
    return {
      source: "manual",
      firstDownbeatSec: metadata.manualOverrides.firstDownbeatSec,
      downbeatsSec: [],
    };
  }

  const aiDownbeat = selectCandidate(
    metadata.analysis.downbeatCandidates,
    metadata.aiReview,
    "selectedDownbeatCandidateId",
  );
  if (aiDownbeat) {
    return {
      source: "aiReview",
      firstDownbeatSec: aiDownbeat.downbeatsSec[0] ?? 0,
      downbeatsSec: aiDownbeat.downbeatsSec,
      candidate: aiDownbeat,
    };
  }

  const analysisDownbeat = findRequired(
    metadata.analysis.downbeatCandidates,
    metadata.analysis.defaults.downbeatCandidateId,
    "downbeat candidate",
  );
  return {
    source: beatGrid.source === "manual" ? "manual" : "analysis",
    firstDownbeatSec: analysisDownbeat.downbeatsSec[0] ?? 0,
    downbeatsSec: analysisDownbeat.downbeatsSec,
    candidate: analysisDownbeat,
  };
}

function selectTransitionTimes(
  metadata: TrackAnalysisMetadata,
  kind: "mixIn" | "mixOut",
): number[] {
  const manualTimes =
    kind === "mixIn"
      ? metadata.manualOverrides.mixInSec
      : metadata.manualOverrides.mixOutSec;

  if (manualTimes && manualTimes.length > 0) {
    return manualTimes;
  }

  const aiId =
    kind === "mixIn"
      ? metadata.aiReview?.selectedMixInTransitionId
      : metadata.aiReview?.selectedMixOutTransitionId;

  const aiTransition = findById(
    metadata.analysis.transitionCandidates[kind],
    aiId,
  );
  if (aiTransition) {
    return [aiTransition.timeSec];
  }

  const analysisId =
    kind === "mixIn"
      ? metadata.analysis.defaults.mixInTransitionId
      : metadata.analysis.defaults.mixOutTransitionId;

  const analysisTransition = findRequired(
    metadata.analysis.transitionCandidates[kind],
    analysisId,
    `${kind} transition candidate`,
  );
  return [analysisTransition.timeSec];
}

function selectAutoMix(metadata: TrackAnalysisMetadata): AutoMixDecision {
  if (metadata.manualOverrides.autoMixDisabled) {
    return {
      status: "rejected",
      reasons: ["Manual override disabled automatic mixing."],
    };
  }

  if (metadata.aiReview) {
    return metadata.aiReview.autoMix;
  }

  return (
    metadata.analysis.defaults.autoMix ?? {
      status: "risky",
      reasons: ["No AI review or analysis auto-mix default is available."],
    }
  );
}

function selectCandidate<
  T extends { id: string },
  K extends keyof AiReview,
>(
  candidates: T[],
  aiReview: AiReview | null,
  key: K,
): T | undefined {
  const id = aiReview?.[key];
  return typeof id === "string" ? findById(candidates, id) : undefined;
}

function findRequired<T extends { id: string }>(
  candidates: T[],
  id: string | undefined,
  label: string,
): T {
  const candidate = findById(candidates, id);
  if (!candidate) {
    throw new MetadataResolutionError(`Missing selected ${label}: ${id ?? "(none)"}`);
  }
  return candidate;
}

function findById<T extends { id: string }>(
  candidates: T[],
  id: string | undefined,
): T | undefined {
  if (!id) {
    return undefined;
  }

  return candidates.find((candidate) => candidate.id === id);
}
