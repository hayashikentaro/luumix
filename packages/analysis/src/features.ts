import type { FeatureSummary } from "@luumix/metadata";
import { spawn } from "node:child_process";

export interface FeatureExtractionOptions {
  frameHopSec?: number;
  maxFrames?: number;
  minSilenceSec?: number;
  sampleRate?: number;
  silenceThreshold?: number;
}

export type FeatureExtractor = (inputPath: string) => Promise<FeatureSummary>;

export interface SpawnedProcess {
  stderr: NodeJS.ReadableStream;
  stdout: NodeJS.ReadableStream;
  on(event: "close", listener: (code: number | null) => void): this;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
}

export type SpawnLike = (
  command: string,
  args: string[],
) => SpawnedProcess;

const DEFAULT_SAMPLE_RATE = 22050;
const DEFAULT_FRAME_HOP_SEC = 0.1;
const DEFAULT_MAX_FRAMES = 6000;
const DEFAULT_MIN_SILENCE_SEC = 0.5;
const DEFAULT_SILENCE_THRESHOLD = 0.005;

export const extractFeatureSummary: FeatureExtractor = createFfmpegFeatureExtractor();

export function createFfmpegFeatureExtractor(
  spawnImpl: SpawnLike = spawn,
  options: FeatureExtractionOptions = {},
): FeatureExtractor {
  return async (inputPath) => {
    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const pcm = await decodeMonoF32Pcm(inputPath, sampleRate, spawnImpl);

    return computeFeatureSummary(pcm, {
      ...options,
      sampleRate,
    });
  };
}

export function computeFeatureSummary(
  samples: ArrayLike<number>,
  options: FeatureExtractionOptions & { sampleRate: number },
): FeatureSummary {
  const frameHopSec = options.frameHopSec ?? DEFAULT_FRAME_HOP_SEC;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const minSilenceSec = options.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC;
  const silenceThreshold = options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
  const frameSize = Math.max(1, Math.round(options.sampleRate * frameHopSec));
  const frameCount = Math.ceil(samples.length / frameSize);
  const peakEnvelope: number[] = [];
  const rmsEnvelope: number[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    let peak = 0;
    let sumSquares = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = samples[sampleIndex] ?? 0;
      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      sumSquares += sample * sample;
    }

    const frameLength = Math.max(1, end - start);
    peakEnvelope.push(roundFeatureValue(peak));
    rmsEnvelope.push(roundFeatureValue(Math.sqrt(sumSquares / frameLength)));
  }

  const compacted = compactEnvelopes({
    frameHopSec,
    maxFrames,
    peakEnvelope,
    rmsEnvelope,
  });

  return {
    frameHopSec: compacted.frameHopSec,
    peakEnvelope: compacted.peakEnvelope,
    rmsEnvelope: compacted.rmsEnvelope,
    silenceRangesSec: detectSilenceRanges({
      frameHopSec: compacted.frameHopSec,
      minSilenceSec,
      rmsEnvelope: compacted.rmsEnvelope,
      silenceThreshold,
    }),
  };
}

function compactEnvelopes(input: {
  frameHopSec: number;
  maxFrames: number;
  peakEnvelope: number[];
  rmsEnvelope: number[];
}): {
  frameHopSec: number;
  peakEnvelope: number[];
  rmsEnvelope: number[];
} {
  if (input.peakEnvelope.length <= input.maxFrames) {
    return input;
  }

  const bucketSize = Math.ceil(input.peakEnvelope.length / input.maxFrames);
  const peakEnvelope: number[] = [];
  const rmsEnvelope: number[] = [];

  for (let start = 0; start < input.peakEnvelope.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, input.peakEnvelope.length);
    let peak = 0;
    let rmsSum = 0;

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, input.peakEnvelope[index] ?? 0);
      rmsSum += input.rmsEnvelope[index] ?? 0;
    }

    peakEnvelope.push(roundFeatureValue(peak));
    rmsEnvelope.push(roundFeatureValue(rmsSum / (end - start)));
  }

  return {
    frameHopSec: roundFeatureValue(input.frameHopSec * bucketSize),
    peakEnvelope,
    rmsEnvelope,
  };
}

function detectSilenceRanges(input: {
  frameHopSec: number;
  minSilenceSec: number;
  rmsEnvelope: number[];
  silenceThreshold: number;
}): Array<{ startSec: number; endSec: number }> {
  const ranges: Array<{ startSec: number; endSec: number }> = [];
  let rangeStartFrame: number | null = null;

  for (let index = 0; index <= input.rmsEnvelope.length; index += 1) {
    const isSilent =
      index < input.rmsEnvelope.length &&
      (input.rmsEnvelope[index] ?? 0) < input.silenceThreshold;

    if (isSilent && rangeStartFrame === null) {
      rangeStartFrame = index;
    }

    if ((!isSilent || index === input.rmsEnvelope.length) && rangeStartFrame !== null) {
      const startSec = rangeStartFrame * input.frameHopSec;
      const endSec = index * input.frameHopSec;
      if (endSec - startSec >= input.minSilenceSec) {
        ranges.push({
          startSec: roundFeatureValue(startSec),
          endSec: roundFeatureValue(endSec),
        });
      }
      rangeStartFrame = null;
    }
  }

  return ranges;
}

function decodeMonoF32Pcm(
  inputPath: string,
  sampleRate: number,
  spawnImpl: SpawnLike,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawnImpl("ffmpeg", [
      "-v",
      "error",
      "-i",
      inputPath,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "pipe:1",
    ]);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpeg.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "ffmpeg is required for low-level feature extraction. Install ffmpeg and try again.",
            { cause: error },
          ),
        );
        return;
      }

      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(
          new Error(
            `ffmpeg failed during low-level feature extraction${stderr ? `: ${stderr}` : "."}`,
          ),
        );
        return;
      }

      resolve(bufferToFloat32Array(Buffer.concat(stdoutChunks)));
    });
  });
}

function bufferToFloat32Array(buffer: Buffer): Float32Array {
  const sampleCount = Math.floor(buffer.length / Float32Array.BYTES_PER_ELEMENT);
  const samples = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }

  return samples;
}

function roundFeatureValue(value: number): number {
  return Number(value.toFixed(6));
}
