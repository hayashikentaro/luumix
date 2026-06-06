# Next Implementation Steps

This document turns the main plan into concrete implementation tasks that can be handed to Codex or another coding agent.

The immediate goal is not playback. The immediate goal is an analysis-first proof that produces metadata the user can inspect and judge as correct or fixable.

## Current Target

Build a minimal analysis workbench:

```text
local audio file
  -> analyze command
  -> structured metadata JSON
  -> static visual/debug report
  -> human inspection
```

Success means the user can inspect the output and answer:

- Is the BPM plausible?
- Does the beat grid line up?
- Does the downbeat/bar phase look plausible?
- Are risky/uncertain tracks clearly flagged?
- Can wrong values be represented as manual overrides?

## Implementation Order

### Step 1: Project skeleton

Create the repository structure and baseline tooling.

Files/directories:

```text
package.json
.gitignore
packages/
  metadata/
    package.json
    src/
      index.ts
  analysis/
    package.json
    src/
      index.ts
      cli.ts
  playback/
    package.json
    src/
      index.ts
  app/
    package.json
fixtures/
  README.md
```

Recommended first stack:

- TypeScript
- Node CLI
- npm workspaces or pnpm workspaces, depending on existing preference at implementation time
- no UI framework yet
- no playback implementation yet

Acceptance:

- `npm install` works.
- TypeScript compiles.
- Placeholder packages can be imported.
- No private audio or generated metadata is committed.

### Step 2: Metadata package first

Implement `packages/metadata` before implementing analysis.

Core exports:

```text
TrackAnalysisMetadata
SourceFileMetadata
TempoCandidate
BeatGridCandidate
DownbeatCandidate
StructureCandidate
TransitionCandidate
RiskSignals
AiReview
ManualOverrides
EffectiveTrackMetadata
resolveEffectiveMetadata()
```

Rules:

- Include `schemaVersion`.
- Keep generated analysis separate from AI review and manual overrides.
- Manual overrides win over AI review.
- AI review wins over default analysis selection.
- Do not require playback code to know where the final value came from.

Acceptance:

- A hand-written sample metadata JSON can be validated by TypeScript/Zod or equivalent.
- `resolveEffectiveMetadata()` can resolve BPM, beat grid, downbeat, mix-in, and mix-out values.
- The schema can represent rejected/risky tracks.

### Step 3: Hand-written sample metadata

Before real audio analysis, create sample metadata fixtures.

Files:

```text
fixtures/metadata/simple-124bpm.analysis.json
fixtures/metadata/simple-124bpm.effective.json
```

These should not correspond to copyrighted real music. They can be synthetic or illustrative.

Acceptance:

- The sample clearly shows the intended metadata shape.
- The sample includes multiple tempo/downbeat candidates.
- The sample includes risk signals and manual override fields.
- The sample can be loaded by tests.

### Step 4: Analysis CLI shell

Create a CLI that writes placeholder-but-valid metadata.

Proposed command:

```bash
luumix analyze ./path/to/track.wav --out ./metadata/track.analysis.json
```

At this stage it may only collect:

- file path
- content hash
- file size
- placeholder duration if audio probing is not implemented yet
- empty or mocked candidates

Acceptance:

- CLI can read a file path.
- CLI writes valid `TrackAnalysisMetadata` JSON.
- CLI refuses missing files with a clear error.
- CLI does not write outside the requested output path.

### Step 5: Audio probing

Add real source inspection.

Collect:

- duration
- sample rate
- channel count
- codec/container if available
- content hash

Candidate tools:

- `ffprobe` via child process
- a Node audio metadata library
- later Rust/Python helper if needed

Acceptance:

- CLI metadata includes real duration/sample rate/channel data.
- Missing `ffprobe` or unsupported files produce actionable errors.
- Existing metadata becomes stale when content hash changes.

### Step 6: Low-level feature summary

Generate inspectable analysis features.

Initial features:

- coarse waveform/energy envelope
- RMS or loudness summary
- silence start/end estimates
- onset strength proxy if feasible

Do not over-optimize. This is for visual inspection and downstream candidate generation.

Acceptance:

- Metadata includes a compact feature summary.
- Feature arrays are bounded and do not create huge JSON files.
- The output can support a later static report.

### Step 7: Tempo candidates

Add rough BPM candidate generation.

Start with whichever approach is easiest to integrate:

- existing MIR library wrapper
- ffmpeg-derived onset pipeline
- Python helper script if Node-only is too limiting
- external analyzer invoked from CLI

Rules:

- Store multiple candidates.
- Include half/double tempo candidates.
- Include confidence/source/risk notes.
- Do not pretend one candidate is definitely correct.

Acceptance:

- Metadata includes at least one BPM candidate for simple beat-driven tracks.
- Half/double alternatives are represented.
- Failed BPM detection marks the track as risky instead of silently succeeding.

### Step 8: Beat grid and downbeat candidates

Generate rhythm candidates good enough for visual inspection.

Add:

- beat grid candidate positions
- first beat/phase
- beat confidence/stability
- four 4/4 downbeat phase candidates

Acceptance:

- A human can inspect the beat tick locations.
- Downbeat candidates are explicit alternatives.
- The metadata can distinguish BPM error, beat phase error, and downbeat phase error.

### Step 9: Static analysis report

Create a static report generator.

Proposed command:

```bash
luumix report ./metadata/track.analysis.json --out ./reports/track.html
```

The report should show:

- file summary
- BPM candidate list
- waveform or energy envelope
- beat ticks
- downbeat/bar ticks
- risk signals
- JSON metadata link or embedded details

Acceptance:

- The user can visually judge whether the metadata is plausible.
- The report works without a running server.
- The report is generated from metadata, not from hidden runtime state.

### Step 10: Manual override resolution

Support manual override files or fields.

Possible shape:

```text
track.analysis.json
track.overrides.json
track.effective.json
```

or a single metadata file with separate sections.

Initial recommendation:

- Keep generated `analysis` immutable by default.
- Put user edits in `manualOverrides` or separate override JSON.
- Generate `effective` metadata as a derived artifact.

Acceptance:

- User can override BPM and first downbeat without editing generated candidates.
- Effective metadata reflects overrides.
- Re-running analysis does not destroy user overrides unless explicitly requested.

## First Codex Task

The first implementation task should be small:

```text
Create TypeScript workspace skeleton, metadata package, schema/types, sample metadata fixture, and tests for effective metadata resolution. Do not implement real audio analysis yet.
```

Allowed files for that task:

```text
package.json
.gitignore
tsconfig.json
packages/metadata/**
fixtures/README.md
fixtures/metadata/**
docs/schemas/**
```

Acceptance for first task:

- `npm install` works.
- `npm run build` or equivalent works.
- Metadata types/schema exist.
- Sample metadata fixture exists.
- A resolver test proves `manualOverrides > aiReview > analysis default`.

## Near-Term Non-Goals

Do not implement these until the analysis workbench is useful:

- deck A/B playback
- time-stretching
- crossfading
- UI player controls
- library management UI
- streaming services
- recommendations
- cloud sync

## Risk Notes

The riskiest part is not file playback. The riskiest part is whether analysis metadata can be made trustworthy enough.

Therefore, every early task should improve one of these:

- metadata correctness
- metadata inspectability
- candidate uncertainty representation
- manual correction round trip
- generated report quality

If a task does not improve one of these, it is probably too early.
