import {
  parseTrackAnalysisMetadata,
  type BeatGridCandidate,
  type DownbeatCandidate,
  type TempoCandidate,
  type TrackAnalysisMetadata,
  type TransitionCandidate,
} from "@luumix/metadata";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ReportOptions {
  inputPath: string;
  outPath: string;
  force?: boolean;
}

export async function writeAnalysisReport(options: ReportOptions): Promise<void> {
  const inputStat = await stat(options.inputPath).catch((error: unknown) => {
    throw new Error(`Input metadata file not found: ${options.inputPath}`, {
      cause: error,
    });
  });

  if (!inputStat.isFile()) {
    throw new Error(`Input metadata path must be a file: ${options.inputPath}`);
  }

  const outputExists = await stat(options.outPath)
    .then(() => true)
    .catch(() => false);

  if (outputExists && !options.force) {
    throw new Error(`Output already exists, use --force to overwrite: ${options.outPath}`);
  }

  const metadata = parseTrackAnalysisMetadata(
    JSON.parse(await readFile(options.inputPath, "utf8")),
  );
  const html = generateAnalysisReportHtml(metadata);

  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, html, "utf8");
}

export function generateAnalysisReportHtml(metadata: TrackAnalysisMetadata): string {
  const title = `Luumix Analysis - ${metadata.sourceFile.path}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --border: #d7dce2;
      --ink: #16202a;
      --muted: #5f6b77;
      --panel: #f7f9fb;
      --beat: #1a7f37;
      --rms: #1f6feb;
      --peak: #d1242f;
    }
    body {
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      margin: 0;
      padding: 32px;
    }
    main {
      margin: 0 auto;
      max-width: 1120px;
    }
    h1, h2, h3 {
      line-height: 1.2;
      margin: 0 0 12px;
    }
    h1 {
      font-size: 28px;
    }
    h2 {
      border-bottom: 1px solid var(--border);
      font-size: 20px;
      padding-bottom: 8px;
    }
    section {
      margin-top: 28px;
    }
    dl {
      display: grid;
      gap: 8px 16px;
      grid-template-columns: minmax(140px, 220px) 1fr;
      margin: 0;
    }
    dt {
      color: var(--muted);
      font-weight: 600;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .empty {
      color: var(--muted);
      font-style: italic;
    }
    .risk-list {
      margin: 0;
      padding-left: 20px;
    }
    .envelope {
      border: 1px solid var(--border);
      height: auto;
      width: 100%;
    }
    .legend {
      color: var(--muted);
      display: flex;
      gap: 18px;
      margin-top: 8px;
    }
    .swatch {
      display: inline-block;
      height: 10px;
      margin-right: 6px;
      width: 18px;
    }
    .swatch.beat { background: var(--beat); }
    .swatch.peak { background: var(--peak); }
    .swatch.rms { background: var(--rms); }
  </style>
</head>
<body>
<main>
  <h1>Luumix Analysis Report</h1>
  <section>
    <h2>Source</h2>
    ${renderSourceSummary(metadata)}
  </section>
  <section>
    <h2>Risk</h2>
    ${renderRiskSummary(metadata)}
  </section>
  <section>
    <h2>Feature Summary</h2>
    ${renderFeatureSummary(metadata)}
  </section>
  <section>
    <h2>Candidates</h2>
    ${renderCandidateSections(metadata)}
  </section>
</main>
</body>
</html>
`;
}

function renderSourceSummary(metadata: TrackAnalysisMetadata): string {
  const source = metadata.sourceFile;
  return renderDefinitionList([
    ["Path", source.path],
    ["Content hash", source.contentHash],
    ["Duration", formatNumber(source.durationSec, " sec")],
    ["Sample rate", formatOptional(source.sampleRate, " Hz")],
    ["Channels", formatOptional(source.channels)],
    ["Codec", source.codec ?? "(unknown)"],
    ["Container", source.container ?? "(unknown)"],
  ]);
}

function renderRiskSummary(metadata: TrackAnalysisMetadata): string {
  const riskSignals = metadata.analysis.riskSignals;
  const autoMix = metadata.analysis.defaults.autoMix;
  const riskEntries = Object.entries(riskSignals)
    .filter(([key]) => key !== "notes")
    .map(([key, value]) => `<li>${escapeHtml(key)}: ${escapeHtml(String(value))}</li>`)
    .join("");
  const notes = riskSignals.notes?.map((note) => `<li>${escapeHtml(note)}</li>`).join("") ?? "";

  return `<div class="panel">
    ${renderDefinitionList([
      ["Auto-mix default", autoMix?.status ?? "(unset)"],
      ["Auto-mix reasons", autoMix?.reasons.join("; ") ?? "(none)"],
    ])}
    <h3>Risk Signals</h3>
    <ul class="risk-list">${riskEntries}${notes}</ul>
  </div>`;
}

