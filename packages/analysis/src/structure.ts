import type {
  BeatGridCandidate,
  DownbeatCandidate,
  FeatureSummary,
  StructureCandidate,
  TransitionCandidate,
  TransitionCandidates,
} from "@luumix/metadata";

export interface StructureEstimationInput {
  featureSummary: FeatureSummary;
  beatGridCandidates: BeatGridCandidate[];
  downbeatCandidates: DownbeatCandidate[];
  durationSec: number;
}

export interface TransitionEstimationInput extends StructureEstimationInput {
  structureCandidates: StructureCandidate[];
}

interface BarBoundary {
  barNumber: number;
  timeSec: number;
}

export function estimateStructureCandidates(
  input: StructureEstimationInput,
): StructureCandidate[] {
  const downbeat = getDefaultDownbeatCandidate(input.downbeatCandidates);
  if (!downbeat || downbeat.downbeatsSec.length === 0 || input.durationSec <= 0) {
    return [];
  }

  const bars = getBars(downbeat, input.durationSec);
  if (bars.length === 0) {
    return [];
  }

  const candidates: StructureCandidate[] = [
    {
      id: "structure-first-usable-downbeat",
      kind: "firstUsableDownbeat",
      timeSec: bars[0].timeSec,
      barNumber: bars[0].barNumber,
      confidence: 0.46,
      reasons: [
        "First downbeat from the selected 4/4 phase candidate.",
        "Heuristic timing candidate for inspection, not a confirmed musical section.",
      ],
    },
  ];

  const introEnd = findFirstBarAtOrAfter(bars, [33, 17, 9]);
  if (introEnd) {
    candidates.push({
      id: "structure-intro-end",
      kind: "introEnd",
      timeSec: introEnd.timeSec,
      barNumber: introEnd.barNumber,
      confidence: 0.42,
      reasons: [
        "Early 8/16/32-bar phrase boundary from the selected downbeat grid.",
        "Generated as a possible intro end for visual inspection.",
      ],
    });
  }

  const sectionChange = findFirstBarAtOrAfter(bars, [17, 33]);
  if (sectionChange && sectionChange.barNumber !== introEnd?.barNumber) {
    candidates.push({
      id: "structure-section-change",
      kind: "sectionChange",
      timeSec: sectionChange.timeSec,
      barNumber: sectionChange.barNumber,
      confidence: 0.38,
      reasons: [
        "Phrase boundary from the selected downbeat grid.",
        "No verse/chorus/drop detection has been performed.",
      ],
    });
  }

  const outroStart = findLatePhraseBoundary(bars, input.durationSec);
  if (outroStart && outroStart.barNumber > (introEnd?.barNumber ?? 1)) {
    candidates.push({
      id: "structure-outro-start",
      kind: "outroStart",
      timeSec: outroStart.timeSec,
      barNumber: outroStart.barNumber,
      confidence: 0.4,
      reasons: [
        "Late phrase boundary before the end of the track.",
        "Generated as a possible outro start for visual inspection.",
      ],
    });
  }

  return candidates;
}

