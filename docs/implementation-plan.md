# Luumix Implementation Plan

This is the main implementation plan for Luumix.

Luumix should be built analysis-first. The playback engine should be developed after the analysis metadata is good enough to inspect, trust, correct, and consume.

## Product Split

Luumix has two major product halves:

1. Track analysis: read a music file and produce metadata that describes tempo, beat grid, downbeats, phrase/transition candidates, confidence, and risk.
2. Tempo-locked playback: use the metadata to prepare the next track in parallel, time-stretch it to a master tempo, and transition at musically sensible boundaries.

The playback half depends on the analysis half. If the analysis metadata cannot be made good enough for a human to inspect and trust, the later playback engine will not have a stable foundation.

Therefore the first implementation goal is not a full player. The first goal is an analysis workbench that can generate metadata a human can visually inspect and judge as correct enough.

## Primary Success Condition

The first success condition is:

> Given a local music file, Luumix can produce track metadata that the user can inspect visually and judge as correct or fixable.

This means the first useful product artifact is not audio playback. It is a reliable analysis output plus a way to inspect it.

## Analysis Phase Success Criteria

The analysis phase is successful when a user can inspect a generated metadata file and supporting visual/debug output and answer these questions:

- Is the estimated BPM correct, or at least clearly one of the listed candidates?
- Does the beat grid line up with the visible/expected beat positions?
- Does the selected downbeat/bar phase look plausible?
- Are obvious intro/outro or transition-safe regions identified?
- Are uncertain tracks flagged instead of silently accepted?
- Can manual corrections be represented without overwriting generated analysis?

The analysis phase is not required to perfectly understand every track. Rejection and uncertainty are acceptable outputs.

## First-Phase Non-Goals

- No full music player.
- No real-time transition engine.
- No streaming integration.
- No automatic mixing across a whole library.
- No perfect chorus/drop/verse labeling.
- No requirement to support unstable-tempo live recordings.
- No requirement to support every genre.

## Target Track Scope

Start narrow:

- local audio files
- stable tempo
- 4/4 meter assumption
- clear beat
- reasonably modern production
- no extreme tempo changes

Difficult tracks should be marked as risky or rejected for automatic mixing.

## Phase 0: Repository And Tooling Skeleton

Goal: create a minimal structure that lets agents work without guessing where things belong.

Planned files/directories:

```text
package.json
README.md
AGENTS.md
docs/
  implementation-plan.md
  analysis-pipeline.md
  architecture.md
  product-principles.md
  playback-engine.md
  issues/
  guides/
  schemas/
packages/
  analysis/
  metadata/
  playback/
  app/
fixtures/
  README.md
```

Notes:

- `packages/playback` may remain empty or placeholder-only until analysis proves useful.
- Do not commit copyrighted music fixtures.
- Use synthetic audio fixtures or documented instructions for local private test files.

Acceptance:

- Project has a clear package layout.
- There is a command location for future analysis CLI work.
- Private runtime/library data is ignored.

## Phase 1: Metadata Schema First

Goal: define the shape of analysis output before building analyzers.

Create schema docs and TypeScript types for:

- source file identity
- low-level feature summary
- tempo candidates
- beat grid candidates
- downbeat candidates
- structure candidates
- transition candidates
- risk signals
- AI review
- manual overrides
- effective metadata

The key design rule:

```text
manualOverrides > aiReview > analysis default
```

Acceptance:

- A sample metadata JSON can be read and understood without the app.
- The schema can represent multiple BPM/downbeat hypotheses.
- The schema can represent uncertainty and rejection.
- Manual corrections do not mutate or erase generated analysis.

## Phase 2: Import-Time Analysis CLI

Goal: run analysis on one local file and write metadata.

Proposed command shape:

```bash
luumix analyze ./path/to/track.flac --out ./metadata/track.analysis.json
```

Initial extractor responsibilities:

- decode/inspect file metadata
- duration
- sample rate/channels
- content hash
- loudness summary
- silence boundaries
- onset strength summary
- rough BPM candidates

