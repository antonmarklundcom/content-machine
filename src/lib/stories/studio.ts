/**
 * Story studio operations (build 4 §3.C.4–6): narrate a scene, upload a
 * recording, pick and review takes, approve text in-app, build scene audio,
 * render. Each takes `Partial<StoryDeps>` so tests can swap the engines.
 */
import "server-only";
import { assertOnPc } from "@/lib/pc-only";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { narrations, storyScenes, type Story, type StoryScene } from "@/db/schema";
import { registerFile } from "@/lib/media/register";
import { storeImmutableOutput } from "@/lib/media/immutable-output";
import { mediaRoot } from "@/lib/storage/root";
import { segment } from "@/lib/storage/paths";
import { enqueueRender } from "@/lib/video";
import type { RenderRequest, RenderResult, VideoFormat } from "@/lib/video/contract";
import type { NarrateResult, TakeReviewStatus } from "@/lib/voice/contract";
import { cuentosRoot } from "./book";
import {
  characterProfileFor,
  getScene,
  getStory,
  listActiveProfiles,
  listScenes,
  listStoryTakes,
  narratorProfilesFor,
  storyOwnerRef,
  type TakeRow,
} from "./data";
import { storyDeps, type StoryDeps } from "./deps";
import { concatWithGaps, encodeMp3, ffmpegAvailable, probeMs } from "./ffmpeg";
import { readSceneMeta, textSha, writeSceneMeta } from "./meta";
import { sceneAudioFresh, sceneReadiness, type SceneReadiness } from "./readiness";
import { buildStoryRenderRequest, type MissingScene } from "./render";
import {
  canApproveInApp,
  IN_APP_APPROVED,
  isApprovedStatus,
  ttsAllowed,
  voiceLanguageFor,
} from "./rules";
import type { SceneAudio } from "./types";

/** Gap between lines of one scene in its joined audio. */
export const LINE_GAP_MS = 250;

export type StoryErrorCode =
  | "not_found"
  | "bad_language"
  | "text_refused"
  | "upload_only"
  | "no_profile"
  | "not_ready"
  | "ffmpeg_missing"
  | "cuentos_missing"
  | "file_missing";

export class StoryError extends Error {
  constructor(
    readonly code: StoryErrorCode,
    message: string,
    readonly missing?: MissingScene[],
  ) {
    super(message);
    this.name = "StoryError";
  }
}

async function requireStoryScene(
  slug: string,
  sceneRef: string,
): Promise<{ story: Story; scene: StoryScene }> {
  const story = await getStory(slug);
  if (!story) throw new StoryError("not_found", `No story "${slug}". Import it first.`);
  const scene = await getScene(story.id, sceneRef);
  if (!scene) throw new StoryError("not_found", `No scene ${sceneRef} in "${slug}".`);
  return { story, scene };
}

function requireVoiceLang(lang: string) {
  const v = voiceLanguageFor(lang);
  if (!v) throw new StoryError("bad_language", `${lang} is not a narration language.`);
  return v;
}

/** A safe file stem for a scene id, keeping its case (`S03`). */
function sceneFileStem(sceneRef: string): string {
  return sceneRef.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_.]+/, "") || "scene";
}

/** `stories/<slug>/audio/<lang>/<scene>` (relative to MEDIA_ROOT, no extension). */
export function sceneAudioStem(slug: string, lang: string, sceneRef: string): string {
  return `stories/${segment(slug, "story")}/audio/${segment(lang, "und")}/${sceneFileStem(sceneRef)}`;
}

// ---------------------------------------------------------------------------
// Narrate / upload

export type NarrateSceneInput = {
  slug: string;
  sceneRef: string;
  lang: string;
  /** The narrator; default = the first active narrator profile for the language. */
  narratorProfileId?: number | null;
  /** Character key → profile id; default = the profile with that character key, else the narrator. */
  speakerProfiles?: Record<string, number>;
  /** Re-take every line, not only those without a usable take. */
  all?: boolean;
};

export type NarrateSceneResult = {
  takes: Array<{ slot: string; speaker: string | null; result: NarrateResult; selected: boolean }>;
  notes: string[];
  audio: SceneAudio | null;
};

