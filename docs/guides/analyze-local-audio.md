# Analyze Local Audio

This guide shows how to run the current Luumix analysis workflow on a private local audio file and inspect the generated static report.

The current workflow is for import-time analysis and visual inspection only. It does not implement playback, AI review, crossfading, or time-stretching.

## Prerequisites

- Node.js and npm.
- `ffmpeg` and `ffprobe` installed and available on `PATH`.

Check the media tools:

```bash
ffmpeg -version
ffprobe -version
```

Install dependencies and build the workspace:

```bash
npm install
npm run build
```

## Local Output Paths

Use ignored local paths for private input files, generated metadata, and generated reports:

```bash
mkdir -p .luumix/local-input .luumix/metadata .luumix/reports
cp /path/to/private-track.wav .luumix/local-input/track.wav
```

Do not commit private audio, private generated metadata, or generated reports unless you intentionally want those files in the repository. The `.luumix/` directory is local runtime state.

## Run Analysis

Generate analysis metadata:

```bash
npm run analyze -- .luumix/local-input/track.wav --out .luumix/metadata/track.analysis.json
```

If you intentionally want to replace an existing output file:

```bash
npm run analyze -- .luumix/local-input/track.wav --out .luumix/metadata/track.analysis.json --force
```

The output is a schema-valid `TrackAnalysisMetadata` JSON file. It currently includes source file metadata, compact feature summaries, rough tempo candidates, a rough beat grid candidate, four 4/4 downbeat phase candidates, heuristic structure candidates, and heuristic transition candidates. `autoMix` remains rejected.

## Generate Report

Create a standalone HTML report:

```bash
npm run report -- .luumix/metadata/track.analysis.json --out .luumix/reports/track.html
```

If replacing an existing report intentionally:

```bash
npm run report -- .luumix/metadata/track.analysis.json --out .luumix/reports/track.html --force
```

Open `.luumix/reports/track.html` in a browser. It does not require a server.

## Inspection Checklist

When inspecting the report:

- Confirm duration, sample rate, channel count, codec, and container look correct.
- Check whether the envelope roughly matches the track's audible energy.
- Check whether the primary BPM is plausible.
- Check whether half/double tempo alternatives are present where expected.
- Compare beat ticks against visible onset or energy peaks.
- Compare the four downbeat phase candidates and note which phase looks most plausible.
- Inspect structure candidates such as possible intro end, section change, and outro start.
- Inspect mix-in and mix-out candidates, but treat them as heuristic and not confirmed DJ-safe transitions.
- Read risk notes and confirm they are appropriately conservative.

The current downbeat, structure, and transition candidates are hypotheses for inspection. They are not confirmed musical downbeats, song sections, or DJ-safe transitions.

## Common Failures

- `ffprobe` missing: install ffmpeg/ffprobe and make sure `ffprobe` is on `PATH`.
- `ffmpeg` missing: install ffmpeg and make sure `ffmpeg` is on `PATH`.
- Unsupported or corrupt audio: try a known-good WAV, FLAC, MP3, or AAC file and confirm `ffprobe <file>` works.
- Tempo candidates are empty: the current heuristic did not find a plausible periodicity. This is expected for some sparse, unstable, quiet, or non-rhythmic files.
- Beat ticks look shifted: the beat grid is still heuristic. Record how far it appears shifted and whether the BPM itself looks correct.
- Downbeat phase looks wrong: choose which of `downbeat-phase-0` through `downbeat-phase-3` looks best, or note that none looks convincing.
- Mix-in or mix-out candidates look wrong: record whether the underlying beat/downbeat grid is wrong or whether the structure boundary itself seems musically poor.
- Output already exists: rerun with `--force` only when intentionally replacing the previous metadata or report.

## Feedback Format

After testing one private track, report back with:

- Source genre or track type, without sharing copyrighted audio.
- Expected BPM, if known.
- Detected tempo candidates from the report.
- Whether beat ticks align with visible or audible beats.
- Which downbeat phase looked most plausible.
- Whether structure, mix-in, and mix-out candidates look useful or obviously wrong.
- Any surprising risk notes.
- Optional screenshot of the report, if it does not expose private information. Do not commit private reports unless that is intentional.
