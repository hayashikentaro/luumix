import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTrackAnalysisMetadata, type AiReview } from "@luumix/metadata";
import {
  computeFeatureSummary,
  createFfmpegFeatureExtractor,
  type SpawnLike,
} from "../src/features.js";
import {
  analyzeFile,
  applyAiReview,
  createEvaluationTemplate,
  createAiReviewInput,
  parseAnalysisEvaluation,
  summarizeEvaluations,
  validateEvaluationFile,
  writeEvaluationSummary,
  writeAiReviewInput,
  writeAiReviewedMetadata,
  writeEvaluationTemplate,
  writeOverrideTemplate,
  writeResolvedMetadata,
} from "../src/index.js";
import { parseArgs } from "../src/cli.js";
import {
  createFfprobeAudioProbe,
  parseFfprobeOutput,
  type AudioProbeResult,
} from "../src/probe.js";
import {
  generateAnalysisReportHtml,
  writeAnalysisReport,
} from "../src/report.js";
import { estimateBeatGridCandidates } from "../src/beat-grid.js";
import { estimateDownbeatCandidates } from "../src/downbeat.js";
import {
  estimateStructureCandidates,
  estimateTransitionCandidates,
} from "../src/structure.js";
import { estimateTempoCandidates } from "../src/tempo.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "luumix-analysis-"));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

async function readMetadata(path: string) {
  return parseTrackAnalysisMetadata(JSON.parse(await readFile(path, "utf8")));
}

const probeResult: AudioProbeResult = {
  durationSec: 12.345,
  sampleRate: 48000,
  channels: 2,
  codec: "pcm_s16le",
  container: "wav",
};
const featureSummary = {
  frameHopSec: 0.1,
  peakEnvelope: [0, 0.5, 0.25],
  rmsEnvelope: [0, 0.353553, 0.176777],
  silenceRangesSec: [],
};

