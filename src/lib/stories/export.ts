/**
 * "Export to cuentos" (build 4 §3.C.7, PLAN §1.10) — the one place the studio
 * writes into CUENTOS_ROOT, and only on the owner's click.
 *
 * Writes only:
 *   books/<slug>/audio/<lang>/<scene>.wav|.mp3     selected scene audio
 *   books/<slug>/audio/<lang>/<render>.srt|.vtt    captions of the latest render
 *   books/<slug>/audio/manifest.content-engine.json
 * A file there that the previous export did not write (the repo's own
 * recording, say) is never overwritten: it is skipped and reported. The repo's
 * own manifests and text are never touched.
 */
import "server-only";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { mediaRoot } from "@/lib/storage/root";
import { cuentosRoot, isSafeSlug } from "./book";
import { getStory, listActiveProfiles, listScenes, listStoryRenders, listStoryTakes } from "./data";
import { readSceneMeta } from "./meta";
import { sceneAudioFresh, sceneReadiness } from "./readiness";
import { voiceLanguageFor } from "./rules";
import { StoryError } from "./studio";

export const EXPORT_MANIFEST = "manifest.content-engine.json";

type ExportedScene = {
  sceneRef: string;
  wav: string;
  mp3: string | null;
  durationMs: number;
  takeIds: number[];
  voiceProfileKeys: (string | null)[];
  speakers: (string | null)[];
  reviewStatus: string[];
  textStatus: string | null;
};

type ExportedLanguage = {
  exportedAt: string;
  voiceLanguage: string;
  scenes: ExportedScene[];
  render: {
    id: number;
    format: string;
    durationMs: number | null;
    videoPath: string | null;
    srt: string | null;
    vtt: string | null;
  } | null;
};

export type ExportManifest = {
  generator: "content-engine";
  note: string;
  story: string;
  updatedAt: string;
  /** Every file the exports wrote, relative to the book: the only files a later export may overwrite. */
  files: string[];
  languages: Record<string, ExportedLanguage>;
};

export type ExportResult = {
  written: string[];
  skipped: string[];
  missing: string[];
  manifestPath: string;
};

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(file: string): Promise<ExportManifest | null> {
  try {
    const v = JSON.parse(await readFile(file, "utf8")) as ExportManifest;
    return v && v.generator === "content-engine" ? v : null;
  } catch {
    return null;
  }
}

function safeStem(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_.]+/, "") || "file";
}

