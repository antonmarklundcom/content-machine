/**
 * The video renderer's public surface (build 4, docs/PLAN-build4.md §3.B).
 * Callers outside `src/lib/video` import only from here.
 */
import "server-only";
import type { RenderRequest, RenderResult } from "./contract";
import { enqueueRender } from "./render";

export * from "./contract";
export { enqueueRender, RenderRefusedError, type RenderPlan } from "./render";

/**
 * Render one video with ffmpeg: frame every still safely inside the format
 * (blurred fill, never crop characters), apply the camera move, lay narration
 * per scene with its measured length plus padding, duck the music bed, write
 * MP4 + SRT + VTT under MEDIA_ROOT, register them as assets, and record a
 * `video_renders` row.
 *
 * Waits for the render to finish (minutes for a long video). A page should
 * call `enqueueRender()` instead, which returns the row id at once.
 */
export async function renderVideo(req: RenderRequest): Promise<RenderResult> {
  const { done } = await enqueueRender(req);
  return done;
}