describe("estimateTempoCandidates", () => {
  it("detects a primary candidate near 120 BPM from a synthetic pulse train", () => {
    const candidates = estimateTempoCandidates(createPulseFeatureSummary(120));

    expect(candidates[0]?.id).toBe("tempo-primary");
    expect(candidates[0]?.bpm).toBeCloseTo(120, 3);
    expect(candidates[0]?.source).toBe("heuristic");
    expect(candidates[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("includes half and double alternatives when a primary candidate exists", () => {
    const candidates = estimateTempoCandidates(createPulseFeatureSummary(120));

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "tempo-primary",
      "tempo-half",
      "tempo-double",
    ]);
    expect(candidates.find((candidate) => candidate.id === "tempo-half")?.bpm).toBe(60);
    expect(candidates.find((candidate) => candidate.id === "tempo-double")?.bpm).toBe(240);
  });

  it("returns no candidates for flat input", () => {
    const candidates = estimateTempoCandidates({
      frameHopSec: 0.1,
      rmsEnvelope: new Array(40).fill(0),
    });

    expect(candidates).toEqual([]);
  });
});

describe("estimateBeatGridCandidates", () => {
  it("generates a plausible beat grid candidate from a 120 BPM pulse train", () => {
    const featureSummary = createPulseFeatureSummary(120);
    const tempoCandidates = estimateTempoCandidates(featureSummary);
    const candidates = estimateBeatGridCandidates({
      durationSec: 12,
      featureSummary,
      tempoCandidates,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("beat-grid-primary");
    expect(candidates[0]?.tempoCandidateId).toBe("tempo-primary");
    expect(candidates[0]?.firstBeatSec).toBeCloseTo(0.5, 3);
    expect(candidates[0]?.beatsSec.length).toBeGreaterThan(20);
    expect(candidates[0]?.confidence).toBeGreaterThan(0.45);
  });

  it("returns no candidates without tempo candidates", () => {
    const candidates = estimateBeatGridCandidates({
      durationSec: 12,
      featureSummary: createPulseFeatureSummary(120),
      tempoCandidates: [],
    });

    expect(candidates).toEqual([]);
  });

  it("returns no candidates for flat input and does not crash", () => {
    const candidates = estimateBeatGridCandidates({
      durationSec: 12,
      featureSummary: {
        frameHopSec: 0.1,
        rmsEnvelope: new Array(40).fill(0),
      },
      tempoCandidates: [
        {
          id: "tempo-primary",
          bpm: 120,
          confidence: 0.5,
          source: "heuristic",
        },
      ],
    });

    expect(candidates).toEqual([]);
  });
});

describe("estimateDownbeatCandidates", () => {
  it("generates four 4/4 phase candidates from a beat grid", () => {
    const beatGridCandidates = [createBeatGridCandidate()];
    const candidates = estimateDownbeatCandidates({
      beatGridCandidates,
      durationSec: 8,
      featureSummary: createPulseFeatureSummary(120),
    });

    expect(candidates).toHaveLength(4);
    expect(candidates.map((candidate) => candidate.phaseBeatIndex)).toEqual([
      0,
      1,
      2,
      3,
    ]);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "downbeat-phase-0",
      "downbeat-phase-1",
      "downbeat-phase-2",
      "downbeat-phase-3",
    ]);
  });

  it("creates downbeat times every four beats for each phase", () => {
    const candidates = estimateDownbeatCandidates({
      beatGridCandidates: [createBeatGridCandidate()],
      durationSec: 8,
      featureSummary: createPulseFeatureSummary(120),
    });

    expect(candidates[0]?.downbeatsSec.slice(0, 3)).toEqual([0.5, 2.5, 4.5]);
    expect(candidates[1]?.downbeatsSec.slice(0, 3)).toEqual([1, 3, 5]);
    expect(candidates[2]?.downbeatsSec.slice(0, 3)).toEqual([1.5, 3.5, 5.5]);
    expect(candidates[3]?.downbeatsSec.slice(0, 3)).toEqual([2, 4, 6]);
  });

  it("returns no candidates without a beat grid", () => {
    const candidates = estimateDownbeatCandidates({
      beatGridCandidates: [],
      durationSec: 8,
      featureSummary: createPulseFeatureSummary(120),
    });

    expect(candidates).toEqual([]);
  });
});

describe("structure and transition estimation", () => {
  it("generates first usable, intro, and outro structure candidates", () => {
    const candidates = estimateStructureCandidates({
      beatGridCandidates: [createBeatGridCandidate(180)],
      downbeatCandidates: [createDownbeatCandidate(180)],
      durationSec: 180,
      featureSummary: createPulseFeatureSummary(120, 180),
    });

    expect(candidates.map((candidate) => candidate.kind)).toContain(
      "firstUsableDownbeat",
    );
    expect(candidates.map((candidate) => candidate.kind)).toContain("introEnd");
    expect(candidates.map((candidate) => candidate.kind)).toContain("outroStart");
  });

  it("generates mix-in and mix-out transition candidates from structure candidates", () => {
    const input = {
      beatGridCandidates: [createBeatGridCandidate(180)],
      downbeatCandidates: [createDownbeatCandidate(180)],
      durationSec: 180,
      featureSummary: createPulseFeatureSummary(120, 180),
    };
    const structureCandidates = estimateStructureCandidates(input);
    const transitionCandidates = estimateTransitionCandidates({
      ...input,
      structureCandidates,
    });

    expect(transitionCandidates.mixIn.length).toBeGreaterThan(0);
    expect(transitionCandidates.mixOut.length).toBeGreaterThan(0);
    expect(transitionCandidates.mixIn[0]?.barNumber).toBeDefined();
    expect(transitionCandidates.mixOut[0]?.barNumber).toBeDefined();
  });

  it("returns empty structure and transitions without downbeat candidates", () => {
    const input = {
      beatGridCandidates: [createBeatGridCandidate(180)],
      downbeatCandidates: [],
      durationSec: 180,
      featureSummary: createPulseFeatureSummary(120, 180),
    };

    expect(estimateStructureCandidates(input)).toEqual([]);
    expect(
      estimateTransitionCandidates({
        ...input,
        structureCandidates: [],
      }),
    ).toEqual({ mixIn: [], mixOut: [], avoid: [] });
  });
});

describe("analyzeFile", () => {
  it("fails for a missing input file", async () => {
    await expect(
      analyzeFile({
        inputPath: join(tempDir, "missing.wav"),
        outPath: join(tempDir, "out", "track.analysis.json"),
      }),
    ).rejects.toThrow("Input file not found");
  });

  it("fails for a directory input", async () => {
    await expect(
      analyzeFile({
        inputPath: tempDir,
        outPath: join(tempDir, "out", "track.analysis.json"),
      }),
    ).rejects.toThrow("Input path must be a file");
  });

  it("fails when output exists without force", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "metadata", "track.analysis.json");
    await writeFile(inputPath, "first", "utf8");
    await mkdir(join(tempDir, "metadata"), { recursive: true });
    await writeFile(outPath, "existing", "utf8");

    await expect(analyzeFile({ inputPath, outPath })).rejects.toThrow(
      "Output already exists",
    );
  });

  it("overwrites existing output when force is enabled", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "metadata", "track.analysis.json");
    await writeFile(inputPath, "first", "utf8");
    await mkdir(join(tempDir, "metadata"), { recursive: true });
    await writeFile(outPath, "existing", "utf8");

    await analyzeFile({
      force: true,
      extractFeatures: async () => featureSummary,
      inputPath,
      outPath,
      probeAudio: async () => probeResult,
    });

    const outputStat = await stat(outPath);
    const metadata = await readMetadata(outPath);

    expect(outputStat.size).toBeGreaterThan("existing".length);
    expect(metadata.sourceFile.path).toBe(inputPath);
  });

  it("writes schema-valid rejected metadata with probed source fields", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await analyzeFile({
      extractFeatures: async () => featureSummary,
      inputPath,
      outPath,
      probeAudio: async () => probeResult,
    });

    const metadata = await readMetadata(outPath);

    expect(metadata.sourceFile.fileSizeBytes).toBe(23);
    expect(metadata.sourceFile.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(metadata.sourceFile.durationSec).toBe(12.345);
    expect(metadata.sourceFile.sampleRate).toBe(48000);
    expect(metadata.sourceFile.channels).toBe(2);
    expect(metadata.sourceFile.codec).toBe("pcm_s16le");
    expect(metadata.sourceFile.container).toBe("wav");
    expect(metadata.analysis.featureSummary).toEqual(featureSummary);
    expect(metadata.analysis.tempoCandidates).toEqual([]);
    expect(metadata.analysis.beatGridCandidates).toEqual([]);
    expect(metadata.analysis.downbeatCandidates).toEqual([]);
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
    expect(metadata.analysis.riskSignals.lowConfidence).toBe(true);
    expect(metadata.aiReview).toBeNull();
    expect(metadata.effective).toBeNull();
  });

  it("writes schema-valid tempo candidates from extracted features", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await analyzeFile({
      extractFeatures: async () => createPulseFeatureSummary(120),
      inputPath,
      outPath,
      probeAudio: async () => probeResult,
    });

    const metadata = await readMetadata(outPath);

    expect(metadata.analysis.tempoCandidates).toHaveLength(3);
    expect(metadata.analysis.tempoCandidates[0]?.bpm).toBeCloseTo(120, 3);
    expect(metadata.analysis.defaults.tempoCandidateId).toBe("tempo-primary");
    expect(metadata.analysis.beatGridCandidates).toHaveLength(1);
    expect(metadata.analysis.defaults.beatGridCandidateId).toBe("beat-grid-primary");
    expect(metadata.analysis.downbeatCandidates).toHaveLength(4);
    expect(metadata.analysis.defaults.downbeatCandidateId).toBe("downbeat-phase-0");
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
    expect(metadata.analysis.riskSignals.doubleTempoAmbiguous).toBe(true);
    expect(metadata.analysis.riskSignals.downbeatAmbiguous).toBe(true);
    expect(metadata.effective).toBeNull();
  });

  it("writes structure and transition candidates for a longer detectable track", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await analyzeFile({
      extractFeatures: async () => createPulseFeatureSummary(120, 180),
      inputPath,
      outPath,
      probeAudio: async () => ({
        ...probeResult,
        durationSec: 180,
      }),
    });

    const metadata = await readMetadata(outPath);

    expect(metadata.analysis.structureCandidates.length).toBeGreaterThan(0);
    expect(metadata.analysis.transitionCandidates.mixIn.length).toBeGreaterThan(0);
    expect(metadata.analysis.transitionCandidates.mixOut.length).toBeGreaterThan(0);
    expect(metadata.analysis.defaults.mixInTransitionId).toBeDefined();
    expect(metadata.analysis.defaults.mixOutTransitionId).toBeDefined();
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
  });

  it("does not write partial metadata when probing fails", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await expect(
      analyzeFile({
        inputPath,
        outPath,
        extractFeatures: async () => featureSummary,
        probeAudio: async () => {
          throw new Error("probe failed");
        },
      }),
    ).rejects.toThrow("probe failed");

    await expect(stat(outPath)).rejects.toThrow();
  });

  it("does not write partial metadata when feature extraction fails", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await expect(
      analyzeFile({
        inputPath,
        outPath,
        extractFeatures: async () => {
          throw new Error("feature extraction failed");
        },
        probeAudio: async () => probeResult,
      }),
    ).rejects.toThrow("feature extraction failed");

    await expect(stat(outPath)).rejects.toThrow();
  });

  it("changes contentHash when file content changes", async () => {
    const inputPath = join(tempDir, "track.wav");
    const firstOutPath = join(tempDir, "first.analysis.json");
    const secondOutPath = join(tempDir, "second.analysis.json");

    await writeFile(inputPath, "first", "utf8");
    await analyzeFile({
      extractFeatures: async () => featureSummary,
      inputPath,
      outPath: firstOutPath,
      probeAudio: async () => probeResult,
    });

    await writeFile(inputPath, "second", "utf8");
    await analyzeFile({
      extractFeatures: async () => featureSummary,
      inputPath,
      outPath: secondOutPath,
      probeAudio: async () => probeResult,
    });

    const first = await readMetadata(firstOutPath);
    const second = await readMetadata(secondOutPath);

    expect(first.sourceFile.contentHash).not.toBe(second.sourceFile.contentHash);
  });
});

