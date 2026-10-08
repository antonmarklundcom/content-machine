/**
 * Building a story video's `RenderRequest` (pure, build 4 §3.C.6). Phase B's
 * `renderVideo()` does the ffmpeg work; this decides what goes in.
 *
 * Every scene in the cut needs approved text and built scene audio from
 * usable selected takes in that language — otherwise the render is refused
 * with the list of scenes that are missing something. Durations are the
 * measured audio plus padding (§1.7); captions are the scene text verbatim.
 */
import path from "node:path";

import { storyVideoFolder } from "@/lib/storage/paths";
import type { CameraMove, RenderRequest, RenderScene, VideoFormat } from "@/lib/video/contract";
import { sceneAudioFresh, type SceneReadiness } from "./readiness";
import { scenePadMs, voiceLanguageFor } from "./rules";
import type { SceneAudio } from "./types";

/** The first-milestone sample: scenes from the start, up to about this long. */
export const SAMPLE_MAX_MS = 45_000;

/** Gentle, varied moves: neighbours never repeat. */
const CAMERA_CYCLE: CameraMove[] = [
  "zoom_in",
  "pan_right",
  "zoom_out",
  "pan_left",
  "pan_up",
  "pan_down",
];

export function cameraFor(index: number): CameraMove {
  return CAMERA_CYCLE[index % CAMERA_CYCLE.length];
}

export type RenderSceneInput = {
  sceneRef: string;
  kind: string;
  text: Record<string, string | null>;
  /** Relative to CUENTOS_ROOT. */
  artPath: string | null;
  readiness: SceneReadiness;
  audio: SceneAudio | undefined;
};

export type MissingScene = { sceneRef: string; reasons: string[] };

export type StoryRenderPlan =
  | { ok: true; request: RenderRequest; sceneRefs: string[]; estimatedMs: number }
  | { ok: false; missing: MissingScene[] };

export function buildStoryRenderRequest(input: {
  slug: string;
  ageBand: string | null;
  lang: string;
  format: VideoFormat;
  sample: boolean;
  scenes: RenderSceneInput[];
  cuentosRoot: string;
  mediaRoot: string;
  musicPath?: string | null;
}): StoryRenderPlan {
  const voiceLang = voiceLanguageFor(input.lang);
  if (!voiceLang)
    return {
      ok: false,
      missing: [{ sceneRef: "*", reasons: [`${input.lang} is not a narration language`] }],
    };
  const pad = scenePadMs(input.ageBand);
  // Cover/back pages without text in this language are not part of the reading.
  const candidates = input.scenes.filter(
    (s) => s.kind === "page" || typeof s.text[input.lang] === "string",
  );

  const missing: MissingScene[] = [];
  const out: RenderScene[] = [];
  let total = 0;
  for (const scene of candidates) {
    const reasons: string[] = [];
    if (!scene.readiness.text.ok) reasons.push(scene.readiness.text.message);
    else if (!scene.readiness.takesReady) {
      for (const l of scene.readiness.lines) {
        if (!l.usable) reasons.push(`${l.slot}: ${l.problem.replace("_", " ")}`);
      }
    } else if (!sceneAudioFresh(scene.audio, scene.readiness))
      reasons.push("scene audio not built");
    if (!scene.artPath) reasons.push("no selected art");
    if (reasons.length) {
      // A sample is the leading run of ready scenes: it stops at the first
      // scene that is not ready, and refuses only when the very first is not.
      if (input.sample && out.length > 0) break;
      missing.push({ sceneRef: scene.sceneRef, reasons });
      if (input.sample) break;
      continue;
    }
    const audio = scene.audio as SceneAudio;
    const length = audio.durationMs + pad;
    if (input.sample && out.length > 0 && total + length > SAMPLE_MAX_MS) break;
    total += length;
    out.push({
      sceneRef: scene.sceneRef,
      visualPath: path.resolve(input.cuentosRoot, ...(scene.artPath as string).split("/")),
      visualKind: "image",
      audioPath: path.resolve(input.mediaRoot, ...audio.wavPath.split("/")),
      audioDurationMs: audio.durationMs,
      padAfterMs: pad,
      captionText: scene.text[input.lang] as string,
      alignment: audio.alignment,
      camera: cameraFor(out.length),
    });
  }
  if (missing.length) return { ok: false, missing };
  if (!out.length)
    return { ok: false, missing: [{ sceneRef: "*", reasons: ["the story has no scenes"] }] };

  return {
    ok: true,
    sceneRefs: out.map((s) => s.sceneRef),
    estimatedMs: total,
    request: {
      ownerKind: "story",
      ownerRef: `story:${input.slug}`,
      language: voiceLang,
      format: input.format,
      scenes: out,
      musicPath: input.musicPath ?? null,
      burnCaptions: false,
      outFolder: storyVideoFolder(input.slug, input.lang),
      outName: `${input.slug}-${input.lang}-${input.format}${input.sample ? "-sample" : ""}`,
    },
  };
}