function renderFeatureSummary(metadata: TrackAnalysisMetadata): string {
  const summary = metadata.analysis.featureSummary;
  if (!summary) {
    return `<p class="empty">No feature summary is available.</p>`;
  }

  const frameCount = Math.max(
    summary.peakEnvelope?.length ?? 0,
    summary.rmsEnvelope?.length ?? 0,
  );
  const silenceRanges =
    summary.silenceRangesSec
      ?.map((range) => `${formatNumber(range.startSec)}-${formatNumber(range.endSec)} sec`)
      .join(", ") || "(none)";

  return `<div class="panel">
    ${renderDefinitionList([
      ["Frame hop", `${formatNumber(summary.frameHopSec)} sec`],
      ["Frames", String(frameCount)],
      ["Silence ranges", silenceRanges],
    ])}
    ${renderEnvelopeSvg({
      beatGrid: getDefaultBeatGridCandidate(metadata),
      durationSec: metadata.sourceFile.durationSec,
      peakEnvelope: summary.peakEnvelope ?? [],
      rmsEnvelope: summary.rmsEnvelope ?? [],
    })}
    <div class="legend">
      <span><span class="swatch peak"></span>Peak envelope</span>
      <span><span class="swatch rms"></span>RMS envelope</span>
      <span><span class="swatch beat"></span>Beat ticks</span>
    </div>
  </div>`;
}

function renderEnvelopeSvg(input: {
  beatGrid?: BeatGridCandidate;
  durationSec: number;
  peakEnvelope: number[];
  rmsEnvelope: number[];
}): string {
  if (input.peakEnvelope.length === 0 && input.rmsEnvelope.length === 0) {
    return `<p class="empty">No envelope data is available.</p>`;
  }

  const width = 1000;
  const height = 220;
  const centerY = height / 2;
  const peakPath = buildEnvelopePath(input.peakEnvelope, width, height);
  const rmsPath = buildEnvelopePath(input.rmsEnvelope, width, height);
  const beatTicks = renderBeatTicks({
    beatGrid: input.beatGrid,
    durationSec: input.durationSec,
    height,
    width,
  });

  return `<svg class="envelope" viewBox="0 0 ${width} ${height}" role="img" aria-label="Feature envelope">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
    <line x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" stroke="#d7dce2"></line>
    <g data-overlay-layer="beat-ticks">${beatTicks}</g>
    <g data-overlay-layer="future-downbeat-ticks"></g>
    ${peakPath ? `<path d="${peakPath}" fill="none" stroke="var(--peak)" stroke-width="2"></path>` : ""}
    ${rmsPath ? `<path d="${rmsPath}" fill="none" stroke="var(--rms)" stroke-width="2"></path>` : ""}
  </svg>`;
}

function getDefaultBeatGridCandidate(
  metadata: TrackAnalysisMetadata,
): BeatGridCandidate | undefined {
  const defaultId = metadata.analysis.defaults.beatGridCandidateId;
  return (
    metadata.analysis.beatGridCandidates.find((candidate) => candidate.id === defaultId) ??
    metadata.analysis.beatGridCandidates[0]
  );
}

function renderBeatTicks(input: {
  beatGrid?: BeatGridCandidate;
  durationSec: number;
  height: number;
  width: number;
}): string {
  if (!input.beatGrid || input.durationSec <= 0) {
    return "";
  }

  return input.beatGrid.beatsSec
    .filter((beatSec) => beatSec >= 0 && beatSec <= input.durationSec)
    .map((beatSec) => {
      const x = Number(((beatSec / input.durationSec) * input.width).toFixed(3));
      return `<line x1="${x}" y1="0" x2="${x}" y2="${input.height}" stroke="var(--beat)" stroke-width="1" opacity="0.35"></line>`;
    })
    .join("");
}

