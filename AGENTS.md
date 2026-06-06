# AGENTS.md

Guidance for Codex and other AI agents working in this repository.

This repository is for Luumix, a tempo-locked background DJ for focused work.

## Repository Boundary

This repository is intended to track:

```text
https://github.com/hayashikentaro/luumix
```

Before making changes, confirm you are in the correct local checkout:

```bash
pwd
git remote -v
git status --short --branch
```

The expected remote is:

```text
origin  https://github.com/hayashikentaro/luumix (fetch)
origin  https://github.com/hayashikentaro/luumix (push)
```

An SSH remote for the same repository is also acceptable when local authentication requires it:

```text
origin  git@github.com:hayashikentaro/luumix.git (fetch)
origin  git@github.com:hayashikentaro/luumix.git (push)
```

Do not edit files outside this repository for Luumix work unless the user explicitly asks.

## Product Direction

Luumix is a tempo-locked background DJ for focused work.

It is not just a crossfade music player, a generic local music player, a DAW, a manual DJ controller, or a generative music system.

The product value is a stable, low-friction listening flow where existing tracks are automatically prepared, tempo-matched, and transitioned at musically sensible beat/bar/phrase boundaries while the user is working.

Dangerous or high-uncertainty paths should be structurally constrained where possible. Inside safe capability boundaries, AI agents should be able to operate freely.

## Current Project State

The repository is in early product/architecture initialization.

Current files:

```text
README.md                   Product overview, intent, non-goals, milestones
AGENTS.md                   Repository guidance for AI agents
docs/analysis-pipeline.md   Import-time audio analysis and AI review pipeline
```

Planned documentation areas:

```text
docs/architecture.md        Project architecture map and refactoring seams
docs/issues/                Decision records, deferred product questions, tradeoffs
docs/guides/                Responsibility-specific implementation guidance
docs/schemas/               Metadata schemas and example payloads
docs/playback-engine.md     Tempo-locked playback and deck scheduling notes
docs/product-principles.md  Product boundaries, non-goals, and UX principles
```

Do not create a large documentation tree just for aesthetics. Add a document when it answers a real design, implementation, or handoff need.

## Domain Concepts

- Track: a source audio file imported into the Luumix library.
- Library import: the point where expensive analysis should happen.
- Analysis metadata: machine-generated observations and candidates derived from audio.
- AI review: schema-bound candidate selection and risk classification based on structured analysis data.
- Manual override: user corrections that must win over machine analysis and AI review.
- Effective metadata: resolved values consumed by playback.
- Master tempo: the global tempo target for stable focused listening.
- Beat grid: the estimated beat positions for a track.
- Downbeat/bar awareness: knowledge of likely bar starts under a meter assumption such as 4/4.
- Phrase boundary: a likely 8/16/32-bar musical transition point.
- Deck: a playback lane. Luumix should eventually support at least deck A and deck B for parallel preparation and transition.
- Hot audio path: timing-sensitive playback and scheduling code. Keep uncertain AI or heavy analysis out of this path.

Keep master tempo, beat grid, downbeat/bar awareness, parallel deck preparation, tempo-matched transition, and correction caching central. UI and analysis choices must serve this product boundary rather than drifting toward a generic player.

## Working Principles

- Preserve the core product idea: this is not just a crossfade player.
- Do not remove the tempo-locked DJ requirement to simplify implementation.
- Prefer offline analysis at library import time over runtime guessing.
- Prefer structured metadata, explicit candidates, confidence scores, and manual overrides.
- Keep playback runtime deterministic and boring.
- Keep uncertain analysis outside the hot audio path.
- Prefer narrow first targets: 4/4, stable tempo, clear beat, local files, and conservative transitions.
- Reject or flag difficult tracks before pretending they are safe to auto-mix.

## Core Product Boundary

Luumix must keep these requirements central:

- master tempo
- beat grid
- downbeat/bar awareness
- parallel deck preparation
- tempo-matched transition
- bar/phrase-aware crossfade
- correction and caching

It may defer or simplify these areas:

- expressive DJ controls
- scratches
- performance effects
- streaming integrations
- recommendation algorithms
- perfect song-structure recognition
- key detection and harmonic mixing
- cloud sync

## Implementation Bias

Favor a layered design:

```text
packages/analysis      audio feature extraction and candidate generation
packages/metadata      schemas, effective metadata resolution, overrides
packages/playback      tempo-locked playback and deck scheduling
packages/app           UI shell
```

Do not couple low-level signal analysis directly to UI state. Do not make the playback engine depend on an LLM.

Expected dependency direction:

```text
app -> playback -> metadata
app -> analysis -> metadata
analysis -> metadata
playback -> metadata
```

Avoid dependency direction like:

```text
playback -> app
playback -> AI provider
metadata -> UI components
analysis -> playback runtime state
```

## AI-Assisted Analysis

AI should not be asked to analyze raw audio directly as the primary mechanism.

The application should first generate structured observation data from deterministic or MIR-oriented analysis tools, then ask AI to choose between candidates and classify risk.

Good AI responsibilities:

- choose between BPM candidates
- choose between downbeat phase candidates
- choose mix-in and mix-out points from candidates
- detect risky tracks from provided signals
- explain why a track should be rejected or manually corrected

Bad AI responsibilities:

- invent beat grids without input features
- produce free-form metadata without a schema
- make runtime playback decisions in the audio path
- hide uncertainty

## Metadata Rules

Keep generated analysis, AI review, manual overrides, and effective metadata separate.

Suggested layers:

