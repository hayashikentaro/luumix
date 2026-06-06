export const METADATA_SCHEMA_VERSION = 1;

export type CandidateSource =
  | "manual"
  | "analyzer"
  | "derived-half"
  | "derived-double"
  | "heuristic"
  | "ai-review";

export type AutoMixStatus = "approved" | "risky" | "rejected";

export interface SourceFileMetadata {
  libraryId?: string;
  path: string;
  contentHash: string;
  fileSizeBytes?: number;
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  container?: string;
}

export interface FeatureSummary {
  frameHopSec: number;
  peakEnvelope?: number[];
  rmsEnvelope?: number[];
  onsetStrength?: number[];
  silenceRangesSec?: TimeRange[];
}

export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface TempoCandidate {
  id: string;
  bpm: number;
  confidence: number;
  source: CandidateSource;
  notes?: string[];
}

export interface BeatGridCandidate {
  id: string;
  tempoCandidateId: string;
  firstBeatSec: number;
  confidence: number;
  stability: number;
  beatsSec: number[];
}

export interface DownbeatCandidate {
  id: string;
  beatGridId: string;
  phaseBeatIndex: number;
  confidence: number;
  downbeatsSec: number[];
  supportingSignals?: string[];
}

export type StructureCandidateKind =
  | "firstUsableBeat"
  | "firstUsableDownbeat"
  | "introEnd"
  | "sectionChange"
  | "energyRise"
  | "energyDrop"
  | "outroStart";

export interface StructureCandidate {
  id: string;
  kind: StructureCandidateKind;
  timeSec: number;
  barNumber?: number;
  confidence: number;
  reasons?: string[];
}

export type TransitionCandidateKind = "mixIn" | "mixOut" | "avoid";

export interface TransitionCandidate {
  id: string;
  kind: TransitionCandidateKind;
  timeSec: number;
  barNumber?: number;
  suggestedLengthBars?: number;
  score: number;
  reasons?: string[];
  riskNotes?: string[];
}

export interface TransitionCandidates {
  mixIn: TransitionCandidate[];
  mixOut: TransitionCandidate[];
  avoid: TransitionCandidate[];
}

export interface RiskSignals {
  tempoUnstable: boolean;
  downbeatAmbiguous: boolean;
  doubleTempoAmbiguous: boolean;
  lowConfidence?: boolean;
  unsupportedMeter?: boolean;
  hasLongSilence?: boolean;
  notes?: string[];
}

export interface AutoMixDecision {
  status: AutoMixStatus;
  reasons: string[];
}

export interface AnalysisDefaults {
  tempoCandidateId?: string;
  beatGridCandidateId?: string;
  downbeatCandidateId?: string;
  mixInTransitionId?: string;
  mixOutTransitionId?: string;
  autoMix?: AutoMixDecision;
}

export interface AnalysisMetadata {
  featureSummary?: FeatureSummary;
  tempoCandidates: TempoCandidate[];
  beatGridCandidates: BeatGridCandidate[];
  downbeatCandidates: DownbeatCandidate[];
  structureCandidates: StructureCandidate[];
  transitionCandidates: TransitionCandidates;
  riskSignals: RiskSignals;
  defaults: AnalysisDefaults;
}

export interface AiReview {
  selectedTempoCandidateId?: string;
  selectedBeatGridCandidateId?: string;
  selectedDownbeatCandidateId?: string;
  selectedMixInTransitionId?: string;
  selectedMixOutTransitionId?: string;
  autoMix: AutoMixDecision;
  notes?: string[];
}

export interface ManualBeatGridOverride {
  firstBeatSec: number;
  bpm: number;
  notes?: string[];
}

export interface ManualOverrides {
  bpm?: number | null;
  beatGrid?: ManualBeatGridOverride | null;
  firstBeatSec?: number | null;
  firstDownbeatSec?: number | null;
  mixInSec?: number[] | null;
  mixOutSec?: number[] | null;
  autoMixDisabled?: boolean;
  notes?: string[];
}

export interface EffectiveBeatGrid {
  source: "manual" | "aiReview" | "analysis";
  candidateId?: string;
  firstBeatSec: number;
  bpm: number;
  beatsSec: number[];
}

export interface EffectiveDownbeat {
  source: "manual" | "aiReview" | "analysis";
  candidateId?: string;
  firstDownbeatSec: number;
  downbeatsSec: number[];
}

export interface EffectiveTrackMetadata {
  schemaVersion: typeof METADATA_SCHEMA_VERSION;
  sourceFile: SourceFileMetadata;
  bpm: number;
  bpmSource: "manual" | "aiReview" | "analysis";
  beatGrid: EffectiveBeatGrid;
  downbeat: EffectiveDownbeat;
  mixInSec: number[];
  mixOutSec: number[];
  autoMix: AutoMixDecision;
}

export interface TrackAnalysisMetadata {
  schemaVersion: typeof METADATA_SCHEMA_VERSION;
  sourceFile: SourceFileMetadata;
  analysis: AnalysisMetadata;
  aiReview: AiReview | null;
  manualOverrides: ManualOverrides;
  effective: EffectiveTrackMetadata | null;
}