export function estimateTransitionCandidates(
  input: TransitionEstimationInput,
): TransitionCandidates {
  const downbeat = getDefaultDownbeatCandidate(input.downbeatCandidates);
  if (!downbeat || downbeat.downbeatsSec.length === 0 || input.durationSec <= 0) {
    return { mixIn: [], mixOut: [], avoid: [] };
  }

  const mixIn: TransitionCandidate[] = [];
  const mixOut: TransitionCandidate[] = [];
  const avoid = estimateAvoidTransitions(input.featureSummary);
  const firstUsableDownbeat = findStructure(
    input.structureCandidates,
    "firstUsableDownbeat",
  );
  const introEnd = findStructure(input.structureCandidates, "introEnd");
  const sectionChange = findStructure(input.structureCandidates, "sectionChange");
  const outroStart = findStructure(input.structureCandidates, "outroStart");

  if (firstUsableDownbeat) {
    mixIn.push(createTransitionCandidate({
      id: "transition-mix-in-first-downbeat",
      kind: "mixIn",
      structure: firstUsableDownbeat,
      score: 0.36,
      reasons: [
        "First usable downbeat candidate from the selected 4/4 phase.",
        "Useful for inspection, but not confirmed as a DJ-safe entry point.",
      ],
      riskNotes: [
        "May include intro silence or non-percussive material.",
      ],
      suggestedLengthBars: 8,
    }));
  }

  for (const structure of [introEnd, sectionChange]) {
    if (!structure) {
      continue;
    }

    mixIn.push(createTransitionCandidate({
      id: `transition-mix-in-${structure.kind}`,
      kind: "mixIn",
      structure,
      score: 0.44,
      reasons: [
        "Early phrase-aligned structure candidate.",
        "Generated without phrase or section recognition.",
      ],
      suggestedLengthBars: 8,
    }));
  }

  if (outroStart) {
    mixOut.push(createTransitionCandidate({
      id: "transition-mix-out-outro-start",
      kind: "mixOut",
      structure: outroStart,
      score: 0.44,
      reasons: [
        "Late phrase-aligned structure candidate.",
        "Generated as a possible exit region for inspection.",
      ],
      suggestedLengthBars: 16,
    }));
  }

  const lateBoundary = findLatePhraseBoundary(
    getBars(downbeat, input.durationSec),
    input.durationSec,
  );
  if (lateBoundary && lateBoundary.barNumber !== outroStart?.barNumber) {
    mixOut.push({
      id: "transition-mix-out-late-phrase",
      kind: "mixOut",
      timeSec: lateBoundary.timeSec,
      barNumber: lateBoundary.barNumber,
      suggestedLengthBars: 16,
      score: 0.38,
      reasons: [
        "Late 16-bar phrase boundary before track end.",
        "Generated from the downbeat grid without transition scoring.",
      ],
      riskNotes: [
        "Energy and arrangement have not been analyzed for DJ-safe exit.",
      ],
    });
  }

  return { mixIn, mixOut, avoid };
}

function createTransitionCandidate(input: {
  id: string;
  kind: "mixIn" | "mixOut";
  structure: StructureCandidate;
  score: number;
  reasons: string[];
  riskNotes?: string[];
  suggestedLengthBars: number;
}): TransitionCandidate {
  return {
    id: input.id,
    kind: input.kind,
    timeSec: input.structure.timeSec,
    barNumber: input.structure.barNumber,
    suggestedLengthBars: input.suggestedLengthBars,
    score: input.score,
    reasons: input.reasons,
    riskNotes: input.riskNotes,
  };
}

function estimateAvoidTransitions(featureSummary: FeatureSummary): TransitionCandidate[] {
  const firstSilence = featureSummary.silenceRangesSec?.find(
    (range) => range.endSec - range.startSec >= 2,
  );

  if (!firstSilence) {
    return [];
  }

  return [
    {
      id: "transition-avoid-long-silence",
      kind: "avoid",
      timeSec: firstSilence.startSec,
      score: 0.62,
      reasons: [
        "Long low-energy region detected in the feature summary.",
      ],
      riskNotes: [
        "Avoid using this region as an automatic transition point until inspected.",
      ],
    },
  ];
}

function getDefaultDownbeatCandidate(
  candidates: DownbeatCandidate[],
): DownbeatCandidate | undefined {
  return candidates.reduce<DownbeatCandidate | undefined>((best, candidate) => {
    if (!best || candidate.confidence > best.confidence) {
      return candidate;
    }

    return best;
  }, undefined);
}

function getBars(downbeat: DownbeatCandidate, durationSec: number): BarBoundary[] {
  return downbeat.downbeatsSec
    .filter((timeSec) => timeSec >= 0 && timeSec <= durationSec)
    .map((timeSec, index) => ({
      barNumber: index + 1,
      timeSec,
    }));
}

function findFirstBarAtOrAfter(
  bars: BarBoundary[],
  barNumbers: number[],
): BarBoundary | undefined {
  for (const barNumber of barNumbers) {
    const found = bars.find((bar) => bar.barNumber >= barNumber);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findLatePhraseBoundary(
  bars: BarBoundary[],
  durationSec: number,
): BarBoundary | undefined {
  const minimumTimeSec = Math.max(0, durationSec - 64);
  const candidates = bars.filter(
    (bar) => bar.timeSec >= minimumTimeSec && (bar.barNumber - 1) % 16 === 0,
  );

  return candidates[0] ?? bars.find((bar) => bar.timeSec >= minimumTimeSec);
}

function findStructure(
  candidates: StructureCandidate[],
  kind: StructureCandidate["kind"],
): StructureCandidate | undefined {
  return candidates.find((candidate) => candidate.kind === kind);
}
