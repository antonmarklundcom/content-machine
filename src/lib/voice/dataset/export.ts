import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VoiceProfile } from "@/db/schema";
import { binaryAvailable, binaryPath } from "@/lib/clips/fetch/binaries";
import { assertOnPc } from "@/lib/pc-only";
import { mediaRoot, mediaRootMessage, mediaRootStatus, splitRelative } from "@/lib/storage/root";
import { segment } from "@/lib/storage/paths";
import { FfmpegMissingError, measureDurationMs } from "@/lib/voice/audio";
import { getProfileByKey } from "@/lib/voice/store";

import { metadataCsv, type MetadataRow } from "./csv";
import { normalizeText } from "./normalize";
import { loadCandidates } from "./query";
import {
  assertExportConsent,
  resolveOptions,
  selectClips,
  type DatasetOptions,
  type DatasetSelection,
} from "./select";

/**
 * Training dataset export (build 5 §3.C, docs/DATASET.md): approved manual
 * takes → an LJSpeech/Piper folder under `MEDIA_ROOT/voice/_datasets/`.
 * Nothing is uploaded (PLAN-build5 §1.6). Written to a temp folder, then renamed.
 */

export const DATASETS_DIR = "voice/_datasets";
export const DATASET_SAMPLE_RATE = 22_050;

export class DatasetExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetExportError";
  }
}

export type DatasetExportRequest = DatasetOptions & {
  profileKey: string;
  language: string;
  /** Select and report only; write nothing. */
  dryRun?: boolean;
  /** For tests: the folder timestamp. */
  now?: Date;
};

export type DatasetClip = { id: string; takeId: number; seconds: number; text: string };

export type DatasetExportSummary = {
  dryRun: boolean;
  profileKey: string;
  language: string;
  /** Relative to MEDIA_ROOT; null for a dry run. */
  folder: string | null;
  absoluteFolder: string | null;
  clips: number;
  totalSeconds: number;
  excluded: DatasetSelection["excluded"];
};

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _out, stderr) =>
        error
          ? reject(new Error(`ffmpeg failed: ${String(stderr || error.message).slice(0, 500)}`))
          : resolve(),
    );
  });
}

/** Light trim of leading/trailing silence (< -50 dB), single-pass loudnorm, 22,050 Hz mono s16. */
const TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1";
export const DATASET_FILTER = `${TRIM},areverse,${TRIM},areverse,loudnorm=I=-23:TP=-2:LRA=11`;

