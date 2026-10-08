import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { clips, type Clip, type ClipPurpose } from "@/db/schema";
import { transcribeClip, TRANSCRIBE_MAX_INLINE_BYTES, TranscribeRefusedError } from "@/lib/ai";
import { getAsset, getClip } from "@/lib/bridge";
import { registerFile } from "@/lib/media/register";
import { SpendCapExceededError } from "@/lib/spend";
import { captureFolder } from "@/lib/storage/paths";
import {
  mediaRoot,
  mediaRootMessage,
  mediaRootStatus,
  resolveMediaFile,
  splitRelative,
} from "@/lib/storage/root";

import { binaryAvailable } from "./binaries";
import { shrinkForTranscript } from "./shrink";
import { downloadTelegramFile } from "./telegram";
import { downloadWithYtDlp } from "./ytdlp";

/**
 * Clip fetch + transcript (PLAN.md §1.44, §6.S17): download a saved reel into
 * `captures/<clip-id>/`, register it as an asset (O10), then one Gemini
 * Flash-Lite call through the spend cap (O11's `transcribeClip`), and store
 * the transcript, on-screen text, summary and claims on the clip.
 *
 * Research only — the asset is tagged `research` and never republished.
 * Failure keeps the URL + note floor (§1.7) and sets `clips.error`; it never
 * touches `clips.status`, which belongs to the YouTube ingest pipeline.
 * Re-runnable: a clip whose media is already registered and on the drive is
 * not downloaded again.
 */

/** Purposes the batch job fetches without a click (§1.44). Never `inspo`. */
export const AUTO_FETCH_PURPOSES: readonly ClipPurpose[] = ["fact_check", "competitor"];

export type FetchOutcome =
  | { status: "done"; clipId: number; assetId: number; costUsd: number; downloaded: boolean }
  | { status: "failed"; clipId: number; error: string; spendCap?: boolean }
  /** The drive is unplugged: nothing written to the clip, try again later. */
  | { status: "missing"; clipId: number; message: string };

export class ClipNotFoundError extends Error {
  constructor(id: number) {
    super(`No clip ${id}.`);
    this.name = "ClipNotFoundError";
  }
}

async function fail(clipId: number, error: string, spendCap = false): Promise<FetchOutcome> {
  const message = error.slice(0, 1024);
  await db.update(clips).set({ error: message }).where(eq(clips.id, clipId));
  return { status: "failed", clipId, error: message, ...(spendCap ? { spendCap } : {}) };
}

/** The clip's already-registered media, when the file is still on the drive. */
async function existingMedia(clip: Clip, root: string) {
  if (!clip.mediaAssetId) return null;
  const asset = await getAsset(clip.mediaAssetId);
  if (!asset?.localPath) return null;
  const segments = splitRelative(asset.localPath);
  const file = segments ? await resolveMediaFile(segments, root) : null;
  return file ? { asset, file } : null;
}

