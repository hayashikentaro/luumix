import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTrackAnalysisMetadata } from "@luumix/metadata";
import { analyzeFile } from "../src/index.js";

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

    await analyzeFile({ force: true, inputPath, outPath });

    const outputStat = await stat(outPath);
    const metadata = await readMetadata(outPath);

    expect(outputStat.size).toBeGreaterThan("existing".length);
    expect(metadata.sourceFile.path).toBe(inputPath);
  });

  it("writes schema-valid rejected placeholder metadata", async () => {
    const inputPath = join(tempDir, "track.wav");
    const outPath = join(tempDir, "nested", "track.analysis.json");
    await writeFile(inputPath, "placeholder audio bytes", "utf8");

    await analyzeFile({ inputPath, outPath });

    const metadata = await readMetadata(outPath);

    expect(metadata.sourceFile.fileSizeBytes).toBe(23);
    expect(metadata.sourceFile.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(metadata.sourceFile.durationSec).toBe(0);
    expect(metadata.analysis.tempoCandidates).toEqual([]);
    expect(metadata.analysis.beatGridCandidates).toEqual([]);
    expect(metadata.analysis.downbeatCandidates).toEqual([]);
    expect(metadata.analysis.defaults.autoMix?.status).toBe("rejected");
    expect(metadata.analysis.riskSignals.lowConfidence).toBe(true);
    expect(metadata.aiReview).toBeNull();
    expect(metadata.effective).toBeNull();
  });

  it("changes contentHash when file content changes", async () => {
    const inputPath = join(tempDir, "track.wav");
    const firstOutPath = join(tempDir, "first.analysis.json");
    const secondOutPath = join(tempDir, "second.analysis.json");

    await writeFile(inputPath, "first", "utf8");
    await analyzeFile({ inputPath, outPath: firstOutPath });

    await writeFile(inputPath, "second", "utf8");
    await analyzeFile({ inputPath, outPath: secondOutPath });

    const first = await readMetadata(firstOutPath);
    const second = await readMetadata(secondOutPath);

    expect(first.sourceFile.contentHash).not.toBe(second.sourceFile.contentHash);
  });
});
