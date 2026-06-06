# Luumix

Luumix is a tempo-locked background DJ for focused work.

It is not just a crossfade music player. The core idea is to keep a stable musical pulse while automatically preparing, syncing, and transitioning between tracks at musically sensible boundaries.

## Product Intent

Luumix is for listening while working.

The goal is not club performance, surprise, or expressive human DJing. The goal is a continuous, stable, low-friction listening flow where tracks are mixed automatically without breaking concentration.

## Core Requirements

- Lock playback to a master tempo.
- Analyze music files when they are added to the library.
- Store analysis results as metadata sidecar files or a local database.
- Detect tempo, beat grid, downbeat candidates, and phrase/section candidates.
- Prepare the next track in parallel while the current track is playing.
- Time-stretch the next track to the master tempo within safe limits.
- Start transitions on beat/bar/phrase-aware boundaries.
- Crossfade between tracks without abrupt volume, tempo, or energy jumps.
- Keep automatic decisions explainable and correctable.
- Cache manual corrections so a track only needs to be fixed once.

## Main Plan

The canonical implementation plan is:

```text
docs/implementation-plan.md
```

Luumix should be built analysis-first. The first success condition is not full playback. It is producing track metadata that can be visually inspected and judged correct or fixable.

The analysis-first decision record is:

```text
docs/issues/0001-analysis-first-plan.md
```

## Non-Goals

- Not a generic music player.
- Not a streaming service.
- Not a DAW.
- Not a manual DJ controller.
- Not a club performance tool.
- Not a generative music system.
- Not focused on scratches, hot cues, loops, or expressive effects at first.

## Initial Architecture

```text
music file
  -> library import
  -> offline analysis pipeline
  -> analysis metadata
  -> AI-assisted candidate selection
  -> effective track metadata
  -> tempo-locked playback engine
  -> parallel deck transition
```

The runtime player should not need to think deeply about a track while audio is playing. Expensive or uncertain analysis should happen during import.

## Track Metadata Model

The project should separate these layers:

- `analysis`: machine-generated observations and candidates.
- `aiReview`: AI-selected effective candidates and risk judgment.
- `manualOverrides`: user corrections.
- `effective`: resolved metadata used by the playback engine.

This keeps automatic analysis useful while accepting that beat/downbeat detection will sometimes be wrong.

## Suggested Milestones

See `docs/implementation-plan.md` for the canonical project phases.

### v0: Import and metadata

- Import local audio files.
- Extract duration, codec info, sample rate, channels.
- Detect loudness and silence boundaries.
- Write sidecar metadata files.

### v1: Rhythm analysis

- Estimate BPM candidates.
- Generate beat grid candidates.
- Generate 4/4 downbeat phase candidates.
- Mark confidence and risk signals.

### v2: AI review

- Generate compact `analysis-for-ai.json`.
- Ask AI to select usable BPM/beat/downbeat/mix candidates.
- Write `effective-analysis.json`.

### v3: Playback prototype

- Play a track at a fixed master tempo.
- Time-stretch within a conservative safe range.
- Display beat/bar grid alignment.

### v4: Parallel deck transition

- Maintain deck A and deck B.
- Prepare the next track in sync with the master grid.
- Start B at a selected bar boundary.
- Crossfade A to B over a fixed number of bars.

### v5: Correction UI

- Allow manual BPM/downbeat/mix point correction.
- Persist corrections.
- Recompute effective metadata.

## Naming

`Luumix` is intentionally a soft, slightly unusual spelling. It keeps the `mix` signal while avoiding the stronger existing-brand association of `Lumix` and the slightly awkward feel of `Loomix`.