export async function narrateScene(
  input: NarrateSceneInput,
  overrides: Partial<StoryDeps> = {},
): Promise<NarrateSceneResult> {
  const deps = storyDeps(overrides);
  const { story, scene } = await requireStoryScene(input.slug, input.sceneRef);
  const voiceLang = requireVoiceLang(input.lang);
  if (!ttsAllowed(input.lang)) {
    throw new StoryError(
      "upload_only",
      "Guaraní is recorded by a person: upload a recording for this scene (no TTS speaks Guaraní).",
    );
  }
  const takes = await listStoryTakes(story.slug);
  const readiness = sceneReadiness(scene, input.lang, takes);
  if (!readiness.text.ok) throw new StoryError("text_refused", readiness.text.message);

  const profiles = await listActiveProfiles();
  const narrators = narratorProfilesFor(profiles, input.lang);
  const narrator = input.narratorProfileId
    ? profiles.find((p) => p.id === input.narratorProfileId && p.active)
    : narrators[0];
  if (!narrator) {
    throw new StoryError(
      "no_profile",
      `No active narrator voice profile for ${voiceLang}. Add one in /voice.`,
    );
  }

  const notes: string[] = [];
  const todo = readiness.lines.filter((l) => input.all || !l.usable);
  const lines = todo.length ? todo : readiness.lines;
  const made: NarrateSceneResult["takes"] = [];
  for (const state of lines) {
    let profileId = narrator.id;
    const speaker = state.line.speaker;
    if (speaker) {
      const chosen = input.speakerProfiles?.[speaker];
      const own = characterProfileFor(profiles, speaker);
      if (chosen && profiles.some((p) => p.id === chosen && p.active)) profileId = chosen;
      else if (own) profileId = own.id;
      else notes.push(`${state.slot}: no voice profile for "${speaker}"; the narrator reads it.`);
    }
    const result = await deps.narrate({
      ownerKind: "story_scene",
      ownerRef: storyOwnerRef(story.slug),
      sceneRef: state.slot,
      language: voiceLang,
      voiceProfileId: profileId,
      text: state.line.text,
      speaker: speaker ?? null,
      pronunciationScope: `story:${story.slug}`,
    });
    // A first usable take is selected for you; an existing good choice is kept.
    let selected = false;
    if (!state.usable) {
      await deps.selectTake(result.narrationId);
      selected = true;
    }
    made.push({ slot: state.slot, speaker: speaker ?? null, result, selected });
  }
  const audio = await tryBuildSceneAudio(story.slug, scene.sceneRef, input.lang, notes);
  return { takes: made, notes, audio };
}

export type UploadSceneInput = {
  slug: string;
  sceneRef: string;
  lang: string;
  /** The line slot (`S03` or `S03#2`). */
  slot: string;
  /** Absolute path to the uploaded file; the engine copies it. */
  filePath: string;
  voiceProfileId?: number | null;
};

/** An uploaded recording (a native speaker, Anton) becomes a `manual` take for one line. */
export async function uploadSceneRecording(
  input: UploadSceneInput,
  overrides: Partial<StoryDeps> = {},
): Promise<{
  result: NarrateResult;
  selected: boolean;
  notes: string[];
  audio: SceneAudio | null;
}> {
  const deps = storyDeps(overrides);
  const { story, scene } = await requireStoryScene(input.slug, input.sceneRef);
  const voiceLang = requireVoiceLang(input.lang);
  const takes = await listStoryTakes(story.slug);
  const readiness = sceneReadiness(scene, input.lang, takes);
  if (!readiness.text.ok) throw new StoryError("text_refused", readiness.text.message);
  const state = readiness.lines.find((l) => l.slot === input.slot);
  if (!state) throw new StoryError("not_found", `No line ${input.slot} in ${scene.sceneRef}.`);

  const result = await deps.importRecording({
    ownerKind: "story_scene",
    ownerRef: storyOwnerRef(story.slug),
    sceneRef: state.slot,
    language: voiceLang,
    voiceProfileId: input.voiceProfileId ?? null,
    text: state.line.text,
    speaker: state.line.speaker ?? null,
    pronunciationScope: `story:${story.slug}`,
    filePath: input.filePath,
  });
  let selected = false;
  if (!state.usable) {
    await deps.selectTake(result.narrationId);
    selected = true;
  }
  const notes: string[] = [];
  const audio = await tryBuildSceneAudio(story.slug, scene.sceneRef, input.lang, notes);
  return { result, selected, notes, audio };
}

async function requireStoryTake(slug: string, narrationId: number) {
  const [take] = await db.select().from(narrations).where(eq(narrations.id, narrationId)).limit(1);
  if (!take || take.ownerKind !== "story_scene" || take.ownerRef !== storyOwnerRef(slug)) {
    throw new StoryError("not_found", `Take ${narrationId} is not one of "${slug}".`);
  }
  return take;
}

