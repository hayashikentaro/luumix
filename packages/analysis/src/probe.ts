import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioProbeResult {
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  container?: string;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export type ExecFileLike = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export type AudioProbe = (inputPath: string) => Promise<AudioProbeResult>;

export const probeAudioFile: AudioProbe = createFfprobeAudioProbe();

export function createFfprobeAudioProbe(execFileImpl: ExecFileLike = execFileAsync) {
  return async (inputPath: string): Promise<AudioProbeResult> => {
    let stdout: string;

    try {
      const result = await execFileImpl("ffprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        inputPath,
      ]);
      stdout = result.stdout;
    } catch (error) {
      if (isMissingExecutableError(error)) {
        throw new Error(
          "ffprobe is required for real audio probing. Install ffmpeg/ffprobe and try again.",
          { cause: error },
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ffprobe failed while probing audio: ${message}`, {
        cause: error,
      });
    }

    return parseFfprobeOutput(stdout);
  };
}

export function parseFfprobeOutput(stdout: string): AudioProbeResult {
  let output: FfprobeOutput;

  try {
    output = JSON.parse(stdout) as FfprobeOutput;
  } catch (error) {
    throw new Error("ffprobe returned malformed JSON output.", { cause: error });
  }

  const audioStream = output.streams?.find(
    (stream) => stream.codec_type === "audio",
  );

  if (!audioStream) {
    throw new Error("ffprobe did not find an audio stream in the input file.");
  }

  const durationSec = parsePositiveNumber(
    audioStream.duration ?? output.format?.duration,
    "duration",
  );

  return {
    durationSec,
    sampleRate: parseOptionalPositiveInteger(audioStream.sample_rate),
    channels: audioStream.channels,
    codec: audioStream.codec_name,
    container: output.format?.format_name,
  };
}

function parsePositiveNumber(value: string | undefined, label: string): number {
  if (!value) {
    throw new Error(`ffprobe output is missing audio ${label}.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ffprobe output has invalid audio ${label}: ${value}`);
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