Acceptance:

- Running the command creates a deterministic sidecar metadata file.
- Re-running on the same unchanged file is stable.
- Content hash makes stale analysis detectable.
- The output is useful even before playback exists.

## Phase 3: Rhythm Candidate Generation

Goal: generate enough rhythm data for visual inspection.

Add:

- BPM candidates
- half/double tempo candidates
- beat grid candidates
- beat confidence/stability scores
- 4/4 downbeat phase candidates

Important rule:

Do not collapse uncertainty too early. Store candidates first; select effective values later.

Acceptance:

- Metadata includes multiple candidate hypotheses.
- Candidate confidence and risk flags are explicit.
- A human can see whether errors are BPM errors, beat phase errors, or downbeat phase errors.

## Phase 4: Analysis Workbench / Visual Debug Output

Goal: make success inspectable by the user.

This can be implemented as either:

- generated static HTML report
- local web view
- CLI output plus generated chart images
- JSON plus lightweight waveform/beat overlay view

Minimum visualizations:

- waveform or energy envelope
- beat grid ticks
- downbeat/bar ticks
- section/transition candidates
- BPM candidate list
- risk signals

Acceptance:

- The user can visually judge whether metadata is plausible.
- The user can compare candidates.
- The report makes uncertainty visible.

This phase is more important than playback for proving feasibility.

## Phase 5: Manual Override Round Trip

Goal: allow a wrong analysis to be corrected once and persisted.

Support override fields for:

- BPM
- first beat
- first downbeat
- bar offset
- mix-in points
- mix-out points
- disabled/rejected status

Acceptance:

- Effective metadata can be recomputed from analysis + AI review + manual overrides.
- Manual overrides survive analyzer re-runs unless the user intentionally resets them.
- The user can fix a track without editing generated analysis fields.

## Phase 6: AI Review Of Structured Candidates

Goal: use AI for candidate selection and risk judgment, not raw audio analysis.

Input:

- compact structured analysis summary
- rhythm candidates
- downbeat candidates
- transition candidates
- risk signals
- product constraints

Output:

- selected BPM candidate
- selected beat grid
- selected downbeat candidate
- preferred mix-in/mix-out candidates
- auto-mix safety classification
- notes

Acceptance:

- AI output is schema-bound.
- AI can reject tracks.
- AI does not invent unsupported beat grids.
- AI review can be replaced or ignored without breaking playback.

## Phase 7: Playback Consumer Prototype

Only after the metadata is inspectable and plausible, build the first playback consumer.

Goal:

- read effective metadata
- play a single track at master tempo
- show master grid alignment
- avoid doing analysis during playback

Acceptance:

- Playback code consumes effective metadata only.
- Playback does not call AI.
- Playback does not perform heavy analysis in the hot audio path.

## Phase 8: Parallel Deck Transition Prototype

Goal:

- deck A plays current track
- deck B is prepared from effective metadata
- B is time-stretched to master tempo within safe limits
- B starts on a selected bar boundary
- A/B crossfade over a fixed number of bars

Acceptance:

- Transition timing is driven by metadata and master grid.
- Bad or missing metadata prevents auto-mix instead of causing a bad transition.
- Crossfade-only behavior is not treated as the core product.

## Open Questions

Open questions should be split into `docs/issues/` records when they become active decisions.

Current questions:

- Which runtime should own the analysis pipeline: Node, Python, Rust, or a hybrid?
- Which MIR libraries should be wrapped first?
- Should visual inspection be static HTML first or a small local app?
- How much audio feature data should be stored in sidecar JSON versus generated debug reports?
- Should AI review be optional from the beginning, or introduced only after deterministic candidates are useful?
- What is the minimum synthetic fixture set that can test BPM/downbeat behavior without copyrighted audio?

## Recommended Next Action

Create the schema and CLI skeleton before choosing the final MIR stack.

The most useful immediate artifact is a hand-written sample metadata file plus a schema/type definition. Once the desired output shape is stable, analyzer implementation can be judged by whether it fills that shape well.
