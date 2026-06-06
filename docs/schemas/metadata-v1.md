# Metadata Schema v1

Metadata v1 separates generated analysis, AI review, manual overrides, and effective playback metadata.

The TypeScript source of truth is:

```text
packages/metadata/src/types.ts
```

Runtime validation schemas are:

```text
packages/metadata/src/schemas.ts
```

The effective resolution implementation is:

```text
packages/metadata/src/resolve.ts
```

## Layers

- `analysis`: deterministic or MIR-oriented observations, candidates, risk signals, and analysis defaults.
- `aiReview`: schema-bound candidate selections and auto-mix risk judgment from structured analysis data.
- `manualOverrides`: user corrections that must win over machine and AI selections.
- `effective`: resolved metadata consumed by playback.

Resolution precedence:

```text
manualOverrides > aiReview > analysis.defaults
```

If the resolved auto-mix decision is `rejected`, the effective metadata keeps the selected timing context but clears `mixInSec` and `mixOutSec`. Future playback code can treat an empty transition list plus rejected status as a safe no-mix state.

## Candidate Scope

Schema v1 can represent:

- source file identity and cached content hash
- low-level feature summaries
- tempo candidates, including half/double alternatives
- beat grid candidates
- 4/4 downbeat phase candidates
- structure candidates
- mix-in, mix-out, and avoid transition candidates
- risk signals and auto-mix rejection

The first low-level feature summary is compact and bounded. `featureSummary` may include:

- `frameHopSec`: spacing between summary frames
- `peakEnvelope`: per-frame maximum absolute sample value
- `rmsEnvelope`: per-frame RMS energy
- `silenceRangesSec`: coarse ranges inferred from low RMS values

Feature arrays are derived at import time from decoded mono PCM and are not raw audio. They are intended for future visual reports and candidate generation, not as beat or downbeat detections.

The first tempo candidates are heuristic estimates derived from the low-level feature summary. They are stored as multiple hypotheses, including half/double alternatives when available.

The first beat grid candidates are heuristic phase alignments from the selected tempo candidate and feature summary. They are intended for visual inspection and future correction, not as final playback-safe timing.

The first downbeat candidates are four explicit 4/4 phase hypotheses generated from the beat grid. They are not confirmed musical downbeats; AI review or human correction must choose the usable bar phase later. Phrase detection, transition scoring, and playback analysis are still intentionally not implemented.

The first structure and transition candidates are conservative bar-aligned hints generated from the selected downbeat grid. They can mark possible first usable downbeats, intro ends, section changes, outro starts, mix-in points, and mix-out points for inspection. They are not full song-section recognition and are not treated as DJ-safe transitions without later review.

## AI Review Input

The analysis CLI can generate a compact `analysis-for-ai` JSON file from a full `TrackAnalysisMetadata` document. This file is prompt input for future AI review, not a separate persisted metadata layer.

It includes source summary fields, risk signals, candidate IDs, defaults, structure candidates, transition candidates, and sampled beat/downbeat timings. It intentionally excludes raw audio, full feature envelopes, full beat arrays, and full downbeat arrays.

An AI reviewer should choose existing candidate IDs and classify auto-mix safety as `approved`, `risky`, or `rejected`. It should not invent unsupported candidate IDs. A later step may turn that review into the schema-bound `aiReview` layer.

## AI Review Files

The analysis CLI can apply a supplied `AiReview` JSON file to analysis metadata. The file contains only the `aiReview` object, not a full metadata document.

Minimal shape:

```json
{
  "selectedTempoCandidateId": "tempo-primary",
  "selectedBeatGridCandidateId": "beat-grid-primary",
  "selectedDownbeatCandidateId": "downbeat-phase-0",
  "selectedMixInTransitionId": "transition-mix-in-first-downbeat",
  "selectedMixOutTransitionId": "transition-mix-out-outro-start",
  "autoMix": {
    "status": "risky",
    "reasons": ["Candidate choices need manual listening confirmation."]
  },
  "notes": ["Review selected existing candidate IDs."]
}
```

When applied, every selected candidate ID is validated against the generated `analysis` candidates. The output keeps generated `analysis` unchanged, stores the supplied `aiReview`, preserves `manualOverrides`, and writes resolved `effective` metadata.

## Manual Override Files

The analysis CLI can resolve effective metadata from an analysis file plus an optional manual override file. The override file contains only the `manualOverrides` object, not a full metadata document.

Example:

```json
{
  "bpm": 124,
  "firstBeatSec": 0.48,
  "firstDownbeatSec": 0.48,
  "mixInSec": [0.48],
  "mixOutSec": [248.12],
  "autoMixDisabled": false,
  "notes": ["Manual correction after inspecting report."]
}
```

Effective metadata resolution applies:

```text
manualOverrides > aiReview > analysis.defaults
```

The resolved output keeps generated `analysis` unchanged and writes the resolved values to `effective`.

## Fixtures

Sample metadata fixtures are synthetic and illustrative:

```text
fixtures/metadata/simple-124bpm.analysis.json
fixtures/metadata/simple-124bpm.effective.json
```

Do not commit private library metadata or copyrighted audio fixtures.
