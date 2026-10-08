"use server";
import { upsertReturning } from "@/db/mutations";

/**
 * Per-video mutations from the UI: read state, pinning, and deletion (YouTube
 * corpus), and — below — starting video renders (build 4 §3.B).
 */

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { analyses, outlines, transcripts, videoReads, videos } from "@/db/schema";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { enqueueRender, VIDEO_FORMATS, type RenderRequest, type VideoFormat } from "@/lib/video";
import { buildScriptRenderRequest } from "@/lib/video/from-script";
import { getRender, planRequest } from "@/lib/video/queries";
import {
  listMusicTracks,
  parseMusicDb,
  resolveMusicPath,
  type MusicTrack,
} from "@/lib/media/music";
import { mediaRoot, toRelative } from "@/lib/storage/root";
import { VOICE_LANGUAGES, type VoiceLanguage } from "@/lib/voice/contract";

/**
 * Pinning is the counterweight to an unbounded feed: the corpus only grows, and
 * without it the videos worth returning to sink below the fold within a week.
 */
export async function setVideoPinned(videoId: number, pinned: boolean): Promise<void> {
  // Per-user since PR-25: pinning is one reader's shortlist, not a property of
  // the video. The upsert is needed because pinning can precede reading.
  const user = await requireUser();
  await upsertReturning(
    db,
    videoReads,
    { videoId, userId: user.id, pinned },
    {
      target: [videoReads.videoId, videoReads.userId],
      set: { pinned },
    },
  );
  revalidatePath("/youtube");
  revalidatePath(`/youtube/video/${videoId}`);
}

/** Explicit unread, so a video opened by accident can be put back in the queue. */
export async function setVideoUnread(videoId: number): Promise<void> {
  const user = await requireUser();
  // An UPDATE, not an upsert: with no row the video is already unread, and
  // inserting one would only record that fact more expensively.
  await db
    .update(videoReads)
    .set({ readAt: null })
    .where(and(eq(videoReads.videoId, videoId), eq(videoReads.userId, user.id)));
  revalidatePath("/youtube");
  revalidatePath(`/youtube/video/${videoId}`);
}

/**
 * Delete a video and everything derived from it, in one transaction (PR-31).
 *
 * Still ordered children-first inside the transaction. Outlines hang off
 * analyses rather than off the video, so their ids are collected before the
 * analyses rows go — the ordering is what makes the statements expressible at
 * all, the transaction is what makes them atomic.
 */
export async function deleteVideo(videoId: number): Promise<void> {
  // Reading, pinning and marking unread are free and stay open to an employee.
  // Deleting destroys analyses the owner paid for, so it does not.
  await requireOwner("delete a video");

  await db.transaction(async (tx) => {
    const analysisRows = await tx
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.videoId, videoId));
    const analysisIds = analysisRows.map((row) => row.id);

    if (analysisIds.length > 0) {
      await tx.delete(outlines).where(inArray(outlines.analysisId, analysisIds));
    }
    await tx.delete(analyses).where(eq(analyses.videoId, videoId));
    await tx.delete(transcripts).where(eq(transcripts.videoId, videoId));
    await tx.delete(videoReads).where(eq(videoReads.videoId, videoId));
    await tx.delete(videos).where(eq(videos.id, videoId));
  });

  revalidatePath("/youtube");
  // Outside the transaction on purpose: redirect() throws a control-flow error
  // that Next catches, and throwing it inside the callback would roll back a
  // delete that had already succeeded.
  redirect("/youtube");
}

// ---------------------------------------------------------------------------
// Video renders (build 4 §3.B): start a render without blocking the request.
// ---------------------------------------------------------------------------

export type RenderActionResult = { ok: true; renderId: number } | { ok: false; error: string };

export type StartRenderInput = {
  ownerKind: string;
  ownerRef: string;
  language: string;
  format: string;
  burnCaptions?: boolean;
  /** Build 5 E: a music bed, relative to MEDIA_ROOT (see `src/lib/media/music.ts`). */
  musicPath?: string | null;
  /** Music level in dB, clamped to −24 … −12; default −18. */
  musicDb?: number | string | null;
};

