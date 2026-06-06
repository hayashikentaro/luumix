import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTrackAnalysisMetadata } from "@luumix/metadata";
import {
  computeFeatureSummary,
  createFfmpegFeatureExtractor,
  type SpawnLike,
} from "../src/features.js";
import { analyzeFile } from "../src/index.js";
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
    expect(metadata.analysis.downbeatCandidates).toEqual([]);
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
    expect(metadata.analysis.riskSignals.doubleTempoAmbiguous).toBe(true);
    expect(metadata.effective).toBeNull();
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
    expect(html).toContain('data-overlay-layer="future-downbeat-ticks"');
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

async function createTestMetadata(summary = featureSummary) {
  const inputPath = join(tempDir, "track.wav");
  const outPath = join(tempDir, `${randomUUID()}.analysis.json`);
  await writeFile(inputPath, "placeholder audio bytes", "utf8");
  return analyzeFile({
    extractFeatures: async () => summary,
    inputPath,
    outPath,
    probeAudio: async () => probeResult,
  });
}

function createPulseFeatureSummary(bpm: number) {
  const frameHopSec = 0.1;
  const beatFrames = Math.round(60 / (bpm * frameHopSec));
  const rmsEnvelope = new Array(80).fill(0.05);

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