describe("generateAnalysisReportHtml", () => {
  it("includes source summary and escaped metadata fields", async () => {
    const metadata = await createTestMetadata();
    metadata.sourceFile.path = "synthetic/<track>.wav";

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain("Luumix Analysis Report");
    expect(html).toContain("synthetic/&lt;track&gt;.wav");
    expect(html).toContain("sha256:");
    expect(html).toContain("12.345 sec");
    expect(html).toContain("48000 Hz");
    expect(html).toContain("pcm_s16le");
  });

  it("includes an SVG envelope when featureSummary exists", async () => {
    const metadata = await createTestMetadata();

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain("<svg");
    expect(html).toContain('data-overlay-layer="beat-ticks"');
    expect(html).toContain('data-overlay-layer="downbeat-ticks"');
    expect(html).toContain("Peak envelope");
    expect(html).toContain("RMS envelope");
  });

  it("includes beat tick overlays when beat grid candidates exist", async () => {
    const metadata = await createTestMetadata(createPulseFeatureSummary(120));

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain('data-overlay-layer="beat-ticks"');
    expect(html).toContain('stroke="var(--beat)"');
    expect(html).toContain("Beat ticks");
  });

  it("includes downbeat tick overlays when downbeat candidates exist", async () => {
    const metadata = await createTestMetadata(createPulseFeatureSummary(120));

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain('data-overlay-layer="downbeat-ticks"');
    expect(html).toContain('stroke="var(--downbeat)"');
    expect(html).toContain("Downbeat ticks");
  });

  it("includes structure and transition candidates", async () => {
    const metadata = await createTestMetadata(createPulseFeatureSummary(120, 180), {
      durationSec: 180,
    });

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain("Structure candidates");
    expect(html).toContain("Mix-in candidates");
    expect(html).toContain("Mix-out candidates");
    expect(html).toContain('data-overlay-layer="transition-markers"');
  });

  it("handles empty candidate arrays", async () => {
    const metadata = await createTestMetadata();

    const html = generateAnalysisReportHtml(metadata);

    expect(html).toContain("No tempo candidates are available yet.");
    expect(html).toContain("No beat grid candidates are available yet.");
    expect(html).toContain("No downbeat candidates are available yet.");
  });
});

describe("writeAnalysisReport", () => {
  it("validates input metadata before writing report", async () => {
    const inputPath = join(tempDir, "invalid.analysis.json");
    const outPath = join(tempDir, "report.html");
    await writeFile(inputPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    await expect(writeAnalysisReport({ inputPath, outPath })).rejects.toThrow();
    await expect(stat(outPath)).rejects.toThrow();
  });

  it("refuses existing output without force", async () => {
    const metadata = await createTestMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "report.html");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await expect(writeAnalysisReport({ inputPath, outPath })).rejects.toThrow(
      "Output already exists",
    );
  });

  it("writes a standalone HTML report and creates output directories", async () => {
    const metadata = await createTestMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "reports", "track.html");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");

    await writeAnalysisReport({ inputPath, outPath });

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Luumix Analysis Report");
  });
});

