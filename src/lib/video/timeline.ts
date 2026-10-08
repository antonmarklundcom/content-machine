import type { RenderScene, VideoFormat } from "./contract";

/**
 * The timeline planner (PLAN-build4 §1.7). Pure: scene starts and ends come
 * from the measured narration plus padding, never from a target length, and
 * nothing is ever time-stretched. Each language is timed from its own audio.
 */

export const FPS = 30;
export const DEFAULT_PAD_AFTER_MS = 600;

export const FORMAT_SIZE: Record<VideoFormat, { width: number; height: number }> = {
  "16x9": { width: 1920, height: 1080 },
  "9x16": { width: 1080, height: 1920 },
  "1x1": { width: 1080, height: 1080 },
};

export type TimelineScene = {
  sceneRef: string;
  startMs: number;
  endMs: number;
  /** The narration's measured length (0 for a silent scene). */
  audioMs: number;
  padMs: number;
  durationMs: number;
  /** Frame boundaries come from the cumulative times, so per-scene rounding never drifts. */
  startFrame: number;
  frames: number;
};

export type Timeline = {
  scenes: TimelineScene[];
  totalMs: number;
  totalFrames: number;
  fps: number;
};

/** A silent scene with no padding still needs a length to be seen: one second. */
const SILENT_SCENE_MS = 1000;

function cleanMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback;
}

export function msToFrame(ms: number, fps = FPS): number {
  return Math.round((ms * fps) / 1000);
}

/** Scene starts/ends from measured audio + `padAfterMs` (default 600 ms). */
export function planTimeline(scenes: RenderScene[], fps = FPS): Timeline {
  const out: TimelineScene[] = [];
  let cursor = 0;
  let frameCursor = 0;
  for (const scene of scenes) {
    const audioMs = scene.audioPath ? cleanMs(scene.audioDurationMs, 0) : 0;
    const padMs = cleanMs(scene.padAfterMs, DEFAULT_PAD_AFTER_MS);
    let durationMs = audioMs + padMs;
    if (durationMs <= 0) durationMs = SILENT_SCENE_MS;
    const startMs = cursor;
    const endMs = startMs + durationMs;
    const endFrame = Math.max(frameCursor + 1, msToFrame(endMs, fps));
    out.push({
      sceneRef: scene.sceneRef,
      startMs,
      endMs,
      audioMs,
      padMs,
      durationMs,
      startFrame: frameCursor,
      frames: endFrame - frameCursor,
    });
    cursor = endMs;
    frameCursor = endFrame;
  }
  return { scenes: out, totalMs: cursor, totalFrames: frameCursor, fps };
}