export async function exportToCuentos(
  slug: string,
  lang: string,
  now = new Date(),
): Promise<ExportResult> {
  if (!isSafeSlug(slug)) throw new StoryError("not_found", `Not a book: ${slug}`);
  const root = cuentosRoot();
  if (!root) throw new StoryError("cuentos_missing", "CUENTOS_ROOT is not set.");
  const voiceLang = voiceLanguageFor(lang);
  if (!voiceLang) throw new StoryError("bad_language", `${lang} is not a narration language.`);
  const story = await getStory(slug);
  if (!story) throw new StoryError("not_found", `No story "${slug}".`);

  const bookDir = path.resolve(root, "books", slug);
  if (!(await exists(path.join(bookDir, "story.json")))) {
    throw new StoryError("cuentos_missing", `books/${slug}/story.json is not under CUENTOS_ROOT.`);
  }
  const audioDir = path.join(bookDir, "audio");
  const langDir = path.join(audioDir, safeStem(lang));
  const manifestFile = path.join(audioDir, EXPORT_MANIFEST);
  const previous = await readManifest(manifestFile);
  if (!previous && (await exists(manifestFile))) {
    throw new StoryError(
      "file_missing",
      `audio/${EXPORT_MANIFEST} exists but was not written by content-engine.`,
    );
  }
  const ours = new Set(previous?.files ?? []);
  const rel = (abs: string) => path.relative(bookDir, abs).split(path.sep).join("/");

  const [scenes, takes, renders, profiles] = await Promise.all([
    listScenes(story.id),
    listStoryTakes(slug),
    listStoryRenders(slug),
    listActiveProfiles(),
  ]);
  const profileKey = new Map(profiles.map((p) => [p.id, p.key]));
  const written: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  /** Copy `src` (absolute, under MEDIA_ROOT) to `dest` unless dest is someone else's file. */
  const put = async (src: string, dest: string): Promise<boolean> => {
    const r = rel(dest);
    if (r.startsWith("..") || !r.startsWith("audio/"))
      throw new Error(`refusing to write outside audio/: ${r}`);
    if ((await exists(dest)) && !ours.has(r)) {
      skipped.push(`${r} (already there, not written by content-engine)`);
      return false;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    written.push(r);
    ours.add(r);
    return true;
  };
  const media = (p: string) => path.resolve(mediaRoot(), ...p.split("/"));

  const exported: ExportedScene[] = [];
  for (const scene of scenes) {
    const readiness = sceneReadiness(scene, lang, takes);
    const audio = readSceneMeta(scene.notes).audio?.[lang];
    if (!readiness.ready || !sceneAudioFresh(audio, readiness) || !audio) {
      if (typeof scene.text[lang] === "string") missing.push(scene.sceneRef);
      continue;
    }
    const stem = safeStem(scene.sceneRef);
    const wavDest = path.join(langDir, `${stem}.wav`);
    if (!(await put(media(audio.wavPath), wavDest))) continue;
    let mp3: string | null = null;
    if (audio.mp3Path) {
      const mp3Dest = path.join(langDir, `${stem}.mp3`);
      if (await put(media(audio.mp3Path), mp3Dest)) mp3 = rel(mp3Dest);
    }
    const sel = readiness.lines.map((l) => l.selected!);
    exported.push({
      sceneRef: scene.sceneRef,
      wav: rel(wavDest),
      mp3,
      durationMs: audio.durationMs,
      takeIds: sel.map((t) => t.id),
      voiceProfileKeys: sel.map((t) =>
        t.voiceProfileId ? (profileKey.get(t.voiceProfileId) ?? null) : null,
      ),
      speakers: sel.map((t) => t.speaker),
      reviewStatus: sel.map((t) => t.reviewStatus),
      textStatus: scene.textStatus[lang] ?? null,
    });
  }

  const latest = renders.find((r) => r.language === voiceLang && r.status === "done") ?? null;
  let render: ExportedLanguage["render"] = null;
  if (latest) {
    const base = latest.videoPath
      ? safeStem(path.basename(latest.videoPath).replace(/\.[^.]+$/, ""))
      : `render-${latest.id}`;
    let srt: string | null = null;
    let vtt: string | null = null;
    if (latest.srtPath && (await exists(media(latest.srtPath)))) {
      const d = path.join(langDir, `${base}.srt`);
      if (await put(media(latest.srtPath), d)) srt = rel(d);
    }
    if (latest.vttPath && (await exists(media(latest.vttPath)))) {
      const d = path.join(langDir, `${base}.vtt`);
      if (await put(media(latest.vttPath), d)) vtt = rel(d);
    }
    render = {
      id: latest.id,
      format: latest.format,
      durationMs: latest.durationMs,
      videoPath: latest.videoPath,
      srt,
      vtt,
    };
  }

  const manifest: ExportManifest = {
    generator: "content-engine",
    note: "Written by content-engine's Export to cuentos. Only the files listed here are content-engine's; the book's own manifests and text are untouched.",
    story: slug,
    updatedAt: now.toISOString(),
    files: [...ours].sort(),
    languages: {
      ...(previous?.languages ?? {}),
      [lang]: { exportedAt: now.toISOString(), voiceLanguage: voiceLang, scenes: exported, render },
    },
  };
  await mkdir(audioDir, { recursive: true });
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { written, skipped, missing, manifestPath: rel(manifestFile) };
}