- `analysis`: generated by local analysis tools
- `aiReview`: generated by AI from structured candidate data
- `manualOverrides`: user-controlled corrections
- `effective`: resolved metadata used by playback

Manual overrides must win over AI review and machine analysis.

When changing metadata shapes:

- preserve backward compatibility when possible
- include `schemaVersion`
- update examples and schema docs together
- avoid silently renaming fields used by playback
- document migration expectations when breaking changes are unavoidable

## Working Guidelines

- Keep changes scoped to the user's request.
- Prefer small, reviewable commits.
- Preserve user changes already present in the working tree.
- Prefer existing project conventions over introducing new structure.
- Avoid broad refactors unless they are required for the task.
- Add or update tests when changing behavior once a test setup exists.
- Document important setup, API, metadata, or workflow changes in the repository rather than only in chat.
- Do not silently change public names, file layout, metadata shapes, playback semantics, or product boundaries.
- When removing a feature or UI path, remove or clearly deprecate related code, config fields, types, docs, and examples so dead code is not mistaken for supported behavior.
- When changing metadata schemas or response shapes, update docs, examples, and consumer types together.
- Use `docs/issues/` for deferred product decisions, domain-model questions, and implementation tradeoffs that should stay close to the codebase. Treat these files as decision records rather than a general TODO backlog.
- Keep responsibility-specific implementation guidance in dedicated files under `docs/guides/`, not directly in this top-level router. When introducing or changing a recurring area-specific rule, create or update the relevant guide and link it from this file.

## Change Authorization Boundary

Only edit files that are directly required by the user's requested task.

Do not turn analysis, diagnosis, recommendations, or proposals into repository changes unless the user explicitly asks for repository edits.

Optional cleanup, docs updates, issue updates, rule updates, formatting sweeps, and adjacent refactors require explicit user approval.

The commit-and-push rule applies only after an authorized repository change has been made. It does not authorize making repository changes.

## Standard Task Workflow

For every implementation task in this repository, follow this workflow unless the user explicitly says otherwise.

Before editing:

- Confirm the current repository with `pwd`.
- Confirm the remote with `git remote -v`.
- Check the working tree with `git status --short --branch`.
- Preserve existing user changes.
- If unexpected changes or untracked files exist, report them instead of modifying or deleting them.

While editing:

- Keep changes scoped to the requested task.
- Prefer small, reviewable changes.
- Avoid broad refactors unless they are required for the task.
- Follow existing project conventions.
- When changing metadata schemas, playback semantics, API routes, response shapes, or persisted state, update related docs and consumer types together.
- Do not duplicate instructions or guidance already present in this `AGENTS.md`; update the existing relevant section instead.

After editing:

- Run the standard verification commands appropriate for the change.
- At minimum, run `git diff --check`.
- Run typecheck/build/test commands when application code exists and changed.
- If a check cannot be run, report why.

When finished:

- Commit the relevant changes.
- Push the commit.
- Report what changed, verification results, commit hash, push status, skipped checks, and unexpected files not touched.

## Prompt Handoff Convention

Agents working in this repository should read and follow this `AGENTS.md` before making changes.

Task-specific prompts should focus on the requested change, relevant context, non-goals, acceptance criteria, and task-specific verification. Repository-wide workflow rules are defined in this file.

If a task-specific user instruction conflicts with this file, stop and report the conflict unless the user's instruction clearly and safely overrides a non-safety process preference.

## Implementation Cautions

- Playback timing must remain predictable.
- Do not put AI calls in the hot audio path.
- Do not perform expensive audio analysis during a live transition.
- Do not assume every track is auto-mixable.
- Treat beat, downbeat, and phrase detection as uncertain candidate generation unless manually corrected.
- Keep generated analysis and manual overrides separate.
- Keep private music library metadata out of git unless intentionally using synthetic or public-domain fixtures.
- Avoid storing raw copyrighted audio in the repository.
- Prefer deterministic scheduling for deck transitions over reactive UI-driven timing.
- If browser audio APIs are used, document timing limits and where native/audio-worklet alternatives may be needed.

## Runtime And Generated Files

The repository should not commit local runtime state or private library data.

Likely generated or local-only paths:

```text
.luumix/
library/
metadata/
analysis-cache/
*.analysis.json
*.effective-analysis.json
```

Do not commit generated runtime state unless explicitly requested.

Do not delete untracked files unless the task explicitly asks for cleanup and the file is clearly generated.

If unexpected untracked files exist, report them rather than modifying them.

## Commit and Push Rule

Whenever repository files are modified, commit the relevant changes and push them to the current branch.

変更したら、関連する変更を commit して push すること。

- Do not force push.
- If push fails, report the reason and leave the local commit intact.

## Development Workflow

Inspect `package.json` before introducing new scripts. Prefer existing npm scripts and repository tooling; do not invent replacement tooling if repo scripts exist.

Relevant verification commands will evolve once the implementation exists.

Current minimum for documentation-only changes:

```bash
git diff --check
```

Future likely verification commands:

```bash
npm run build
npm run test
npm run typecheck
```

If a check cannot be run because of sandbox, permissions, missing dependencies, or missing local services, report that clearly.

## Handoff Reporting

When handing work back, report:

- What changed.
- Verification commands run.
- Commit hash.
- Push status.
- Known limitations or skipped checks.
- Unexpected files not touched.

## Do Not

- Do not turn this into a generic music player.
- Do not make crossfade-only behavior the main value proposition.
- Do not treat BPM/downbeat/phrase analysis as optional to the product concept.
- Do not store copyrighted audio samples in the repository.
- Do not commit generated music metadata for private music libraries unless intentionally using small synthetic fixtures.
