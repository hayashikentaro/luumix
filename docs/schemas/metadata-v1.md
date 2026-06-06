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

It intentionally does not implement BPM, beat grid, downbeat, phrase, or playback analysis yet.

## Fixtures

Sample metadata fixtures are synthetic and illustrative:

```text
fixtures/metadata/simple-124bpm.analysis.json
fixtures/metadata/simple-124bpm.effective.json
```

Do not commit private library metadata or copyrighted audio fixtures.