describe("createAiReviewInput", () => {
  it("includes candidate IDs, defaults, reviewer tasks, and constraints", async () => {
    const metadata = await createResolvableMetadata();

    const input = createAiReviewInput(metadata);

    expect(input.promptInputVersion).toBe(1);
    expect(input.source.durationSec).toBe(180);
    expect(input.tempoCandidates.map((candidate) => candidate.id)).toContain(
      "tempo-primary",
    );
    expect(input.beatGridCandidates.map((candidate) => candidate.id)).toContain(
      "beat-grid-primary",
    );
    expect(input.downbeatCandidates.map((candidate) => candidate.id)).toContain(
      metadata.analysis.defaults.downbeatCandidateId,
    );
    expect(input.defaults).toEqual(metadata.analysis.defaults);
    expect(input.reviewerTask.select).toContain("selectedTempoCandidateId");
    expect(input.reviewerTask.classifyAutoMixStatusAs).toEqual([
      "approved",
      "risky",
      "rejected",
    ]);
    expect(input.constraints.join(" ")).toContain("Do not invent candidate IDs");
  });

  it("truncates large beat and downbeat arrays to timing samples", async () => {
    const metadata = await createResolvableMetadata();

    const input = createAiReviewInput(metadata);
    const beatGrid = input.beatGridCandidates[0];
    const downbeat = input.downbeatCandidates[0];

    expect(beatGrid?.beatCount).toBe(
      metadata.analysis.beatGridCandidates[0]?.beatsSec.length,
    );
    expect(beatGrid?.firstBeatsSec.length).toBeLessThan(beatGrid?.beatCount ?? 0);
    expect(beatGrid?.firstBeatsSec).toEqual(
      metadata.analysis.beatGridCandidates[0]?.beatsSec.slice(0, 12),
    );
    expect(downbeat?.downbeatCount).toBe(
      metadata.analysis.downbeatCandidates[0]?.downbeatsSec.length,
    );
    expect(downbeat?.firstDownbeatsSec.length).toBeLessThan(
      downbeat?.downbeatCount ?? 0,
    );
    expect(downbeat?.firstDownbeatsSec).toEqual(
      metadata.analysis.downbeatCandidates[0]?.downbeatsSec.slice(0, 12),
    );
  });

  it("does not include full feature envelope or timing arrays", async () => {
    const metadata = await createResolvableMetadata();

    const serialized = JSON.stringify(createAiReviewInput(metadata));

    expect(serialized).not.toContain("featureSummary");
    expect(serialized).not.toContain("peakEnvelope");
    expect(serialized).not.toContain("rmsEnvelope");
    expect(serialized).not.toContain('"beatsSec":');
    expect(serialized).not.toContain('"downbeatsSec":');
  });
});

describe("writeAiReviewInput", () => {
  it("writes compact AI review input and creates output directories", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "metadata", "track.analysis-for-ai.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");

    await writeAiReviewInput({ inputPath, outPath });

    const output = JSON.parse(await readFile(outPath, "utf8")) as {
      promptInputVersion?: number;
      tempoCandidates?: Array<{ id: string }>;
      featureSummary?: unknown;
    };
    expect(output.promptInputVersion).toBe(1);
    expect(output.tempoCandidates?.map((candidate) => candidate.id)).toContain(
      "tempo-primary",
    );
    expect(output.featureSummary).toBeUndefined();
  });

  it("refuses existing output without force", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "track.analysis-for-ai.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await expect(writeAiReviewInput({ inputPath, outPath })).rejects.toThrow(
      "Output already exists",
    );
  });

  it("overwrites existing output when force is enabled", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "track.analysis-for-ai.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await writeAiReviewInput({ force: true, inputPath, outPath });

    const output = await readFile(outPath, "utf8");
    expect(output).toContain('"promptInputVersion": 1');
  });

  it("fails clearly on invalid metadata", async () => {
    const inputPath = join(tempDir, "invalid.analysis.json");
    const outPath = join(tempDir, "track.analysis-for-ai.json");
    await writeFile(inputPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    await expect(writeAiReviewInput({ inputPath, outPath })).rejects.toThrow(
      "Invalid analysis metadata",
    );
    await expect(stat(outPath)).rejects.toThrow();
  });
});

describe("analysis evaluation notes", () => {
  it("initializes a compact evaluation template from sample metadata", async () => {
    const metadata = parseTrackAnalysisMetadata(
      JSON.parse(
        await readFile(
          join(process.cwd(), "../../fixtures/metadata/simple-124bpm.analysis.json"),
          "utf8",
        ),
      ),
    );

    const evaluation = createEvaluationTemplate(
      metadata,
      new Date("2026-01-02T03:04:05.000Z"),
    );

    expect(evaluation.sourceContentHash).toBe(metadata.sourceFile.contentHash);
    expect(evaluation.sourcePathHint).toBe(metadata.sourceFile.path);
    expect(evaluation.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(evaluation.observed).toEqual({
      tempoCandidateId: metadata.analysis.defaults.tempoCandidateId,
      beatGridCandidateId: metadata.analysis.defaults.beatGridCandidateId,
      downbeatCandidateId: metadata.analysis.defaults.downbeatCandidateId,
      mixInTransitionId: metadata.analysis.defaults.mixInTransitionId,
      mixOutTransitionId: metadata.analysis.defaults.mixOutTransitionId,
    });
    expect(evaluation.judgment).toEqual({
      bpm: "unknown",
      beatGrid: "unknown",
      downbeat: "unknown",
      transitions: "unknown",
      overall: "unknown",
    });
    expect(parseAnalysisEvaluation(evaluation)).toEqual(evaluation);
  });

  it("writes an evaluation template and refuses overwrite unless forced", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "metadata", "track.evaluation.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");

    await writeEvaluationTemplate({ inputPath, outPath });
    await expect(writeEvaluationTemplate({ inputPath, outPath })).rejects.toThrow(
      "Output already exists",
    );

    await writeEvaluationTemplate({ force: true, inputPath, outPath });
    const evaluation = await validateEvaluationFile({ inputPath: outPath });

    expect(evaluation.sourceContentHash).toBe(metadata.sourceFile.contentHash);
    expect(evaluation.judgment.overall).toBe("unknown");
  });

  it("rejects invalid judgment values", async () => {
    const evaluation = createEvaluationTemplate(
      await createResolvableMetadata(),
      new Date("2026-01-02T03:04:05.000Z"),
    );

    expect(() =>
      parseAnalysisEvaluation({
        ...evaluation,
        judgment: {
          ...evaluation.judgment,
          bpm: "closeEnough",
        },
      }),
    ).toThrow("judgment.bpm must be one of");
  });

  it("does not include feature envelopes or full timing arrays", async () => {
    const metadata = await createResolvableMetadata();
    const evaluation = createEvaluationTemplate(metadata);
    const serialized = JSON.stringify(evaluation);

    expect(serialized).not.toContain("featureSummary");
    expect(serialized).not.toContain("peakEnvelope");
    expect(serialized).not.toContain("rmsEnvelope");
    expect(serialized).not.toContain('"beatsSec":');
    expect(serialized).not.toContain('"downbeatsSec":');
  });

  it("parses validate-evaluation without requiring --out", () => {
    expect(parseArgs(["validate-evaluation", "track.evaluation.json"])).toEqual({
      command: "validate-evaluation",
      inputPath: "track.evaluation.json",
      inputPaths: ["track.evaluation.json"],
      outPath: undefined,
      force: false,
      format: undefined,
      aiReviewPath: undefined,
      overridesPath: undefined,
    });
  });
});

