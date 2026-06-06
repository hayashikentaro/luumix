import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTrackAnalysisMetadata } from "@luumix/metadata";
import { analyzeFile } from "../src/index.js";
import {
  createFfprobeAudioProbe,
  parseFfprobeOutput,
  type AudioProbeResult,
} from "../src/probe.js";

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
    expect(metadata.analysis.tempoCandidates).toEqual([]);
    expect(metadata.analysis.beatGridCandidates).toEqual([]);
    expect(metadata.analysis.downbeatCandidates).toEqual([]);
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
    expect(metadata.analysis.riskSignals.lowConfidence).toBe(true);
    expect(metadata.aiReview).toBeNull();
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
        probeAudio: async () => {
          throw new Error("probe failed");
        },
      }),
    ).rejects.toThrow("probe failed");

    await expect(stat(outPath)).rejects.toThrow();
  });

  it("changes contentHash when file content changes", async () => {
    const inputPath = join(tempDir, "track.wav");
    const firstOutPath = join(tempDir, "first.analysis.json");
    const secondOutPath = join(tempDir, "second.analysis.json");

    await writeFile(inputPath, "first", "utf8");
    await analyzeFile({
      inputPath,
      outPath: firstOutPath,
      probeAudio: async () => probeResult,
    });

    await writeFile(inputPath, "second", "utf8");
    await analyzeFile({
      inputPath,
      outPath: secondOutPath,
      probeAudio: async () => probeResult,
    });

    const first = await readMetadata(firstOutPath);
    const second = await readMetadata(secondOutPath);

    expect(first.sourceFile.contentHash).not.toBe(second.sourceFile.contentHash);
  });
});

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
