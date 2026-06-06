import { z } from "zod";
import { METADATA_SCHEMA_VERSION } from "./types.js";

const candidateSourceSchema = z.enum([
  "manual",
  "analyzer",
  "derived-half",
  "derived-double",
  "heuristic",
  "ai-review",
]);

const sourceSchema = z.enum(["manual", "aiReview", "analysis"]);
const autoMixStatusSchema = z.enum(["approved", "risky", "rejected"]);

const stringListSchema = z.array(z.string());

export const TimeRangeSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});

export const SourceFileMetadataSchema = z.object({
  libraryId: z.string().optional(),
  path: z.string().min(1),
  contentHash: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  durationSec: z.number().positive(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  codec: z.string().optional(),
  container: z.string().optional(),
});

export const FeatureSummarySchema = z.object({
  frameHopSec: z.number().positive(),
  peakEnvelope: z.array(z.number()).optional(),
  rmsEnvelope: z.array(z.number()).optional(),
  onsetStrength: z.array(z.number()).optional(),
  silenceRangesSec: z.array(TimeRangeSchema).optional(),
});

export const TempoCandidateSchema = z.object({
  id: z.string().min(1),
  bpm: z.number().positive(),
  confidence: z.number().min(0).max(1),
  source: candidateSourceSchema,
  notes: stringListSchema.optional(),
});

export const BeatGridCandidateSchema = z.object({
  id: z.string().min(1),
  tempoCandidateId: z.string().min(1),
  firstBeatSec: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  beatsSec: z.array(z.number().nonnegative()),
});

export const DownbeatCandidateSchema = z.object({
  id: z.string().min(1),
  beatGridId: z.string().min(1),
  phaseBeatIndex: z.number().int().min(0).max(3),
  confidence: z.number().min(0).max(1),
  downbeatsSec: z.array(z.number().nonnegative()),
  supportingSignals: stringListSchema.optional(),
});

export const StructureCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "firstUsableBeat",
    "firstUsableDownbeat",
    "introEnd",
    "sectionChange",
    "energyRise",
    "energyDrop",
    "outroStart",
  ]),
  timeSec: z.number().nonnegative(),
  barNumber: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
  reasons: stringListSchema.optional(),
});

export const TransitionCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["mixIn", "mixOut", "avoid"]),
  timeSec: z.number().nonnegative(),
  barNumber: z.number().int().nonnegative().optional(),
  suggestedLengthBars: z.number().int().positive().optional(),
  score: z.number().min(0).max(1),
  reasons: stringListSchema.optional(),
  riskNotes: stringListSchema.optional(),
});

export const TransitionCandidatesSchema = z.object({
  mixIn: z.array(TransitionCandidateSchema),
  mixOut: z.array(TransitionCandidateSchema),
  avoid: z.array(TransitionCandidateSchema),
});

export const RiskSignalsSchema = z.object({
  tempoUnstable: z.boolean(),
  downbeatAmbiguous: z.boolean(),
  doubleTempoAmbiguous: z.boolean(),
  lowConfidence: z.boolean().optional(),
  unsupportedMeter: z.boolean().optional(),
  hasLongSilence: z.boolean().optional(),
  notes: stringListSchema.optional(),
});

export const AutoMixDecisionSchema = z.object({
  status: autoMixStatusSchema,
  reasons: stringListSchema,
});

export const AnalysisDefaultsSchema = z.object({
  tempoCandidateId: z.string().optional(),
  beatGridCandidateId: z.string().optional(),
  downbeatCandidateId: z.string().optional(),
  mixInTransitionId: z.string().optional(),
  mixOutTransitionId: z.string().optional(),
  autoMix: AutoMixDecisionSchema.optional(),
});

export const AnalysisMetadataSchema = z.object({
  featureSummary: FeatureSummarySchema.optional(),
  tempoCandidates: z.array(TempoCandidateSchema).min(1),
  beatGridCandidates: z.array(BeatGridCandidateSchema).min(1),
  downbeatCandidates: z.array(DownbeatCandidateSchema).min(1),
  structureCandidates: z.array(StructureCandidateSchema),
  transitionCandidates: TransitionCandidatesSchema,
  riskSignals: RiskSignalsSchema,
  defaults: AnalysisDefaultsSchema,
});

export const AiReviewSchema = z.object({
  selectedTempoCandidateId: z.string().optional(),
  selectedBeatGridCandidateId: z.string().optional(),
  selectedDownbeatCandidateId: z.string().optional(),
  selectedMixInTransitionId: z.string().optional(),
  selectedMixOutTransitionId: z.string().optional(),
  autoMix: AutoMixDecisionSchema,
  notes: stringListSchema.optional(),
});

export const ManualBeatGridOverrideSchema = z.object({
  firstBeatSec: z.number().nonnegative(),
  bpm: z.number().positive(),
  notes: stringListSchema.optional(),
});

export const ManualOverridesSchema = z.object({
  bpm: z.number().positive().nullable().optional(),
  beatGrid: ManualBeatGridOverrideSchema.nullable().optional(),
  firstBeatSec: z.number().nonnegative().nullable().optional(),
  firstDownbeatSec: z.number().nonnegative().nullable().optional(),
  mixInSec: z.array(z.number().nonnegative()).nullable().optional(),
  mixOutSec: z.array(z.number().nonnegative()).nullable().optional(),
  autoMixDisabled: z.boolean().optional(),
  notes: stringListSchema.optional(),
});

export const EffectiveBeatGridSchema = z.object({
  source: sourceSchema,
  candidateId: z.string().optional(),
  firstBeatSec: z.number().nonnegative(),
  bpm: z.number().positive(),
  beatsSec: z.array(z.number().nonnegative()),
});

export const EffectiveDownbeatSchema = z.object({
  source: sourceSchema,
  candidateId: z.string().optional(),
  firstDownbeatSec: z.number().nonnegative(),
  downbeatsSec: z.array(z.number().nonnegative()),
});

export const EffectiveTrackMetadataSchema = z.object({
  schemaVersion: z.literal(METADATA_SCHEMA_VERSION),
  sourceFile: SourceFileMetadataSchema,
  bpm: z.number().positive(),
  bpmSource: sourceSchema,
  beatGrid: EffectiveBeatGridSchema,
  downbeat: EffectiveDownbeatSchema,
  mixInSec: z.array(z.number().nonnegative()),
  mixOutSec: z.array(z.number().nonnegative()),
  autoMix: AutoMixDecisionSchema,
});

export const TrackAnalysisMetadataSchema = z.object({
  schemaVersion: z.literal(METADATA_SCHEMA_VERSION),
  sourceFile: SourceFileMetadataSchema,
  analysis: AnalysisMetadataSchema,
  aiReview: AiReviewSchema.nullable(),
  manualOverrides: ManualOverridesSchema,
  effective: EffectiveTrackMetadataSchema.nullable(),
});

export function parseTrackAnalysisMetadata(input: unknown) {
  return TrackAnalysisMetadataSchema.parse(input);
}

export function parseEffectiveTrackMetadata(input: unknown) {
  return EffectiveTrackMetadataSchema.parse(input);
}