describe("evaluation summaries", () => {
  it("counts multiple evaluation notes and correction types", async () => {
    const metadata = await createResolvableMetadata();
    const first = {
      ...createEvaluationTemplate(metadata, new Date("2026-01-02T03:04:05.000Z")),
      judgment: {
        bpm: "correct",
        beatGrid: "aligned",
        downbeat: "correct",
        transitions: "plausible",
        overall: "usable",
      },
      corrections: {
        bpm: null,
        firstBeatSec: null,
        firstDownbeatSec: null,
        mixInSec: [],
        mixOutSec: [],
      },
      notes: ["Looks usable."],
    };
    const second = {
      ...createEvaluationTemplate(metadata, new Date("2026-01-03T03:04:05.000Z")),
      sourceContentHash: "sha256:second",
      judgment: {
        bpm: "half",
        beatGrid: "shifted",
        downbeat: "wrongPhase",
        transitions: "tooEarly",
        overall: "needsManualCorrection",
      },
      corrections: {
        bpm: 120,
        firstBeatSec: 0.25,
        firstDownbeatSec: 0.5,
        mixInSec: [16],
        mixOutSec: [128],
      },
      notes: ["Beat grid starts late."],
    };

    const summary = summarizeEvaluations([
      parseAnalysisEvaluation(first),
      parseAnalysisEvaluation(second),
    ]);

    expect(summary.total).toBe(2);
    expect(summary.judgments.bpm.correct).toBe(1);
    expect(summary.judgments.bpm.half).toBe(1);
    expect(summary.judgments.beatGrid.aligned).toBe(1);
    expect(summary.judgments.beatGrid.shifted).toBe(1);
    expect(summary.judgments.downbeat.wrongPhase).toBe(1);
    expect(summary.judgments.transitions.tooEarly).toBe(1);
    expect(summary.judgments.overall.needsManualCorrection).toBe(1);
    expect(summary.correctionCounts).toEqual({
      bpm: 1,
      firstBeatSec: 1,
      firstDownbeatSec: 1,
      mixInSec: 1,
      mixOutSec: 1,
    });
    expect(summary.notes).toHaveLength(2);
  });

  it("fails clearly for empty evaluation input", () => {
    expect(() => summarizeEvaluations([])).toThrow("No evaluation notes");
  });

  it("writes JSON summaries from a directory of evaluation files", async () => {
    const metadata = await createResolvableMetadata();
    const evaluationsDir = join(tempDir, "metadata");
    const firstPath = join(evaluationsDir, "first.evaluation.json");
    const secondPath = join(evaluationsDir, "second.evaluation.json");
    const ignoredPath = join(evaluationsDir, "ignored.json");
    const outPath = join(tempDir, "summary.json");
    await mkdir(evaluationsDir, { recursive: true });
    await writeFile(
      firstPath,
      JSON.stringify(createEvaluationTemplate(metadata), null, 2),
      "utf8",
    );
    await writeFile(
      secondPath,
      JSON.stringify({
        ...createEvaluationTemplate(metadata),
        sourceContentHash: "sha256:second",
        judgment: {
          bpm: "wrong",
          beatGrid: "wrong",
          downbeat: "ambiguous",
          transitions: "wrong",
          overall: "reject",
        },
      }),
      "utf8",
    );
    await writeFile(ignoredPath, "{}", "utf8");

    await writeEvaluationSummary({
      inputPaths: [evaluationsDir],
      outPath,
    });

    const summary = JSON.parse(await readFile(outPath, "utf8")) as {
      total: number;
      judgments: { overall: { reject: number; unknown: number } };
    };
    expect(summary.total).toBe(2);
    expect(summary.judgments.overall.reject).toBe(1);
    expect(summary.judgments.overall.unknown).toBe(1);
  });

  it("writes Markdown summaries for multiple files", async () => {
    const metadata = await createResolvableMetadata();
    const firstPath = join(tempDir, "first.evaluation.json");
    const secondPath = join(tempDir, "second.evaluation.json");
    const outPath = join(tempDir, "summary.md");
    await writeFile(firstPath, JSON.stringify(createEvaluationTemplate(metadata)), "utf8");
    await writeFile(
      secondPath,
      JSON.stringify({
        ...createEvaluationTemplate(metadata),
        sourceContentHash: "sha256:second",
        notes: ["Needs downbeat review."],
      }),
      "utf8",
    );

    await writeEvaluationSummary({
      format: "markdown",
      inputPaths: [firstPath, secondPath],
      outPath,
    });

    const markdown = await readFile(outPath, "utf8");
    expect(markdown).toContain("# Luumix Evaluation Summary");
    expect(markdown).toContain("Total evaluations: 2");
    expect(markdown).toContain("Needs downbeat review.");
  });

  it("refuses existing summary output without force", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.evaluation.json");
    const outPath = join(tempDir, "summary.json");
    await writeFile(inputPath, JSON.stringify(createEvaluationTemplate(metadata)), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await expect(
      writeEvaluationSummary({ inputPaths: [inputPath], outPath }),
    ).rejects.toThrow("Output already exists");
  });

  it("fails clearly for invalid evaluation files", async () => {
    const inputPath = join(tempDir, "invalid.evaluation.json");
    const outPath = join(tempDir, "summary.json");
    await writeFile(inputPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    await expect(
      writeEvaluationSummary({ inputPaths: [inputPath], outPath }),
    ).rejects.toThrow("sourceContentHash");
  });

  it("does not include analysis feature arrays or full timing arrays", async () => {
    const metadata = await createResolvableMetadata();
    const summary = summarizeEvaluations([createEvaluationTemplate(metadata)]);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain("featureSummary");
    expect(serialized).not.toContain("peakEnvelope");
    expect(serialized).not.toContain("rmsEnvelope");
    expect(serialized).not.toContain('"beatsSec":');
    expect(serialized).not.toContain('"downbeatsSec":');
  });

  it("parses summarize-evaluations with multiple input paths", () => {
    expect(
      parseArgs([
        "summarize-evaluations",
        "one.evaluation.json",
        "two.evaluation.json",
        "--out",
        "summary.json",
        "--format",
        "markdown",
      ]),
    ).toEqual({
      command: "summarize-evaluations",
      inputPath: "one.evaluation.json",
      inputPaths: ["one.evaluation.json", "two.evaluation.json"],
      outPath: "summary.json",
      force: false,
      format: "markdown",
      aiReviewPath: undefined,
      overridesPath: undefined,
    });
  });
});

describe("applyAiReview", () => {
  it("applies a valid AI review and populates effective metadata", async () => {
    const metadata = await createResolvableMetadata();
    const aiReview = createAiReview(metadata, { status: "risky" });

    const reviewed = applyAiReview(metadata, aiReview);

    expect(reviewed.aiReview).toEqual(aiReview);
    expect(reviewed.effective?.bpmSource).toBe("aiReview");
    expect(reviewed.effective?.beatGrid.source).toBe("aiReview");
    expect(reviewed.effective?.downbeat.source).toBe("aiReview");
    expect(reviewed.effective?.autoMix.status).toBe("risky");
    expect(reviewed.effective?.mixInSec.length).toBeGreaterThan(0);
    expect(reviewed.effective?.mixOutSec.length).toBeGreaterThan(0);
    expect(reviewed.analysis).toEqual(metadata.analysis);
  });

  it("fails clearly when AI review references an unknown candidate ID", async () => {
    const metadata = await createResolvableMetadata();
    const aiReview = createAiReview(metadata, {
      selectedTempoCandidateId: "tempo-missing",
    });

    expect(() => applyAiReview(metadata, aiReview)).toThrow(
      "Invalid selectedTempoCandidateId",
    );
  });

  it("keeps manual overrides ahead of AI review in effective metadata", async () => {
    const metadata = await createResolvableMetadata();
    metadata.manualOverrides = {
      ...metadata.manualOverrides,
      bpm: 124,
      firstDownbeatSec: 1.25,
      mixInSec: [9.5],
      mixOutSec: [120.5],
    };
    const aiReview = createAiReview(metadata, {
      selectedTempoCandidateId: "tempo-double",
      status: "approved",
    });

    const reviewed = applyAiReview(metadata, aiReview);

    expect(reviewed.effective?.bpm).toBe(124);
    expect(reviewed.effective?.bpmSource).toBe("manual");
    expect(reviewed.effective?.downbeat.firstDownbeatSec).toBe(1.25);
    expect(reviewed.effective?.downbeat.source).toBe("manual");
    expect(reviewed.effective?.mixInSec).toEqual([9.5]);
    expect(reviewed.effective?.mixOutSec).toEqual([120.5]);
  });

  it("uses AI review autoMix unless manual override disables auto-mix", async () => {
    const metadata = await createResolvableMetadata();
    const rejected = applyAiReview(metadata, createAiReview(metadata, {
      status: "rejected",
    }));

    expect(rejected.effective?.autoMix.status).toBe("rejected");
    expect(rejected.effective?.mixInSec).toEqual([]);
    expect(rejected.effective?.mixOutSec).toEqual([]);

    metadata.manualOverrides.autoMixDisabled = true;
    const disabled = applyAiReview(metadata, createAiReview(metadata, {
      status: "approved",
    }));

    expect(disabled.effective?.autoMix.status).toBe("rejected");
    expect(disabled.effective?.autoMix.reasons).toEqual([
      "Manual override disabled automatic mixing.",
    ]);
  });
});

describe("writeAiReviewedMetadata", () => {
  it("writes validated metadata with aiReview and effective populated", async () => {
    const metadata = await createResolvableMetadata();
    const aiReview = createAiReview(metadata, { status: "approved" });
    const inputPath = join(tempDir, "track.analysis.json");
    const aiReviewPath = join(tempDir, "track.ai-review.json");
    const outPath = join(tempDir, "metadata", "track.ai-reviewed.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(aiReviewPath, JSON.stringify(aiReview), "utf8");

    await writeAiReviewedMetadata({ aiReviewPath, inputPath, outPath });

    const reviewed = await readMetadata(outPath);
    expect(reviewed.aiReview).toEqual(aiReview);
    expect(reviewed.effective?.autoMix.status).toBe("approved");
    expect(reviewed.analysis).toEqual(metadata.analysis);
  });

  it("refuses existing output without force", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const aiReviewPath = join(tempDir, "track.ai-review.json");
    const outPath = join(tempDir, "track.ai-reviewed.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(aiReviewPath, JSON.stringify(createAiReview(metadata)), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await expect(
      writeAiReviewedMetadata({ aiReviewPath, inputPath, outPath }),
    ).rejects.toThrow("Output already exists");
  });

  it("overwrites existing output when force is enabled", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const aiReviewPath = join(tempDir, "track.ai-review.json");
    const outPath = join(tempDir, "track.ai-reviewed.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(aiReviewPath, JSON.stringify(createAiReview(metadata)), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await writeAiReviewedMetadata({ aiReviewPath, force: true, inputPath, outPath });

    const reviewed = await readMetadata(outPath);
    expect(reviewed.aiReview).not.toBeNull();
    expect(reviewed.effective).not.toBeNull();
  });

  it("fails clearly for invalid AI review JSON", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const aiReviewPath = join(tempDir, "track.ai-review.json");
    const outPath = join(tempDir, "track.ai-reviewed.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(aiReviewPath, JSON.stringify({ autoMix: { status: "approved" } }), "utf8");

    await expect(
      writeAiReviewedMetadata({ aiReviewPath, inputPath, outPath }),
    ).rejects.toThrow("Invalid AI review file");
    await expect(stat(outPath)).rejects.toThrow();
  });

  it("fails clearly when the CLI command is missing --ai-review", () => {
    expect(() =>
      parseArgs([
        "apply-ai-review",
        "track.analysis.json",
        "--out",
        "track.ai-reviewed.json",
      ]),
    ).toThrow("Missing required --ai-review");
  });
});

describe("writeResolvedMetadata", () => {
  it("resolves effective metadata from analysis defaults without overrides", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");

    await writeResolvedMetadata({ inputPath, outPath });

    const resolved = await readMetadata(outPath);
    expect(resolved.effective?.bpm).toBeCloseTo(120, 3);
    expect(resolved.effective?.bpmSource).toBe("analysis");
    expect(resolved.effective?.beatGrid.source).toBe("analysis");
    expect(resolved.effective?.downbeat.source).toBe("analysis");
    expect(resolved.analysis).toEqual(metadata.analysis);
  });

  it("applies manual override BPM over aiReview and analysis", async () => {
    const metadata = await createResolvableMetadata();
    metadata.aiReview = {
      selectedTempoCandidateId: "tempo-double",
      autoMix: { status: "approved", reasons: ["synthetic test"] },
    };
    const inputPath = join(tempDir, "track.analysis.json");
    const overridesPath = join(tempDir, "track.overrides.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(overridesPath, JSON.stringify({ bpm: 124 }), "utf8");

    await writeResolvedMetadata({ inputPath, overridesPath, outPath });

    const resolved = await readMetadata(outPath);
    expect(resolved.effective?.bpm).toBe(124);
    expect(resolved.effective?.bpmSource).toBe("manual");
    expect(resolved.manualOverrides.bpm).toBe(124);
  });

  it("applies manual first downbeat and mix points over defaults", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const overridesPath = join(tempDir, "track.overrides.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(
      overridesPath,
      JSON.stringify({
        firstDownbeatSec: 1.25,
        mixInSec: [9.5],
        mixOutSec: [120.5],
      }),
      "utf8",
    );

    await writeResolvedMetadata({ inputPath, overridesPath, outPath });

    const resolved = await readMetadata(outPath);
    expect(resolved.effective?.downbeat.firstDownbeatSec).toBe(1.25);
    expect(resolved.effective?.downbeat.source).toBe("manual");
    expect(resolved.effective?.mixInSec).toEqual([9.5]);
    expect(resolved.effective?.mixOutSec).toEqual([120.5]);
  });

  it("resolves autoMixDisabled to a rejected safe effective state", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const overridesPath = join(tempDir, "track.overrides.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(
      overridesPath,
      JSON.stringify({
        autoMixDisabled: true,
        mixInSec: [9.5],
        mixOutSec: [120.5],
      }),
      "utf8",
    );

    await writeResolvedMetadata({ inputPath, overridesPath, outPath });

    const resolved = await readMetadata(outPath);
    expect(resolved.effective?.autoMix.status).toBe("rejected");
    expect(resolved.effective?.mixInSec).toEqual([]);
    expect(resolved.effective?.mixOutSec).toEqual([]);
  });

  it("refuses existing output without force", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(outPath, "existing", "utf8");

    await expect(writeResolvedMetadata({ inputPath, outPath })).rejects.toThrow(
      "Output already exists",
    );
  });

  it("fails clearly for invalid overrides", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const overridesPath = join(tempDir, "track.overrides.json");
    const outPath = join(tempDir, "track.effective.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");
    await writeFile(overridesPath, JSON.stringify({ bpm: -1 }), "utf8");

    await expect(
      writeResolvedMetadata({ inputPath, overridesPath, outPath }),
    ).rejects.toThrow("Invalid manual overrides file");
  });
});