export async function convertClip(input: string, output: string): Promise<void> {
  await runFfmpeg([
    "-i",
    input,
    "-vn",
    "-af",
    DATASET_FILTER,
    "-ac",
    "1",
    "-ar",
    String(DATASET_SAMPLE_RATE),
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export function datasetReadme(
  profile: VoiceProfile,
  language: string,
  clips: number,
  totalSeconds: number,
): string {
  const consentLine =
    profile.consentStatus === "not_needed"
      ? "Consent: not needed (the owner's own voice)."
      : `Consent: ${profile.consentStatus} — ${profile.consentPerson ?? "(person not recorded)"}; signed ${fmtDate(profile.consentSignedAt)}, expires ${fmtDate(profile.consentExpiresAt)}.`;
  return [
    `# Voice dataset: ${profile.name} (${language})`,
    "",
    `Speaker: ${profile.name} (profile \`${profile.key}\`, role ${profile.role}).`,
    consentLine,
    `Consent scope: ${profile.consentScope?.trim() || "—"}`,
    "",
    `${clips} clips, ${(totalSeconds / 60).toFixed(1)} minutes, ${DATASET_SAMPLE_RATE} Hz mono 16-bit WAV.`,
    "",
    "- `wavs/<id>.wav` — one clip per line",
    "- `metadata.csv` — LJSpeech format `id|text|normalized_text`, no header",
    "- `dataset.json` — counts, durations, source take ids, export options",
    "",
    "Use only within the consent scope above. How to train a voice later (Piper/VITS on a",
    "rented GPU): see `docs/DATASET.md` in content-engine. Nothing here has been uploaded.",
    "",
  ].join("\n");
}

async function uniqueFolder(base: string, name: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = path.join(base, i === 1 ? name : `${name}-${i}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

export async function exportDataset(req: DatasetExportRequest): Promise<DatasetExportSummary> {
  assertOnPc("Exporting a voice dataset");
  const opts = resolveOptions(req);
  const profile = await getProfileByKey(req.profileKey);
  if (!profile) throw new DatasetExportError(`No voice profile with key “${req.profileKey}”.`);
  assertExportConsent(profile);

  const selection = selectClips(await loadCandidates(profile.id, req.language), opts);
  const base: DatasetExportSummary = {
    dryRun: !!req.dryRun,
    profileKey: profile.key,
    language: req.language,
    folder: null,
    absoluteFolder: null,
    clips: selection.clips.length,
    totalSeconds: selection.clips.reduce((s, c) => s + (c.durationMs ?? 0) / 1000, 0),
    excluded: selection.excluded,
  };
  if (req.dryRun) return base;
  if (!selection.clips.length) {
    throw new DatasetExportError(
      `No clips to export for “${profile.key}” in ${req.language} (approved manual takes of ${opts.minSec}–${opts.maxSec} s).`,
    );
  }

  const root = mediaRoot();
  const status = await mediaRootStatus(root);
  if (status !== "ok") throw new DatasetExportError(mediaRootMessage(status));
  if (!(await binaryAvailable("ffmpeg"))) throw new FfmpegMissingError();

  const datasetsAbs = path.join(root, ...DATASETS_DIR.split("/"));
  await mkdir(datasetsAbs, { recursive: true });
  const name = `${segment(profile.key)}-${segment(req.language)}-${stamp(req.now ?? new Date())}`;
  const tmp = path.join(datasetsAbs, `.tmp-${name}-${randomBytes(4).toString("hex")}`);
  await mkdir(path.join(tmp, "wavs"), { recursive: true });

  try {
    const clips: DatasetClip[] = [];
    const rows: MetadataRow[] = [];
    for (const c of selection.clips) {
      const segs = splitRelative(c.masterPath ?? "");
      if (!segs) throw new DatasetExportError(`Take ${c.id}: unsafe master path.`);
      const id = `take${c.id}`;
      const out = path.join(tmp, "wavs", `${id}.wav`);
      await convertClip(path.join(root, ...segs), out);
      const ms = await measureDurationMs(out);
      clips.push({
        id,
        takeId: c.id,
        seconds: (ms ?? c.durationMs ?? 0) / 1000,
        text: c.inputText,
      });
      rows.push({ id, text: c.inputText, normalized: normalizeText(c.inputText, req.language) });
    }
    const totalSeconds = clips.reduce((s, c) => s + c.seconds, 0);
    await writeFile(path.join(tmp, "metadata.csv"), metadataCsv(rows), "utf8");
    await writeFile(
      path.join(tmp, "dataset.json"),
      JSON.stringify(
        {
          format: "ljspeech",
          profileKey: profile.key,
          profileName: profile.name,
          language: req.language,
          sampleRate: DATASET_SAMPLE_RATE,
          channels: 1,
          bitsPerSample: 16,
          clipCount: clips.length,
          totalSeconds: Math.round(totalSeconds * 1000) / 1000,
          clips: clips.map((c) => ({ id: c.id, takeId: c.takeId, seconds: c.seconds })),
          sourceTakeIds: clips.map((c) => c.takeId),
          excluded: selection.excluded,
          options: opts,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(tmp, "README.md"),
      datasetReadme(profile, req.language, clips.length, totalSeconds),
      "utf8",
    );
    const final = await uniqueFolder(datasetsAbs, name);
    await rename(tmp, final);
    return {
      ...base,
      folder: `${DATASETS_DIR}/${path.basename(final)}`,
      absoluteFolder: final,
      totalSeconds,
    };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

export type RecentExport = {
  name: string;
  folder: string;
  clipCount: number | null;
  totalSeconds: number | null;
  exportedAt: string | null;
};

/** Finished exports under `voice/_datasets`, newest first (temp folders skipped). */
export async function listExports(limit = 20): Promise<RecentExport[]> {
  const dir = path.join(mediaRoot(), ...DATASETS_DIR.split("/"));
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: RecentExport[] = [];
  for (const name of names) {
    let meta: { clipCount?: number; totalSeconds?: number; exportedAt?: string } = {};
    try {
      meta = JSON.parse(await readFile(path.join(dir, name, "dataset.json"), "utf8"));
    } catch {
      // A folder without dataset.json is listed with blanks.
    }
    out.push({
      name,
      folder: `${DATASETS_DIR}/${name}`,
      clipCount: meta.clipCount ?? null,
      totalSeconds: meta.totalSeconds ?? null,
      exportedAt: meta.exportedAt ?? null,
    });
  }
  return out
    .sort((a, b) => (b.exportedAt ?? b.name).localeCompare(a.exportedAt ?? a.name))
    .slice(0, limit);
}
