import { insertIfAbsent, insertReturning } from "@/db/mutations";
import "server-only";
import { assertOnPc } from "@/lib/pc-only";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assets, videoRenders } from "@/db/schema";
import { registerFile, sha256File } from "@/lib/media/register";
import { storeImmutableOutput } from "@/lib/media/immutable-output";
import { mediaRoot, mediaRootMessage, mediaRootStatus, splitRelative } from "@/lib/storage/root";

import { resolveCameras } from "./camera";
import { planCues, toSrt, toVtt, type Cue } from "./captions";
import {
  CAMERA_MOVES,
  VIDEO_FORMATS,
  type CameraMove,
  type RenderRequest,
  type RenderResult,
} from "./contract";
import { audioArgs, concatList, muxArgs, sceneArgs, type EncodeOptions } from "./ffmpeg-args";
import { hasSubtitlesFilter, probeDurationMs, renderToolsAvailable, runFfmpeg } from "./run";
import { planTimeline, type Timeline } from "./timeline";

/**
 * The renderer (PLAN-build4 §3.B): one `video_renders` row through
 * `queued → rendering → done | failed`, ffmpeg in a temp dir, MP4 + SRT + VTT
 * under `MEDIA_ROOT/<outFolder>`, each registered as an asset.
 *
 * Output names carry the render id (`<outName>-r<id>.mp4`): a re-render never
 * overwrites a file another asset row points at.
 */

/** What `video_renders.plan` holds: the request as given and what was resolved from it. */
export type RenderPlan = {
  request: RenderRequest;
  timeline?: Timeline;
  cameras?: CameraMove[];
  cues?: Cue[];
};

/** The final file may differ from the timeline by AAC priming and frame rounding; more than this is a bug. */
export const DURATION_TOLERANCE_MS = 500;

export class RenderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderRefusedError";
  }
}