describe("writeOverrideTemplate", () => {
  it("writes a manual override template from analysis defaults", async () => {
    const metadata = await createResolvableMetadata();
    const inputPath = join(tempDir, "track.analysis.json");
    const outPath = join(tempDir, "track.overrides.json");
    await writeFile(inputPath, JSON.stringify(metadata), "utf8");

    await writeOverrideTemplate({ inputPath, outPath });

    const template = JSON.parse(await readFile(outPath, "utf8")) as {
      bpm?: number;
      firstBeatSec?: number;
      firstDownbeatSec?: number;
      mixInSec?: number[];
      mixOutSec?: number[];
    };
    expect(template.bpm).toBeCloseTo(120, 3);
    expect(template.firstBeatSec).toBeDefined();
    expect(template.firstDownbeatSec).toBeDefined();
    expect(template.mixInSec?.length).toBeGreaterThan(0);
    expect(template.mixOutSec?.length).toBeGreaterThan(0);
  });
});

describe("computeFeatureSummary", () => {
  it("computes peak and RMS envelopes for fixed frames", () => {
    const summary = computeFeatureSummary([0, 1, -1, 0, 0.5, -0.5], {
      frameHopSec: 0.003,
      sampleRate: 1000,
    });

    expect(summary.frameHopSec).toBe(0.003);
    expect(summary.peakEnvelope).toEqual([1, 0.5]);
    expect(summary.rmsEnvelope).toEqual([0.816497, 0.408248]);
  });

  it("detects silence ranges from synthetic RMS data", () => {
    const summary = computeFeatureSummary(
      [
        0, 0, 0, 0,
        0.25, 0.25,
        0, 0, 0, 0,
      ],
      {
        frameHopSec: 0.1,
        minSilenceSec: 0.2,
        sampleRate: 10,
        silenceThreshold: 0.005,
      },
    );

    expect(summary.silenceRangesSec).toEqual([
      { startSec: 0, endSec: 0.4 },
      { startSec: 0.6, endSec: 1 },
    ]);
  });

  it("compacts long envelopes to the configured frame limit", () => {
    const summary = computeFeatureSummary(new Array(10).fill(0.25), {
      frameHopSec: 0.1,
      maxFrames: 3,
      sampleRate: 10,
    });

    expect(summary.frameHopSec).toBe(0.4);
    expect(summary.peakEnvelope).toHaveLength(3);
    expect(summary.rmsEnvelope).toHaveLength(3);
  });
});

