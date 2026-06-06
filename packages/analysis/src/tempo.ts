import type { FeatureSummary, TempoCandidate } from "@luumix/metadata";

export interface TempoEstimationOptions {
  minBpm?: number;
  maxBpm?: number;
  minScore?: number;
}

const DEFAULT_MIN_BPM = 60;
const DEFAULT_MAX_BPM = 180;
const DEFAULT_MIN_SCORE = 0.18;
const DERIVED_MIN_BPM = 30;
const DERIVED_MAX_BPM = 260;

export function estimateTempoCandidates(
  featureSummary: FeatureSummary,
  options: TempoEstimationOptions = {},
): TempoCandidate[] {
  const envelope = featureSummary.rmsEnvelope ?? featureSummary.peakEnvelope ?? [];
  const onsetCurve = computeOnsetCurve(envelope);
  const frameHopSec = featureSummary.frameHopSec;

  if (onsetCurve.length < 4 || !Number.isFinite(frameHopSec) || frameHopSec <= 0) {
    return [];
  }

  const minBpm = options.minBpm ?? DEFAULT_MIN_BPM;
  const maxBpm = options.maxBpm ?? DEFAULT_MAX_BPM;
  const best = findBestTempo({
    frameHopSec,
    maxBpm,
    minBpm,
    onsetCurve,
  });

  if (!best || best.score < (options.minScore ?? DEFAULT_MIN_SCORE)) {
    return [];
  }

  const confidence = roundTempoValue(Math.min(0.72, 0.24 + best.score * 0.5));
  const primary: TempoCandidate = {
    id: "tempo-primary",
    bpm: roundTempoValue(best.bpm),
    confidence,
    source: "heuristic",
    notes: [
      "Estimated from RMS onset autocorrelation.",
      "Rough tempo hypothesis only; no beat grid has been generated.",
    ],
  };

  return [
    primary,
    ...createDerivedTempoCandidates(primary),
  ];
}

function computeOnsetCurve(envelope: number[]): number[] {
  const onsetCurve: number[] = [];
  let previous = envelope[0] ?? 0;

  for (let index = 1; index < envelope.length; index += 1) {
    const current = sanitizeEnvelopeValue(envelope[index]);
    onsetCurve.push(Math.max(0, current - previous));
    previous = current;
  }

  return normalize(onsetCurve);
}

function findBestTempo(input: {
  frameHopSec: number;
  maxBpm: number;
  minBpm: number;
  onsetCurve: number[];
}): { bpm: number; score: number } | null {
  const energy = input.onsetCurve.reduce((sum, value) => sum + value * value, 0);
  if (energy <= 0) {
    return null;
  }

  const minLag = Math.max(1, Math.round(60 / (input.maxBpm * input.frameHopSec)));
  const maxLag = Math.max(minLag, Math.round(60 / (input.minBpm * input.frameHopSec)));
  let best: { bpm: number; score: number } | null = null;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let index = lag; index < input.onsetCurve.length; index += 1) {
      correlation += input.onsetCurve[index] * input.onsetCurve[index - lag];
    }

    const score = correlation / energy;
    const bpm = 60 / (lag * input.frameHopSec);
    if (!best || score > best.score) {
      best = { bpm, score };
    }
  }

  return best;
}

function createDerivedTempoCandidates(primary: TempoCandidate): TempoCandidate[] {
  const candidates: TempoCandidate[] = [];
  const halfBpm = primary.bpm / 2;
  const doubleBpm = primary.bpm * 2;

  if (isUsefulDerivedTempo(halfBpm)) {
    candidates.push({
      id: "tempo-half",
      bpm: roundTempoValue(halfBpm),
      confidence: roundTempoValue(primary.confidence * 0.55),
      source: "derived-half",
      notes: [
        "Half-tempo alternative derived from tempo-primary.",
        "Included because half/double tempo ambiguity is common in rough tempo estimation.",
      ],
    });
  }

  if (isUsefulDerivedTempo(doubleBpm)) {
    candidates.push({
      id: "tempo-double",
      bpm: roundTempoValue(doubleBpm),
      confidence: roundTempoValue(primary.confidence * 0.55),
      source: "derived-double",
      notes: [
        "Double-tempo alternative derived from tempo-primary.",
        "Included because half/double tempo ambiguity is common in rough tempo estimation.",
      ],
    });
  }

  return candidates;
}

function isUsefulDerivedTempo(bpm: number): boolean {
  return bpm >= DERIVED_MIN_BPM && bpm <= DERIVED_MAX_BPM;
}

function normalize(values: number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) {
    return values.map(() => 0);
  }

  return values.map((value) => value / max);
}

function sanitizeEnvelopeValue(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function roundTempoValue(value: number): number {
  return Number(value.toFixed(6));
}