/** Fetch (if needed) and transcribe one clip. Throws only for a missing clip. */
export async function fetchClip(clipId: number): Promise<FetchOutcome> {
  const clip = await getClip(clipId);
  if (!clip) throw new ClipNotFoundError(clipId);

  const root = mediaRoot();
  const rootStatus = await mediaRootStatus(root);
  if (rootStatus === "missing") {
    return { status: "missing", clipId, message: mediaRootMessage(rootStatus) };
  }

  let media = await existingMedia(clip, root);
  let downloaded = false;
  let caption: string | null = null;

  if (!media) {
    const folder = captureFolder(clip.id);
    const dir = path.join(root, ...folder.split("/"));
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      return fail(clip.id, `Cannot write ${folder} on the media drive: ${(err as Error).message}`);
    }

    let file: string;
    if (clip.telegramFileId) {
      const got = await downloadTelegramFile(clip.telegramFileId, dir);
      if (!got.ok) return fail(clip.id, got.error);
      file = got.file;
    } else {
      const got = await downloadWithYtDlp(clip.url, dir, {
        ffmpeg: await binaryAvailable("ffmpeg"),
      });
      if (!got.ok) return fail(clip.id, got.error);
      file = got.file;
      caption = got.caption;
    }
    downloaded = true;

    const registered = await registerFile(file, {
      brandId: clip.brandId,
      source: clip.telegramFileId ? "telegram" : "capture",
      sourceRef: clip.telegramFileId ? `clip:${clip.id}` : clip.url,
      tags: ["research", clip.purpose],
      notes: `Fetched for research from clip ${clip.id}. Not for republishing (PLAN.md §1.44).`,
    });
    if (registered.status === "missing") {
      return { status: "missing", clipId: clip.id, message: registered.message };
    }
    if (registered.status === "rejected") return fail(clip.id, registered.message);
    await db.update(clips).set({ mediaAssetId: registered.asset.id }).where(eq(clips.id, clip.id));
    media = { asset: registered.asset, file };
  }

  const shrunk =
    media.asset.kind === "video" || media.asset.kind === "audio"
      ? await shrinkForTranscript(media.file, TRANSCRIBE_MAX_INLINE_BYTES)
      : { ok: true as const, file: media.file };
  if (!shrunk.ok) return fail(clip.id, shrunk.error);

  const context = [clip.note, caption].filter((s) => s?.trim()).join("\n") || null;
  try {
    const result = await transcribeClip({
      path: shrunk.file,
      mime: shrunk.file === media.file ? media.asset.mime : "video/mp4",
      durationSec: media.asset.durationSec,
      context,
    });
    await db
      .update(clips)
      .set({
        transcript: result.transcript,
        postText: result.postText || caption,
        summary: result.summary,
        claims: result.claims,
        fetchedAt: new Date(),
        error: null,
      })
      .where(eq(clips.id, clip.id));
    return {
      status: "done",
      clipId: clip.id,
      assetId: media.asset.id,
      costUsd: result.costUsd,
      downloaded,
    };
  } catch (err) {
    if (err instanceof SpendCapExceededError) return fail(clip.id, err.message, true);
    if (err instanceof TranscribeRefusedError) return fail(clip.id, err.message);
    return fail(clip.id, `Transcription failed: ${(err as Error).message}`);
  }
}

/**
 * Clips the batch job should handle (§1.44): purpose `fact_check` or
 * `competitor`, never fetched, oldest save first. A clip that failed is left
 * for a click (or `--retry-failed`): automatic retry is backlog (§10).
 */
export async function eligibleClipIds(
  options: { limit?: number; retryFailed?: boolean } = {},
): Promise<number[]> {
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(
      and(
        inArray(clips.purpose, [...AUTO_FETCH_PURPOSES]),
        isNull(clips.fetchedAt),
        options.retryFailed ? undefined : isNull(clips.error),
      ),
    )
    .orderBy(asc(clips.savedAt), asc(clips.id))
    .limit(Math.max(1, Math.min(options.limit ?? 20, 500)));
  return rows.map((r) => r.id);
}

export type BatchResult = {
  outcomes: FetchOutcome[];
  costUsd: number;
  stoppedEarly: string | null;
};

/**
 * The `npm run clips:fetch` loop. Stops at the first unplugged drive or
 * spend-cap refusal: both would refuse every remaining clip the same way.
 */
export async function fetchEligibleClips(
  options: { limit?: number; retryFailed?: boolean; onOutcome?: (o: FetchOutcome) => void } = {},
): Promise<BatchResult> {
  const outcomes: FetchOutcome[] = [];
  let costUsd = 0;
  for (const id of await eligibleClipIds(options)) {
    const outcome = await fetchClip(id);
    outcomes.push(outcome);
    options.onOutcome?.(outcome);
    if (outcome.status === "done") costUsd += outcome.costUsd;
    if (outcome.status === "missing") return { outcomes, costUsd, stoppedEarly: outcome.message };
    if (outcome.status === "failed" && outcome.spendCap) {
      return { outcomes, costUsd, stoppedEarly: outcome.error };
    }
  }
  return { outcomes, costUsd, stoppedEarly: null };
}