function buildEnvelopePath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }

  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const xStep = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = Number((index * xStep).toFixed(3));
      const normalized = Math.min(1, Math.max(0, Math.abs(value) / max));
      const y = Number((height - normalized * height).toFixed(3));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function renderCandidateSections(metadata: TrackAnalysisMetadata): string {
  return [
    renderTempoCandidates(metadata.analysis.tempoCandidates),
    renderBeatGridCandidates(metadata.analysis.beatGridCandidates),
    renderDownbeatCandidates(metadata.analysis.downbeatCandidates),
    renderTransitionCandidates(metadata.analysis.transitionCandidates.mixIn, "Mix-in candidates"),
    renderTransitionCandidates(metadata.analysis.transitionCandidates.mixOut, "Mix-out candidates"),
    renderTransitionCandidates(metadata.analysis.transitionCandidates.avoid, "Avoid candidates"),
  ].join("\n");
}

function renderTempoCandidates(candidates: TempoCandidate[]): string {
  if (candidates.length === 0) {
    return renderEmptyCandidateSection("Tempo candidates");
  }

  return `<h3>Tempo candidates</h3><table>
    <thead><tr><th>ID</th><th>BPM</th><th>Confidence</th><th>Source</th><th>Notes</th></tr></thead>
    <tbody>${candidates
      .map(
        (candidate) => `<tr><td>${escapeHtml(candidate.id)}</td><td>${formatNumber(candidate.bpm)}</td><td>${formatNumber(candidate.confidence)}</td><td>${escapeHtml(candidate.source)}</td><td>${escapeHtml(candidate.notes?.join("; ") ?? "")}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function renderBeatGridCandidates(candidates: BeatGridCandidate[]): string {
  if (candidates.length === 0) {
    return renderEmptyCandidateSection("Beat grid candidates");
  }

  return `<h3>Beat grid candidates</h3><table>
    <thead><tr><th>ID</th><th>Tempo candidate</th><th>First beat</th><th>Confidence</th><th>Stability</th><th>Beats</th></tr></thead>
    <tbody>${candidates
      .map(
        (candidate) => `<tr><td>${escapeHtml(candidate.id)}</td><td>${escapeHtml(candidate.tempoCandidateId)}</td><td>${formatNumber(candidate.firstBeatSec)}</td><td>${formatNumber(candidate.confidence)}</td><td>${formatNumber(candidate.stability)}</td><td>${candidate.beatsSec.length}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function renderDownbeatCandidates(candidates: DownbeatCandidate[]): string {
  if (candidates.length === 0) {
    return renderEmptyCandidateSection("Downbeat candidates");
  }

  return `<h3>Downbeat candidates</h3><table>
    <thead><tr><th>ID</th><th>Beat grid</th><th>Phase</th><th>Confidence</th><th>Downbeats</th><th>Signals</th></tr></thead>
    <tbody>${candidates
      .map(
        (candidate) => `<tr><td>${escapeHtml(candidate.id)}</td><td>${escapeHtml(candidate.beatGridId)}</td><td>${candidate.phaseBeatIndex}</td><td>${formatNumber(candidate.confidence)}</td><td>${candidate.downbeatsSec.length}</td><td>${escapeHtml(candidate.supportingSignals?.join("; ") ?? "")}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function renderTransitionCandidates(
  candidates: TransitionCandidate[],
  label: string,
): string {
  if (candidates.length === 0) {
    return renderEmptyCandidateSection(label);
  }

  return `<h3>${escapeHtml(label)}</h3><table>
    <thead><tr><th>ID</th><th>Time</th><th>Bar</th><th>Length</th><th>Score</th><th>Reasons</th></tr></thead>
    <tbody>${candidates
      .map(
        (candidate) => `<tr><td>${escapeHtml(candidate.id)}</td><td>${formatNumber(candidate.timeSec)}</td><td>${candidate.barNumber ?? ""}</td><td>${candidate.suggestedLengthBars ?? ""}</td><td>${formatNumber(candidate.score)}</td><td>${escapeHtml(candidate.reasons?.join("; ") ?? "")}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function renderEmptyCandidateSection(label: string): string {
  return `<h3>${escapeHtml(label)}</h3><p class="empty">No ${escapeHtml(label.toLowerCase())} are available yet.</p>`;
}

function renderDefinitionList(items: Array<[string, string | number]>): string {
  return `<dl>${items
    .map(
      ([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`,
    )
    .join("")}</dl>`;
}

function formatOptional(value: number | undefined, suffix = ""): string {
  return value == null ? "(unknown)" : formatNumber(value, suffix);
}

function formatNumber(value: number, suffix = ""): string {
  return `${Number(value.toFixed(6))}${suffix}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