/** Music beds the render forms offer (owner only; empty for anyone else). */
export async function listMusicAction(): Promise<MusicTrack[]> {
  if (await ownerOrError()) return [];
  return listMusicTracks();
}

/** The submitted music choice as absolute path + level, or an error. */
function musicChoice(
  input: Pick<StartRenderInput, "musicPath" | "musicDb">,
): { ok: true; musicPath: string | null; musicDb?: number } | { ok: false; error: string } {
  if (!input.musicPath) return { ok: true, musicPath: null };
  const abs = resolveMusicPath(input.musicPath, mediaRoot());
  if (!abs) return { ok: false, error: `Not a music file under MEDIA_ROOT: "${input.musicPath}".` };
  return { ok: true, musicPath: abs, musicDb: parseMusicDb(input.musicDb) };
}

/**
 * Queue the render and hand the work to `after()`, so the action returns the
 * row id at once and the page polls `/api/video/renders/<id>`. Outside a
 * request (a test, a script) there is no `after()` scope and the promise just
 * runs on. Returns errors instead of throwing: production strips a thrown
 * action's message.
 */
async function queueInBackground(req: RenderRequest): Promise<RenderActionResult> {
  const { renderId, done } = await enqueueRender(req);
  const settle = () => done.then(() => undefined).catch(() => undefined);
  try {
    after(settle);
  } catch {
    void settle();
  }
  return { ok: true, renderId };
}

async function ownerOrError(): Promise<string | null> {
  try {
    await requireOwner("render a video");
    return null;
  } catch (err) {
    if (err instanceof ForbiddenError) return err.message;
    throw err;
  }
}

export async function startRenderAction(input: StartRenderInput): Promise<RenderActionResult> {
  const denied = await ownerOrError();
  if (denied) return { ok: false, error: denied };
  if (!VIDEO_FORMATS.includes(input.format as VideoFormat)) {
    return { ok: false, error: `Unknown format "${input.format}".` };
  }
  if (!VOICE_LANGUAGES.includes(input.language as VoiceLanguage)) {
    return { ok: false, error: `Unknown language "${input.language}".` };
  }
  if (input.ownerKind !== "script") {
    return {
      ok: false,
      error: `Renders of a ${input.ownerKind} are started where it is edited; this button renders scripts.`,
    };
  }
  const match = /^script:(\d{1,9})$/.exec(input.ownerRef);
  if (!match) return { ok: false, error: `Not a script reference: "${input.ownerRef}".` };
  const music = musicChoice(input);
  if (!music.ok) return music;
  try {
    const req = await buildScriptRenderRequest({
      scriptId: Number(match[1]),
      language: input.language as VoiceLanguage,
      format: input.format as VideoFormat,
      burnCaptions: !!input.burnCaptions,
      musicPath: music.musicPath,
      musicDb: music.musicDb,
    });
    const result = await queueInBackground(req);
    revalidatePath("/video");
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Render again: a script is rebuilt from its current takes; anything else repeats the stored request. */
export async function rerenderAction(renderId: number): Promise<RenderActionResult> {
  const denied = await ownerOrError();
  if (denied) return { ok: false, error: denied };
  if (!Number.isSafeInteger(renderId) || renderId <= 0)
    return { ok: false, error: "Unknown render." };
  const row = await getRender(renderId);
  if (!row) return { ok: false, error: `Render ${renderId} does not exist.` };
  const stored = planRequest(row);
  if (row.ownerKind === "script") {
    return startRenderAction({
      ownerKind: row.ownerKind,
      ownerRef: row.ownerRef,
      language: row.language,
      format: row.format,
      burnCaptions: stored?.burnCaptions ?? false,
      ...(stored?.musicPath
        ? { musicPath: toRelative(mediaRoot(), stored.musicPath), musicDb: stored.musicDb }
        : {}),
    });
  }
  if (!stored) return { ok: false, error: `Render ${renderId} has no stored request to repeat.` };
  try {
    const result = await queueInBackground(stored);
    revalidatePath("/video");
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
