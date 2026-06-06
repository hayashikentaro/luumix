# Analysis Pipeline

Luumix should analyze tracks when they are added to the library, not while they are being mixed in the hot playback path.

The analysis pipeline should produce structured candidate data that can be reviewed by deterministic logic, AI, and humans.

## Pipeline Overview

```text
source audio
  -> decode / normalize analysis format
  -> low-level feature extraction
  -> rhythm candidate generation
  -> downbeat and bar candidate generation
  -> structure and transition candidate generation
  -> risk classification
  -> AI review
  -> effective metadata resolution
```

## 1. Decode and Inspect

Collect basic source information:

- path or library id
- content hash
- duration
- codec/container
- sample rate
- channel count
- bitrate if available

The content hash should be used to know when cached analysis is stale.

## 2. Low-Level Feature Extraction

Generate compact time-series features that can be stored and reviewed without keeping raw audio in metadata.

Useful features:

- waveform peak envelope
- RMS or loudness curve
- onset strength curve
- low/mid/high band energy
- spectral centroid
- spectral flux
- chroma or harmonic summary if needed later
- silence boundaries

Use a fixed frame resolution such as 0.1s or 0.25s for AI-facing summaries. Keep higher-resolution data internal if needed.

## 3. Rhythm Candidates

Do not produce only one BPM.

Produce multiple tempo hypotheses:

- primary BPM
- half-tempo candidate
- double-tempo candidate
- alternate candidates from different algorithms if available

Each candidate should include:

- bpm
- confidence
- source
- notes or risk flags

Beat grid candidates should include:

- bpm
- phase / first beat time
- beat positions
- confidence
- stability score

## 4. Downbeat and Bar Candidates

For 4/4-focused MVP, generate downbeat phase candidates from the selected or candidate beat grids.

A beat grid has four possible downbeat phases under a simple 4/4 assumption. Store them as explicit candidates rather than pretending there is always a single correct answer.

Each candidate should include:

- phase beat index
- downbeat positions
- confidence
- supporting signals

## 5. Structure Candidates

Generate candidate musical boundaries rather than trying to perfectly label song sections.

Useful candidates:

- first usable beat
- first usable downbeat
- intro end
- section change
- energy rise
- energy drop
- outro start
- last safe mix-out region

The first versions can be heuristic. For focused-work mixing, stable 8/16/32-bar boundaries are more important than perfect verse/chorus labels.

## 6. Transition Candidates

Create explicit candidates for where Luumix may enter or leave a track.

Candidate types:

- `mixIn`
- `mixOut`
- `avoid`

Each candidate should include:

- time in seconds
- bar number if known
- suggested transition length in bars
- score
- reasons
- risk notes

## 7. AI Review

AI should review structured candidate data and return schema-bound output.

The AI output should select:

- effective BPM
- selected beat grid
- selected downbeat candidate
- preferred mix-in points
- preferred mix-out points
- auto-mix safety classification
- notes for the user or future agent

AI should be allowed to reject tracks that are too risky for automatic mixing.

## 8. Effective Metadata Resolution

Playback should consume resolved metadata.

Resolution order:

```text
manualOverrides > aiReview > analysis default
```

The playback engine should not care whether the final value came from manual correction, AI review, or machine analysis.

## Example Metadata Shape

```json
{
  "schemaVersion": 1,
  "sourceFile": {
    "path": "music/example.flac",
    "contentHash": "sha256:...",
    "durationSec": 312.42,
    "sampleRate": 44100
  },
  "analysis": {
    "tempoCandidates": [
      { "id": "tempo-1", "bpm": 124.02, "confidence": 0.82, "source": "analyzer" },
      { "id": "tempo-half", "bpm": 62.01, "confidence": 0.41, "source": "derived-half" }
    ],
    "beatGrids": [
      {
        "id": "grid-1",
        "tempoCandidateId": "tempo-1",
        "phaseSec": 0.48,
        "confidence": 0.79,
        "beatsSec": [0.48, 0.964, 1.448]
      }
    ],
    "downbeatCandidates": [
      {
        "id": "downbeat-0",
        "beatGridId": "grid-1",
        "phaseBeatIndex": 0,
        "confidence": 0.72,
        "downbeatsSec": [0.48, 2.416, 4.352]
      }
    ],
    "transitionCandidates": {
      "mixIn": [],
      "mixOut": [],
      "avoid": []
    },
    "riskSignals": {
      "tempoUnstable": false,
      "downbeatAmbiguous": true,
      "doubleTempoAmbiguous": true
    }
  },
  "aiReview": null,
  "manualOverrides": {
    "bpm": null,
    "firstBeatSec": null,
    "firstDownbeatSec": null,
    "mixInSec": [],
    "mixOutSec": [],
    "disabled": false
  },
  "effective": null
}
```

## MVP Advice

Start with a narrow music target:

- 4/4 music
- stable tempo
- clear beat
- no live recordings at first
- no extreme tempo changes at first

The first useful version can reject difficult tracks instead of trying to mix everything.
