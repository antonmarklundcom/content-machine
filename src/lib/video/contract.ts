/**
 * Video render contract (build 4, docs/PLAN-build4.md §2). The story studio and
 * the script studio build a `RenderRequest`; `src/lib/video` turns it into an
 * MP4 plus SRT/VTT with ffmpeg. Change it only additively.
 */
import type { VoiceLanguage, WordTiming } from "@/lib/voice/contract";

export const VIDEO_FORMATS = ["16x9", "9x16", "1x1"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const RENDER_OWNER_KINDS = ["story", "script", "post"] as const;
export type RenderOwnerKind = (typeof RENDER_OWNER_KINDS)[number];

export const RENDER_STATUSES = ["queued", "rendering", "done", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** Camera move over a still. `none` holds the frame. */
export const CAMERA_MOVES = [
  "none",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export type RenderScene = {
  /** Stable id (`"S01"`), echoed in errors and the plan. */
  sceneRef: string;
  /** Absolute path to a still image or a video clip. */
  visualPath: string;
  visualKind: "image" | "video";
  /** Absolute path to the narration for this scene (any ffmpeg-readable audio), or null for silence. */
  audioPath: string | null;
  /** The measured narration length. Scene length = audio + padding; never time-stretched (§1.7). */
  audioDurationMs: number;
  /** Silence after the narration before the next scene, default 600 ms (bedtime pacing: 900+). */
  padAfterMs?: number;
  /** Caption text for this scene; split into cues by the renderer. */
  captionText: string;
  /** Word timings relative to this scene's audio start, when the voice provider gave them. */
  alignment?: WordTiming[] | null;
  camera?: CameraMove;
};

export type RenderRequest = {
  ownerKind: RenderOwnerKind;
  ownerRef: string;
  language: VoiceLanguage;
  format: VideoFormat;
  scenes: RenderScene[];
  /** Optional music bed, ducked under narration. Absolute path. */
  musicPath?: string | null;
  /** Music level under narration in dB, default -18. */
  musicDb?: number;
  /** Burn captions into the picture as well as writing SRT/VTT. Default false (soft only). */
  burnCaptions?: boolean;
  /** Folder for outputs, relative to MEDIA_ROOT. */
  outFolder: string;
  /** File name stem, e.g. `"tito-es-PY-16x9"`. */
  outName: string;
  /** Phase B (additive): the brand the outputs are registered under in the media library. */
  brandId?: string | null;
};

export type RenderResult = {
  renderId: number;
  /** All relative to MEDIA_ROOT. */
  videoPath: string;
  srtPath: string;
  vttPath: string;
  durationMs: number;
};