async function createTestMetadata(summary = featureSummary, probe = probeResult) {
  const inputPath = join(tempDir, "track.wav");
  const outPath = join(tempDir, `${randomUUID()}.analysis.json`);
  await writeFile(inputPath, "placeholder audio bytes", "utf8");
  return analyzeFile({
    extractFeatures: async () => summary,
    inputPath,
    outPath,
    probeAudio: async () => probe,
  });
}

async function createResolvableMetadata() {
  const metadata = await createTestMetadata(createPulseFeatureSummary(120, 180), {
    ...probeResult,
    durationSec: 180,
  });

  metadata.analysis.defaults.autoMix = {
    status: "approved",
    reasons: ["Approved in synthetic resolver test."],
  };

  return metadata;
}

function createAiReview(
  metadata: Awaited<ReturnType<typeof createResolvableMetadata>>,
  overrides: Partial<AiReview> & { status?: AiReview["autoMix"]["status"] } = {},
): AiReview {
  const {
    autoMix,
    status = "approved",
    ...selectionOverrides
  } = overrides;

  return {
    selectedTempoCandidateId: metadata.analysis.defaults.tempoCandidateId,
    selectedBeatGridCandidateId: metadata.analysis.defaults.beatGridCandidateId,
    selectedDownbeatCandidateId: metadata.analysis.defaults.downbeatCandidateId,
    selectedMixInTransitionId: metadata.analysis.defaults.mixInTransitionId,
    selectedMixOutTransitionId: metadata.analysis.defaults.mixOutTransitionId,
    autoMix: autoMix ?? {
      status,
      reasons: [`Synthetic AI review marked the track ${status}.`],
    },
    notes: ["Synthetic AI review fixture for tests."],
    ...selectionOverrides,
  };
}

