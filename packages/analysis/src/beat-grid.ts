import type {
  BeatGridCandidate,
  FeatureSummary,
  TempoCandidate,
} from "@luumix/metadata";

export interface BeatGridEstimationInput {
  featureSummary: FeatureSummary;
  tempoCandidates: TempoCandidate[];
  durationSec: number;
  maxBeats?: number;
  minScore?: number;
}

const DEFAULT_MAX_BEATS = 3600;
const DEFAULT_MIN_SCORE = 0.18;

export function estimateBeatGridCandidates(
  input: BeatGridEstimationInput,
): BeatGridCandidate[] {
  const tempoCandidate =
    input.tempoCandidates.find((candidate) => candidate.id === "tempo-primary") ??
    input.tempoCandidates[0];
  const envelope =
    input.featureSummary.rmsEnvelope ?? input.featureSummary.peakEnvelope ?? [];
  const frameHopSec = input.featureSummary.frameHopSec;

  if (
    !tempoCandidate ||
    envelope.length < 4 ||
    !Number.isFinite(frameHopSec) ||
    frameHopSec <= 0 ||
    !Number.isFinite(input.durationSec) ||
    input.durationSec <= 0
  ) {
    return [];
  }

  const onsetCurve = computeOnsetCurve(envelope);
  const totalEnergy = onsetCurve.reduce((sum, value) => sum + value, 0);
  if (totalEnergy <= 0) {
    return [];
  }

  const beatIntervalSec = 60 / tempoCandidate.bpm;
  const beatLagFrames = Math.max(1, Math.round(beatIntervalSec / frameHopSec));
  const phase = findBestPhase({
    beatLagFrames,
    onsetCurve,
    totalEnergy,
  });

  if (!phase || phase.score < (input.minScore ?? DEFAULT_MIN_SCORE)) {
    return [];
  }

  const firstBeatSec = roundTime((phase.frameIndex + 1) * frameHopSec);
  const beatsSec = buildBeatList({
    beatIntervalSec,
    durationSec: input.durationSec,
    firstBeatSec,
    maxBeats: input.maxBeats ?? DEFAULT_MAX_BEATS,
  });

  if (beatsSec.length === 0) {
    return [];
  }

  const confidence = roundScore(
    Math.min(0.68, 0.2 + phase.score * 0.42 + tempoCandidate.confidence * 0.18),
  );

  return [
    {
      id: "beat-grid-primary",
      tempoCandidateId: tempoCandidate.id,
      firstBeatSec,
      confidence,
      stability: roundScore(Math.min(0.66, 0.18 + phase.score * 0.48)),
      beatsSec,
    },
  ];
}

function computeOnsetCurve(envelope: number[]): number[] {
  const onsetCurve: number[] = [];
  let previous = sanitizeEnvelopeValue(envelope[0]);

  for (let index = 1; index < envelope.length; index += 1) {
    const current = sanitizeEnvelopeValue(envelope[index]);
    onsetCurve.push(Math.max(0, current - previous));
    previous = current;
  }

  return onsetCurve;
}

function findBestPhase(input: {
  beatLagFrames: number;
  onsetCurve: number[];
  totalEnergy: number;
}): { frameIndex: number; score: number } | null {
  let best: { frameIndex: number; score: number } | null = null;

  for (
    let phaseFrame = 0;
    phaseFrame < input.beatLagFrames && phaseFrame < input.onsetCurve.length;
    phaseFrame += 1
  ) {
    let alignedEnergy = 0;
    for (
      let frameIndex = phaseFrame;
      frameIndex < input.onsetCurve.length;
      frameIndex += input.beatLagFrames
    ) {
      alignedEnergy += input.onsetCurve[frameIndex] ?? 0;
    }

    const score = alignedEnergy / input.totalEnergy;
    if (!best || score > best.score) {
      best = { frameIndex: phaseFrame, score };
    }
  }

  return best;
}

function buildBeatList(input: {
  beatIntervalSec: number;
  durationSec: number;
  firstBeatSec: number;
  maxBeats: number;
}): number[] {
  const beatsSec: number[] = [];

  for (let beatIndex = 0; beatIndex < input.maxBeats; beatIndex += 1) {
    const beatSec = input.firstBeatSec + beatIndex * input.beatIntervalSec;
    if (beatSec > input.durationSec) {
      break;
    }

    beatsSec.push(roundTime(beatSec));
  }

  return beatsSec;
}

function sanitizeEnvelopeValue(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function roundTime(value: number): number {
  return Number(value.toFixed(6));
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
