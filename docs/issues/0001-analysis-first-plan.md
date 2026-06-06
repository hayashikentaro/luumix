# 0001: Build analysis-first

## Status

Accepted.

## Context

Luumix has two major product halves:

1. Track analysis: read a music file and produce metadata that describes tempo, beat grid, downbeats, phrase/transition candidates, confidence, and risk.
2. Tempo-locked playback: use the metadata to prepare the next track in parallel, time-stretch it to a master tempo, and transition at musically sensible boundaries.

The playback half depends on the analysis half. If the analysis metadata cannot be made good enough for a human to inspect and trust, the later playback engine will not have a stable foundation.

## Decision

Build Luumix analysis-first.

The first implementation target is an analysis workbench, not a full player.

The first success condition is:

> Given a local music file, Luumix can produce track metadata that the user can inspect visually and judge as correct or fixable.

The canonical implementation plan is maintained in:

```text
docs/implementation-plan.md
```

## Consequences

- Playback work should wait until analysis metadata is inspectable and plausible.
- The first useful artifact is metadata plus visual/debug inspection, not continuous playback.
- Metadata schema design should come before MIR library selection.
- Difficult tracks may be rejected or flagged instead of force-mixed.
- AI should review structured candidates, not replace the analysis pipeline.

## Related Documents

- `docs/implementation-plan.md`
- `docs/analysis-pipeline.md`