function encodeOptions(): EncodeOptions {
  const preset = process.env.VIDEO_X264_PRESET?.trim();
  return { preset: preset && /^[a-z]+$/.test(preset) ? preset : "medium" };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Every reason the request cannot render, before any work starts. */
export async function checkRequest(req: RenderRequest): Promise<string[]> {
  const problems: string[] = [];
  if (!VIDEO_FORMATS.includes(req.format)) problems.push(`Unknown format "${req.format}".`);
  if (!req.scenes?.length) problems.push("The request has no scenes.");
  if (!splitRelative(req.outFolder ?? ""))
    problems.push(`Unsafe output folder "${req.outFolder}".`);
  if (!req.outName || /[/\\\0]/.test(req.outName) || req.outName.startsWith(".")) {
    problems.push(`Unsafe output name "${req.outName}".`);
  }
  for (const scene of req.scenes ?? []) {
    if (scene.camera && !CAMERA_MOVES.includes(scene.camera)) {
      problems.push(`Scene ${scene.sceneRef}: unknown camera move "${scene.camera}".`);
    }
    if (!(await exists(scene.visualPath))) {
      problems.push(`Scene ${scene.sceneRef}: visual not found (${scene.visualPath}).`);
    }
    if (scene.audioPath && !(await exists(scene.audioPath))) {
      problems.push(`Scene ${scene.sceneRef}: audio not found (${scene.audioPath}).`);
    }
  }
  if (req.musicPath && !(await exists(req.musicPath))) {
    problems.push(`Music bed not found (${req.musicPath}).`);
  }
  return problems;
}

/** A `queued` row holding the request, so a re-render can repeat it. */
export async function createRenderRow(req: RenderRequest): Promise<number> {
  const plan: RenderPlan = { request: req };
  const [row] = await insertReturning(
    db,
    videoRenders,
    {
      ownerKind: req.ownerKind,
      ownerRef: req.ownerRef,
      language: req.language,
      format: req.format,
      status: "queued",
      plan,
    },
    { id: videoRenders.id },
  );
  return row.id;
}

/**
 * SRT/VTT are text, which the media library's sniffer does not take, so the
 * caption rows are written here: kind `document`, deduped by sha256 like
 * `registerFile`. Returns the asset id.
 */
async function registerCaptionFile(
  rel: string,
  absolute: string,
  mime: string,
  meta: { brandId: string | null; sourceRef: string; tags: string[] },
): Promise<number> {
  const sha = await sha256File(absolute);
  const { size } = await stat(absolute);
  const [created] = await insertIfAbsent(
    db,
    assets,
    {
      brandId: meta.brandId,
      kind: "document",
      mime,
      bytes: size,
      sha256: sha,
      localPath: rel,
      source: "import",
      sourceRef: meta.sourceRef,
      tags: meta.tags,
    },
    { target: assets.sha256 },
    { id: assets.id },
  );
  if (created) return created.id;
  const [found] = await db.select().from(assets).where(eq(assets.sha256, sha)).limit(1);
  const old = found.localPath ? splitRelative(found.localPath) : null;
  if (!old || !(await exists(path.join(mediaRoot(), ...old)))) {
    await db
      .update(assets)
      .set({ localPath: rel, updatedAt: new Date() })
      .where(eq(assets.id, found.id));
  }
  return found.id;
}

async function markFailed(id: number, message: string): Promise<void> {
  await db
    .update(videoRenders)
    .set({ status: "failed", error: message.slice(0, 1024), finishedAt: new Date() })
    .where(eq(videoRenders.id, id));
}

/** Render the row `id` from `req`. Never throws for a render problem: the row says `failed` and why, and so does the rejection. */
export async function runRender(id: number, req: RenderRequest): Promise<RenderResult> {
  let tmp: string | null = null;
  try {
    const drive = await mediaRootStatus();
    if (drive !== "ok") throw new RenderRefusedError(mediaRootMessage(drive));
    if (!(await renderToolsAvailable())) {
      throw new RenderRefusedError(
        "ffmpeg/ffprobe are not installed. Install ffmpeg (winget install ffmpeg) or set FFMPEG_PATH and FFPROBE_PATH.",
      );
    }
    const problems = await checkRequest(req);
    if (problems.length) throw new RenderRefusedError(problems.join(" "));
    if (req.burnCaptions && !(await hasSubtitlesFilter())) {
      throw new RenderRefusedError(
        "Burning captions needs an ffmpeg built with libass (the `subtitles` filter). Install a full ffmpeg build, or render without burned captions — the SRT/VTT files are written either way.",
      );
    }

    const timeline = planTimeline(req.scenes);
    const cameras = resolveCameras(req.scenes);
    const cues = planCues(req.scenes, timeline);
    const plan: RenderPlan = { request: req, timeline, cameras, cues };
    await db
      .update(videoRenders)
      .set({ status: "rendering", startedAt: new Date(), error: null, plan })
      .where(eq(videoRenders.id, id));

    tmp = await mkdtemp(path.join(tmpdir(), "ce-render-"));
    const encode = encodeOptions();

    const sceneFiles: string[] = [];
    for (let i = 0; i < req.scenes.length; i++) {
      const scene = req.scenes[i];
      const name = `scene-${String(i + 1).padStart(3, "0")}.mp4`;
      try {
        await runFfmpeg(
          sceneArgs({
            visualPath: scene.visualPath,
            visualKind: scene.visualKind,
            format: req.format,
            camera: cameras[i],
            frames: timeline.scenes[i].frames,
            outFile: name,
            encode,
          }),
          tmp,
        );
      } catch (err) {
        throw new Error(`Scene ${scene.sceneRef}: ${(err as Error).message}`);
      }
      sceneFiles.push(name);
    }

    await runFfmpeg(
      audioArgs({
        scenes: req.scenes.map((s, i) => ({
          audioPath: s.audioPath,
          durationMs: timeline.scenes[i].durationMs,
        })),
        totalMs: timeline.totalMs,
        musicPath: req.musicPath,
        musicDb: req.musicDb,
        outFile: "audio.wav",
      }),
      tmp,
    );

    const srt = toSrt(cues);
    const vtt = toVtt(cues);
    await writeFile(path.join(tmp, "captions.srt"), srt, "utf8");
    await writeFile(path.join(tmp, "captions.vtt"), vtt, "utf8");
    await writeFile(path.join(tmp, "scenes.txt"), concatList(sceneFiles), "utf8");

    await runFfmpeg(
      muxArgs({
        listFile: "scenes.txt",
        audioFile: "audio.wav",
        totalMs: timeline.totalMs,
        outFile: "out.mp4",
        format: req.format,
        burnSrt: req.burnCaptions ? "captions.srt" : null,
        encode,
      }),
      tmp,
    );

    const durationMs = await probeDurationMs(path.join(tmp, "out.mp4"));
    if (Math.abs(durationMs - timeline.totalMs) > DURATION_TOLERANCE_MS) {
      throw new Error(
        `The rendered file is ${durationMs} ms long but the timeline is ${timeline.totalMs} ms.`,
      );
    }

    const folder = splitRelative(req.outFolder)!;
    const outDir = path.join(mediaRoot(), ...folder);
    const stem = `${req.outName}-r${id}`;
    const relBase = `${folder.join("/")}/${stem}`;
    for (const [extension, source] of [
      ["mp4", "out.mp4"],
      ["srt", "captions.srt"],
      ["vtt", "captions.vtt"],
    ] as const) {
      await storeImmutableOutput(`${relBase}.${extension}`, { file: path.join(tmp, source) });
    }

    const sourceRef = `render:${id}`;
    const tags = ["render", req.format, req.language.toLowerCase()];
    const video = await registerFile(`${relBase}.mp4`, {
      brandId: req.brandId ?? null,
      source: "import",
      sourceRef,
      tags,
      notes: `${req.ownerKind} ${req.ownerRef}`,
    });
    if (video.status !== "created" && video.status !== "existing") {
      throw new Error(`Could not register the video: ${video.message}`);
    }
    const capMeta = { brandId: req.brandId ?? null, sourceRef, tags: [...tags, "captions"] };
    const srtAssetId = await registerCaptionFile(
      `${relBase}.srt`,
      path.join(outDir, `${stem}.srt`),
      "application/x-subrip",
      capMeta,
    );
    const vttAssetId = await registerCaptionFile(
      `${relBase}.vtt`,
      path.join(outDir, `${stem}.vtt`),
      "text/vtt",
      capMeta,
    );

    await db
      .update(videoRenders)
      .set({
        status: "done",
        outputAssetId: video.asset.id,
        srtAssetId,
        vttAssetId,
        durationMs,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(videoRenders.id, id));

    return {
      renderId: id,
      videoPath: `${relBase}.mp4`,
      srtPath: `${relBase}.srt`,
      vttPath: `${relBase}.vtt`,
      durationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(id, message).catch(() => {});
    throw err;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// one render at a time per process
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

/**
 * Renders are CPU-bound and run one at a time in this process: a second
 * request waits as `queued`. Returns the row id at once and the outcome later.
 */
export async function enqueueRender(
  req: RenderRequest,
): Promise<{ renderId: number; done: Promise<RenderResult> }> {
  assertOnPc("Rendering a video");
  const renderId = await createRenderRow(req);
  const done = chain.then(() => runRender(renderId, req));
  chain = done.catch(() => {});
  return { renderId, done };
}
