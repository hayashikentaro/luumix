import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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
  return JSON.parse(await readFile(fixturePath, "utf8")) as TrackAnalysisMetadata;
}

describe("resolveEffectiveMetadata", () => {
  it("matches the checked-in effective metadata fixture", async () => {
    const metadata = await loadFixture();
    const expected = JSON.parse(await readFile(effectiveFixturePath, "utf8"));

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
    metadata.manualOverrides = {
      ...metadata.manualOverrides,
      bpm: 123.5,
      firstBeatSec: 0.25,
      firstDownbeatSec: 2.202,
      mixInSec: [30],
      mixOutSec: [180],
      autoMixDisabled: true,
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
    expect(effective.autoMix.status).toBe("rejected");
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
});