/** The scene and story language a take belongs to (`S03#2` → `S03`, `es-PY` → `es`). */
async function sceneOfTake(slug: string, sceneRef: string | null, language: string) {
  const story = await getStory(slug);
  if (!story || !sceneRef) return null;
  const baseRef = sceneRef.replace(/#\d+$/, "");
  const lang = story.languages.find((l) => voiceLanguageFor(l) === language) ?? null;
  return lang ? { baseRef, lang } : null;
}

export async function selectSceneTake(
  slug: string,
  narrationId: number,
  overrides: Partial<StoryDeps> = {},
): Promise<{ notes: string[]; audio: SceneAudio | null }> {
  const deps = storyDeps(overrides);
  const take = await requireStoryTake(slug, narrationId);
  await deps.selectTake(narrationId);
  const notes: string[] = [];
  const where = await sceneOfTake(slug, take.sceneRef, take.language);
  const audio = where ? await tryBuildSceneAudio(slug, where.baseRef, where.lang, notes) : null;
  return { notes, audio };
}

export async function reviewSceneTake(
  slug: string,
  narrationId: number,
  status: TakeReviewStatus,
  reviewer: string | null,
  note: string | null = null,
  overrides: Partial<StoryDeps> = {},
): Promise<void> {
  const deps = storyDeps(overrides);
  await requireStoryTake(slug, narrationId);
  await deps.reviewTake(narrationId, status, note, reviewer);
}

// ---------------------------------------------------------------------------
// In-app approval

/**
 * "Mark text approved here": the owner has read the text (or a Paraguayan
 * reviewer has) and the repo has not caught up. Recorded with who and when; a
 * re-import keeps it unless the repo's status or the text changes.
 */
export async function approveSceneText(
  slug: string,
  sceneRef: string,
  lang: string,
  by: string,
  now = new Date(),
): Promise<"approved" | "already"> {
  const { scene } = await requireStoryScene(slug, sceneRef);
  const repoStatus = scene.textStatus[lang] ?? null;
  const check = canApproveInApp(scene, lang);
  if (!check.ok) throw new StoryError("text_refused", check.message);
  if (isApprovedStatus(repoStatus)) return "already";
  const meta = readSceneMeta(scene.notes);
  meta.approvals = {
    ...(meta.approvals ?? {}),
    [lang]: { by, at: now.toISOString(), repoStatus, textSha: textSha(check.text) },
  };
  await db
    .update(storyScenes)
    .set({
      textStatus: { ...scene.textStatus, [lang]: IN_APP_APPROVED },
      notes: writeSceneMeta(meta),
      updatedAt: now,
    })
    .where(eq(storyScenes.id, scene.id));
  return "approved";
}

export type ApproveLanguageResult = {
  approved: string[];
  already: string[];
  /** Scenes that cannot be approved here (no text, a pending-review notice), with why. */
  skipped: Array<{ sceneRef: string; reason: string }>;
};

/**
 * "Approve all <lang> text in this book" — the same in-app approval as one
 * scene, for every scene that can take it. Refused for Guaraní: each Guaraní
 * scene is approved by the native reviewer, one by one (PLAN-build4 §1.2–1.3).
 */
export async function approveStoryLanguage(
  slug: string,
  lang: string,
  by: string,
  now = new Date(),
): Promise<ApproveLanguageResult> {
  if (!ttsAllowed(lang))
    throw new StoryError(
      "text_refused",
      "Guaraní text is approved scene by scene by the native reviewer, not in bulk.",
    );
  const story = await getStory(slug);
  if (!story) throw new StoryError("not_found", `No story "${slug}".`);
  const out: ApproveLanguageResult = { approved: [], already: [], skipped: [] };
  for (const scene of await listScenes(story.id)) {
    const check = canApproveInApp(scene, lang);
    if (!check.ok) {
      if (typeof scene.text[lang] === "string" || scene.kind === "page")
        out.skipped.push({ sceneRef: scene.sceneRef, reason: check.message });
      continue;
    }
    const r = await approveSceneText(slug, scene.sceneRef, lang, by, now);
    (r === "approved" ? out.approved : out.already).push(scene.sceneRef);
  }
  return out;
}

/** Undo an in-app approval: the repo's own status comes back. */
export async function revokeSceneApproval(
  slug: string,
  sceneRef: string,
  lang: string,
): Promise<boolean> {
  const { scene } = await requireStoryScene(slug, sceneRef);
  const meta = readSceneMeta(scene.notes);
  const approval = meta.approvals?.[lang];
  if (!approval) return false;
  delete meta.approvals![lang];
  const textStatus = { ...scene.textStatus };
  if (approval.repoStatus) textStatus[lang] = approval.repoStatus;
  else delete textStatus[lang];
  await db
    .update(storyScenes)
    .set({ textStatus, notes: writeSceneMeta(meta), updatedAt: new Date() })
    .where(eq(storyScenes.id, scene.id));
  return true;
}

// ---------------------------------------------------------------------------
// Scene audio

function absoluteMedia(rel: string): string {
  return path.resolve(mediaRoot(), ...rel.split("/"));
}

/**
 * Join the selected takes of a scene (narrator + characters, in order, 250 ms
 * apart) into `stories/<slug>/audio/<lang>/<scene>.wav` + `.mp3`, shift the
 * word timings by each line's measured start, register both files. A
 * one-line scene uses its take's own files. Durations are measured.
 */
export async function buildSceneAudio(
  slug: string,
  sceneRef: string,
  lang: string,
): Promise<SceneAudio> {
  assertOnPc("Building story audio");
  const { story, scene } = await requireStoryScene(slug, sceneRef);
  const takes = await listStoryTakes(story.slug);
  const readiness: SceneReadiness<TakeRow> = sceneReadiness(scene, lang, takes);
  if (!readiness.takesReady) {
    const missing = readiness.lines.filter((l) => !l.usable).map((l) => `${l.slot}: ${l.problem}`);
    throw new StoryError(
      "not_ready",
      `${sceneRef} ${lang} has no usable take for ${missing.join(", ")}.`,
    );
  }
  const selected = readiness.lines.map((l) => l.selected as TakeRow);
  for (const t of selected) {
    if (!t.masterPath)
      throw new StoryError("file_missing", `Take ${t.id} has no WAV master on file.`);
  }
  if (!(await ffmpegAvailable())) {
    throw new StoryError(
      "ffmpeg_missing",
      "ffmpeg/ffprobe are not installed (or FFMPEG_PATH/FFPROBE_PATH).",
    );
  }

  const inputs = selected.map((t) => absoluteMedia(t.masterPath as string));
  const durations: number[] = [];
  for (const f of inputs) {
    try {
      durations.push(await probeMs(f));
    } catch {
      throw new StoryError("file_missing", `Cannot read ${f} (is the media drive connected?).`);
    }
  }

  let audio: SceneAudio;
  if (selected.length === 1) {
    const t = selected[0];
    audio = {
      wavPath: t.masterPath as string,
      mp3Path: t.playbackPath,
      durationMs: durations[0],
      alignment: t.alignment ?? null,
      takeIds: [t.id],
      builtAt: new Date().toISOString(),
    };
  } else {
    // A rebuild is a new immutable version; old scene metadata/files stay recoverable.
    const stem = `${sceneAudioStem(story.slug, lang, scene.sceneRef)}-${randomUUID()}`;
    const workDir = await mkdtemp(path.join(tmpdir(), "cm-scene-audio-"));
    const wavAbs = path.join(workDir, "scene.wav");
    const mp3Abs = path.join(workDir, "scene.mp3");
    try {
      await concatWithGaps(inputs, LINE_GAP_MS, wavAbs);
      let mp3Path: string | null = `${stem}.mp3`;
      try {
        await encodeMp3(wavAbs, mp3Abs);
      } catch {
        mp3Path = null;
      }
      const sceneDurationMs = await probeMs(wavAbs);
      if (sceneDurationMs <= 0)
        throw new StoryError("file_missing", "The completed scene audio could not be read.");
      await storeImmutableOutput(`${stem}.wav`, { file: wavAbs });
      if (mp3Path) await storeImmutableOutput(mp3Path, { file: mp3Abs });
      const alignment: NonNullable<SceneAudio["alignment"]> = [];
      let offset = 0;
      let haveTimings = true;
      selected.forEach((t, i) => {
        if (!t.alignment) haveTimings = false;
        for (const w of t.alignment ?? []) {
          alignment.push({ word: w.word, startMs: w.startMs + offset, endMs: w.endMs + offset });
        }
        offset += durations[i] + LINE_GAP_MS;
      });
      const tags = ["story", segment(story.slug, "story"), lang, "scene-audio"];
      const sourceRef = `${storyOwnerRef(story.slug)}#${scene.sceneRef}`;
      await registerFile(`${stem}.wav`, {
        source: "import",
        sourceRef,
        tags,
        notes: "Story scene audio (joined takes)",
      });
      if (mp3Path) await registerFile(mp3Path, { source: "import", sourceRef, tags });
      audio = {
        wavPath: `${stem}.wav`,
        mp3Path,
        durationMs: sceneDurationMs,
        alignment: haveTimings ? alignment : null,
        takeIds: selected.map((t) => t.id),
        builtAt: new Date().toISOString(),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const meta = readSceneMeta(scene.notes);
  meta.audio = { ...(meta.audio ?? {}), [lang]: audio };
  await db
    .update(storyScenes)
    .set({ notes: writeSceneMeta(meta) })
    .where(eq(storyScenes.id, scene.id));
  return audio;
}

/** Build scene audio when the scene is ready; a reason why not goes into `notes`. */
async function tryBuildSceneAudio(
  slug: string,
  sceneRef: string,
  lang: string,
  notes: string[],
): Promise<SceneAudio | null> {
  try {
    return await buildSceneAudio(slug, sceneRef, lang);
  } catch (err) {
    if (err instanceof StoryError && err.code !== "not_ready") notes.push(err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Render

export type RenderStoryInput = {
  slug: string;
  lang: string;
  format: VideoFormat;
  sample: boolean;
  musicPath?: string | null;
  /** Music level under narration (dB); the renderer defaults to -18. */
  musicDb?: number;
};

type PreparedStoryRender = { request: RenderRequest; sceneRefs: string[] };

/** Builds stale scene audio, then the RenderRequest (with the music bed), or throws `not_ready`. */
async function prepareStoryRender(input: RenderStoryInput): Promise<PreparedStoryRender> {
  const story = await getStory(input.slug);
  if (!story) throw new StoryError("not_found", `No story "${input.slug}".`);
  requireVoiceLang(input.lang);
  const root = cuentosRoot();
  if (!root)
    throw new StoryError("cuentos_missing", "CUENTOS_ROOT is not set: the art lives there.");

  let scenes = await listScenes(story.id);
  let takes = await listStoryTakes(story.slug);
  // Build any scene audio that is ready but stale or missing, then re-read.
  let rebuilt = false;
  for (const scene of scenes) {
    const r = sceneReadiness(scene, input.lang, takes);
    if (r.ready && !sceneAudioFresh(readSceneMeta(scene.notes).audio?.[input.lang], r)) {
      try {
        await buildSceneAudio(story.slug, scene.sceneRef, input.lang);
        rebuilt = true;
      } catch (err) {
        if (!(err instanceof StoryError)) throw err;
      }
    }
  }
  if (rebuilt) {
    scenes = await listScenes(story.id);
    takes = await listStoryTakes(story.slug);
  }

  const plan = buildStoryRenderRequest({
    slug: story.slug,
    ageBand: story.ageBand,
    lang: input.lang,
    format: input.format,
    sample: input.sample,
    cuentosRoot: root,
    mediaRoot: mediaRoot(),
    musicPath: input.musicPath ?? null,
    scenes: scenes.map((s) => ({
      sceneRef: s.sceneRef,
      kind: s.kind,
      text: s.text,
      artPath: s.artPath,
      readiness: sceneReadiness(s, input.lang, takes),
      audio: readSceneMeta(s.notes).audio?.[input.lang],
    })),
  });
  if (!plan.ok) {
    const list = plan.missing.map((m) => `${m.sceneRef} (${m.reasons.join("; ")})`).join(", ");
    throw new StoryError("not_ready", `Not ready to render ${input.lang}: ${list}`, plan.missing);
  }
  const request: RenderRequest =
    input.musicPath && input.musicDb !== undefined
      ? { ...plan.request, musicDb: input.musicDb }
      : plan.request;
  return { request, sceneRefs: plan.sceneRefs };
}

/** Renders and waits (CLI, tests). Pages use `queueStoryRender`. */
export async function renderStory(
  input: RenderStoryInput,
  overrides: Partial<StoryDeps> = {},
): Promise<{ result: RenderResult; sceneRefs: string[] }> {
  const deps = storyDeps(overrides);
  const { request, sceneRefs } = await prepareStoryRender(input);
  const result = await deps.renderVideo(request);
  return { result, sceneRefs };
}

/**
 * Queues the render (build 5 E): returns the `video_renders` id at once; the
 * outcome lands in that row. `done` settles when ffmpeg finishes.
 */
export async function queueStoryRender(
  input: RenderStoryInput,
  enqueue: typeof enqueueRender = enqueueRender,
): Promise<{ renderId: number; done: Promise<RenderResult>; sceneRefs: string[] }> {
  const { request, sceneRefs } = await prepareStoryRender(input);
  const { renderId, done } = await enqueue(request);
  return { renderId, done, sceneRefs };
}
