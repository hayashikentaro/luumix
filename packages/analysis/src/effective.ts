import {
  ManualOverridesSchema,
  parseTrackAnalysisMetadata,
  resolveEffectiveMetadata,
  type ManualOverrides,
  type TrackAnalysisMetadata,
} from "@luumix/metadata";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ResolveEffectiveOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
  overridesPath?: string;
}

export interface InitOverridesOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
}

export async function writeResolvedMetadata(
  options: ResolveEffectiveOptions,
): Promise<TrackAnalysisMetadata> {
  await assertInputFile(options.inputPath, "Input metadata file");
  await assertOutputWritable(options.outPath, options.force);

  const metadata = parseTrackAnalysisMetadata(
    await readJsonFile(options.inputPath, "analysis metadata"),
  );
  const manualOverrides = options.overridesPath
    ? await readManualOverrides(options.overridesPath)
    : metadata.manualOverrides;
  const resolvedInput: TrackAnalysisMetadata = {
    ...metadata,
    manualOverrides: {
      ...metadata.manualOverrides,
      ...manualOverrides,
    },
  };
  const resolved: TrackAnalysisMetadata = parseTrackAnalysisMetadata({
    ...resolvedInput,
    effective: resolveEffectiveMetadata(resolvedInput),
  });

  await writeJsonFile(options.outPath, resolved);
  return resolved;
}

export async function writeOverrideTemplate(
  options: InitOverridesOptions,
): Promise<ManualOverrides> {
  await assertInputFile(options.inputPath, "Input metadata file");
  await assertOutputWritable(options.outPath, options.force);

  const metadata = parseTrackAnalysisMetadata(
    await readJsonFile(options.inputPath, "analysis metadata"),
  );
  const template = ManualOverridesSchema.parse(createOverrideTemplate(metadata));

  await writeJsonFile(options.outPath, template);
  return template;
}

function createOverrideTemplate(metadata: TrackAnalysisMetadata): ManualOverrides {
  const tempo = findById(
    metadata.analysis.tempoCandidates,
    metadata.analysis.defaults.tempoCandidateId,
  );
  const beatGrid = findById(
    metadata.analysis.beatGridCandidates,
    metadata.analysis.defaults.beatGridCandidateId,
  );
  const downbeat = findById(
    metadata.analysis.downbeatCandidates,
    metadata.analysis.defaults.downbeatCandidateId,
  );
  const mixIn = findById(
    metadata.analysis.transitionCandidates.mixIn,
    metadata.analysis.defaults.mixInTransitionId,
  );
  const mixOut = findById(
    metadata.analysis.transitionCandidates.mixOut,
    metadata.analysis.defaults.mixOutTransitionId,
  );

  return {
    bpm: tempo?.bpm ?? null,
    beatGrid: null,
    firstBeatSec: beatGrid?.firstBeatSec ?? null,
    firstDownbeatSec: downbeat?.downbeatsSec[0] ?? null,
    mixInSec: mixIn ? [mixIn.timeSec] : [],
    mixOutSec: mixOut ? [mixOut.timeSec] : [],
    autoMixDisabled: false,
    notes: [
      "Template generated from analysis defaults. Edit these values after inspecting the report.",
    ],
  };
}

async function readManualOverrides(path: string): Promise<ManualOverrides> {
  await assertInputFile(path, "Manual overrides file");

  try {
    return ManualOverridesSchema.parse(await readJsonFile(path, "manual overrides"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid manual overrides file: ${message}`, { cause: error });
  }
}

async function assertInputFile(path: string, label: string): Promise<void> {
  const inputStat = await stat(path).catch((error: unknown) => {
    throw new Error(`${label} not found: ${path}`, { cause: error });
  });

  if (!inputStat.isFile()) {
    throw new Error(`${label} path must be a file: ${path}`);
  }
}

async function assertOutputWritable(path: string, force = false): Promise<void> {
  const outputExists = await stat(path)
    .then(() => true)
    .catch(() => false);

  if (outputExists && !force) {
    throw new Error(`Output already exists, use --force to overwrite: ${path}`);
  }
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} JSON: ${message}`, { cause: error });
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function findById<T extends { id: string }>(
  candidates: T[],
  id: string | undefined,
): T | undefined {
  if (!id) {
    return undefined;
  }

  return candidates.find((candidate) => candidate.id === id);
}
