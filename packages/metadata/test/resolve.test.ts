import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseEffectiveTrackMetadata,
  parseTrackAnalysisMetadata,
  resolveEffectiveMetadata,
  type TrackAnalysisMetadata,
} from "../src/index.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  testDir,
  "../../../fixtures/metadata/simple-124bpm.analysis.json",
);
const effectiveFixturePath = resolve(
  testDir,
  "../../../fixtures/metadata/simple-124bpm.effective.json",
);

async function loadFixture(): Promise<TrackAnalysisMetadata> {
  return parseTrackAnalysisMetadata(JSON.parse(await readFile(fixturePath, "utf8")));
}

describe("resolveEffectiveMetadata", () => {
  it("validates the sample analysis and effective metadata fixtures", async () => {
    const analysis = await loadFixture();
    const effective = parseEffectiveTrackMetadata(
      JSON.parse(await readFile(effectiveFixturePath, "utf8")),
    );

    expect(analysis.analysis.tempoCandidates).toHaveLength(3);
    expect(analysis.analysis.beatGridCandidates.length).toBeGreaterThanOrEqual(1);
    expect(analysis.analysis.downbeatCandidates).toHaveLength(4);
    expect(effective.autoMix.status).toBe("approved");
  });

  it("matches the checked-in effective metadata fixture", async () => {
    const metadata = await loadFixture();
    const expected = parseEffectiveTrackMetadata(
      JSON.parse(await readFile(effectiveFixturePath, "utf8")),
    );

    expect(resolveEffectiveMetadata(metadata)).toEqual(expected);
  });

  it("resolves AI-selected candidates over analysis defaults", async () => {
    const metadata = await loadFixture();

    const effective = resolveEffectiveMetadata(metadata);

    expect(effective.bpm).toBe(124);
    expect(effective.bpmSource).toBe("aiReview");
    expect(effective.beatGrid.candidateId).toBe("grid-tight");
    expect(effective.downbeat.candidateId).toBe("downbeat-phase-0");
    expect(effective.mixInSec).toEqual([15.484]);
    expect(effective.mixOutSec).toEqual([185.806]);
    expect(effective.autoMix.status).toBe("approved");
  });

  it("lets manual overrides win over AI review and analysis", async () => {
    const metadata = await loadFixture();
    const originalAnalysis = structuredClone(metadata.analysis);
    metadata.manualOverrides = {
      ...metadata.manualOverrides,
      bpm: 123.5,
      firstBeatSec: 0.25,
      firstDownbeatSec: 2.202,
      mixInSec: [30],
      mixOutSec: [180],
    };

    const effective = resolveEffectiveMetadata(metadata);

    expect(effective.bpm).toBe(123.5);
    expect(effective.bpmSource).toBe("manual");
    expect(effective.beatGrid.source).toBe("manual");
    expect(effective.beatGrid.firstBeatSec).toBe(0.25);
    expect(effective.downbeat.source).toBe("manual");
    expect(effective.downbeat.firstDownbeatSec).toBe(2.202);
    expect(effective.mixInSec).toEqual([30]);
    expect(effective.mixOutSec).toEqual([180]);
    expect(effective.autoMix.status).toBe("approved");
    expect(metadata.analysis).toEqual(originalAnalysis);
  });

  it("falls back to analysis defaults when AI review is absent", async () => {
    const metadata = await loadFixture();
    metadata.aiReview = null;

    const effective = resolveEffectiveMetadata(metadata);

    expect(effective.bpm).toBe(124);
    expect(effective.bpmSource).toBe("analysis");
    expect(effective.beatGrid.candidateId).toBe("grid-tight");
    expect(effective.downbeat.candidateId).toBe("downbeat-phase-2");
    expect(effective.mixInSec).toEqual([31.936]);
    expect(effective.mixOutSec).toEqual([169.806]);
    expect(effective.autoMix.status).toBe("risky");
  });

  it("resolves rejected or disabled tracks with no transition points", async () => {
    const aiRejected = await loadFixture();
    aiRejected.aiReview = {
      ...aiRejected.aiReview!,
      autoMix: {
        status: "rejected",
        reasons: ["Fixture track is marked unsafe for automatic mixing."],
      },
    };

    const aiRejectedEffective = resolveEffectiveMetadata(aiRejected);

    expect(aiRejectedEffective.autoMix.status).toBe("rejected");
    expect(aiRejectedEffective.mixInSec).toEqual([]);
    expect(aiRejectedEffective.mixOutSec).toEqual([]);

    const manuallyDisabled = await loadFixture();
    manuallyDisabled.manualOverrides.autoMixDisabled = true;

    const manuallyDisabledEffective = resolveEffectiveMetadata(manuallyDisabled);

    expect(manuallyDisabledEffective.autoMix.status).toBe("rejected");
    expect(manuallyDisabledEffective.mixInSec).toEqual([]);
    expect(manuallyDisabledEffective.mixOutSec).toEqual([]);
  });
});