function createPulseFeatureSummary(bpm: number, durationSec = 8) {
  const frameHopSec = 0.1;
  const beatFrames = Math.round(60 / (bpm * frameHopSec));
  const rmsEnvelope = new Array(Math.ceil(durationSec / frameHopSec)).fill(0.05);

  for (let index = 0; index < rmsEnvelope.length; index += beatFrames) {
    rmsEnvelope[index] = 1;
  }

  return {
    frameHopSec,
    peakEnvelope: [...rmsEnvelope],
    rmsEnvelope,
    silenceRangesSec: [],
  };
}

function createBeatGridCandidate(durationSec = 8) {
  return {
    id: "beat-grid-primary",
    tempoCandidateId: "tempo-primary",
    firstBeatSec: 0.5,
    confidence: 0.55,
    stability: 0.55,
    beatsSec: Array.from(
      { length: Math.floor((durationSec - 0.5) / 0.5) + 1 },
      (_value, index) => 0.5 + index * 0.5,
    ),
  };
}

function createDownbeatCandidate(durationSec = 8) {
  const beatsSec = createBeatGridCandidate(durationSec).beatsSec;
  return {
    id: "downbeat-phase-0",
    beatGridId: "beat-grid-primary",
    phaseBeatIndex: 0,
    confidence: 0.42,
    downbeatsSec: beatsSec.filter((_beatSec, index) => index % 4 === 0),
    supportingSignals: ["Synthetic test downbeat phase."],
  };
}

describe("createFfmpegFeatureExtractor", () => {
  it("reports missing ffmpeg with an actionable error", async () => {
    const extractor = createFfmpegFeatureExtractor(createErroringSpawn("ENOENT"));

    await expect(extractor("track.wav")).rejects.toThrow(
      "ffmpeg is required for low-level feature extraction",
    );
  });

  it("decodes f32le PCM from ffmpeg stdout and computes features", async () => {
    const buffer = Buffer.alloc(4 * Float32Array.BYTES_PER_ELEMENT);
    buffer.writeFloatLE(0, 0);
    buffer.writeFloatLE(1, 4);
    buffer.writeFloatLE(-1, 8);
    buffer.writeFloatLE(0, 12);
    const extractor = createFfmpegFeatureExtractor(createSuccessfulSpawn(buffer), {
      frameHopSec: 0.002,
      sampleRate: 1000,
    });

    const summary = await extractor("track.wav");

    expect(summary.peakEnvelope).toEqual([1, 1]);
    expect(summary.rmsEnvelope).toEqual([0.707107, 0.707107]);
  });
});

function createErroringSpawn(code: string): SpawnLike {
  return () => {
    const child = createMockChildProcess();
    queueMicrotask(() => {
      child.emit("error", Object.assign(new Error(`spawn ffmpeg ${code}`), { code }));
    });
    return child as ReturnType<SpawnLike>;
  };
}

function createSuccessfulSpawn(stdout: Buffer): SpawnLike {
  return () => {
    const child = createMockChildProcess();
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.emit("close", 0);
    });
    return child as ReturnType<SpawnLike>;
  };
}

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    stdout: PassThrough;
  };
  child.stderr = new PassThrough();
  child.stdout = new PassThrough();
  return child;
}

describe("parseFfprobeOutput", () => {
  it("parses the first audio stream and format container", () => {
    const parsed = parseFfprobeOutput(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "mjpeg",
          },
          {
            codec_type: "audio",
            codec_name: "flac",
            sample_rate: "44100",
            channels: 2,
          },
        ],
        format: {
          duration: "123.456",
          format_name: "flac",
        },
      }),
    );

    expect(parsed).toEqual({
      durationSec: 123.456,
      sampleRate: 44100,
      channels: 2,
      codec: "flac",
      container: "flac",
    });
  });

  it("fails when ffprobe output has no audio stream", () => {
    expect(() =>
      parseFfprobeOutput(
        JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "mjpeg" }],
          format: { duration: "1.0", format_name: "image2" },
        }),
      ),
    ).toThrow("did not find an audio stream");
  });

  it("fails on malformed ffprobe JSON", () => {
    expect(() => parseFfprobeOutput("{not json")).toThrow("malformed JSON");
  });
});

describe("createFfprobeAudioProbe", () => {
  it("reports missing ffprobe with an actionable error", async () => {
    const probe = createFfprobeAudioProbe(async () => {
      throw Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    });

    await expect(probe("track.wav")).rejects.toThrow(
      "ffprobe is required for real audio probing",
    );
  });
});
