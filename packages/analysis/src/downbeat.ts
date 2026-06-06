import type {
  BeatGridCandidate,
  DownbeatCandidate,
  FeatureSummary,
} from "@luumix/metadata";

export interface DownbeatEstimationInput {
  beatGridCandidates: BeatGridCandidate[];
  featureSummary: FeatureSummary;
  durationSec: number;
}

const PHASE_COUNT = 4;

export function estimateDownbeatCandidates(
  input: DownbeatEstimationInput,
): DownbeatCandidate[] {
  const beatGrid =
    input.beatGridCandidates.find((candidate) => candidate.id === "beat-grid-primary") ??
    input.beatGridCandidates[0];

  if (!beatGrid || beatGrid.beatsSec.length === 0 || input.durationSec <= 0) {
    return [];
  }

  const phaseScores = scoreDownbeatPhases({
    beatGrid,
    featureSummary: input.featureSummary,
  });
  const maxScore = Math.max(0, ...phaseScores);
  const minScore = Math.min(...phaseScores);
  const scoreRange = Math.max(0.001, maxScore - minScore);

  return Array.from({ length: PHASE_COUNT }, (_, phaseBeatIndex) => {
    const downbeatsSec = beatGrid.beatsSec.filter(
      (_beatSec, beatIndex) => beatIndex % PHASE_COUNT === phaseBeatIndex,
    );
    const normalizedScore = (phaseScores[phaseBeatIndex] - minScore) / scoreRange;
    const confidence = roundScore(0.22 + normalizedScore * 0.2);

    return {
      id: `downbeat-phase-${phaseBeatIndex}`,
      beatGridId: beatGrid.id,
      phaseBeatIndex,
      confidence,
      downbeatsSec,
      supportingSignals: [
        "Generated as one of four 4/4 phase hypotheses from the beat grid.",
        "Confidence reflects coarse feature energy near this phase, not confirmed musical downbeats.",
      ],
    };
  });
}

export function isDownbeatAmbiguous(candidates: DownbeatCandidate[]): boolean {
  if (candidates.length < PHASE_COUNT) {
    return true;
  }

  const confidences = candidates
    .map((candidate) => candidate.confidence)
    .sort((a, b) => b - a);
  const best = confidences[0] ?? 0;
  const second = confidences[1] ?? 0;

  return best < 0.52 || best - second < 0.12;
}

function scoreDownbeatPhases(input: {
  beatGrid: BeatGridCandidate;
  featureSummary: FeatureSummary;
}): number[] {
  const envelope =
    input.featureSummary.rmsEnvelope ?? input.featureSummary.peakEnvelope ?? [];
  const frameHopSec = input.featureSummary.frameHopSec;

  if (envelope.length === 0 || !Number.isFinite(frameHopSec) || frameHopSec <= 0) {
    return new Array(PHASE_COUNT).fill(0);
  }

  return Array.from({ length: PHASE_COUNT }, (_, phaseBeatIndex) => {
    const alignedBeats = input.beatGrid.beatsSec.filter(
      (_beatSec, beatIndex) => beatIndex % PHASE_COUNT === phaseBeatIndex,
    );

    if (alignedBeats.length === 0) {
      return 0;
    }

    const energy = alignedBeats.reduce(
      (sum, beatSec) => sum + featureEnergyNearTime(envelope, frameHopSec, beatSec),
      0,
    );

    return energy / alignedBeats.length;
  });
}

function featureEnergyNearTime(
  envelope: number[],
  frameHopSec: number,
  timeSec: number,
): number {
  const frameIndex = Math.round(timeSec / frameHopSec);
  const previous = envelope[frameIndex - 1] ?? 0;
  const current = envelope[frameIndex] ?? 0;
  const next = envelope[frameIndex + 1] ?? 0;

  return Math.max(0, previous, current, next);
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
