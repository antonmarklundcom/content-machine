import { updateReturning, upsertReturning } from "@/db/mutations";
import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  CLIP_PURPOSES,
  clips,
  transcripts,
  type Clip,
  type ClipPurpose,
  type ClipSource,
  type Video,
} from "@/db/schema";
import { DEFAULT_MODEL } from "@/lib/analysis/pricing";
import { analyzeVideo } from "@/lib/analysis/run";
import { ingestUrl } from "@/lib/ingest";
import { estimateAnalysisCostUsd, SpendCapExceededError, withSpendCap } from "@/lib/spend";
import { parseYouTubeUrl } from "@/lib/youtube/url";
import { canonicalClipUrl, CLIP_URL_LIMIT, platformForUrl } from "./url";

/**
 * The write half of the clip inbox (PLAN.md §5.O2.1–2). Reads live in
 * `src/lib/bridge/clips.ts`; this is the only place rows are created or moved
 * between statuses.
 */

export type SaveClipInput = {
  url: string;
  note?: string | null;
  /** Build 3 capture fields (PLAN.md §1.43). Set on insert only, like every field but the note. */
  brandId?: string | null;
  purpose?: ClipPurpose | null;
  tags?: readonly string[];
  source?: ClipSource;
};

export type SaveClipResult =
  { ok: true; clip: Clip; created: boolean } | { ok: false; error: string };

/** `clips.note` is text, but a "why I saved this" line is a line. */
const NOTE_LIMIT = 500;

function cleanNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.length <= NOTE_LIMIT ? trimmed : trimmed.slice(0, NOTE_LIMIT);
}

/** Lower-case, no `#`, no blanks, no repeats — the shape `clips.tags` holds and the tag filter matches. */
export function normalizeTags(tags: readonly string[] | string | null | undefined): string[] {
  const list = typeof tags === "string" ? tags.split(/[\s,]+/) : (tags ?? []);
  const out: string[] = [];
  for (const raw of list) {
    const tag = String(raw).trim().replace(/^#+/, "").toLowerCase().slice(0, 64);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 20);
}

export function isClipPurpose(value: unknown): value is ClipPurpose {
  return typeof value === "string" && (CLIP_PURPOSES as readonly string[]).includes(value);
}

/**
 * Store the link. Nothing else — no fetch, no ingest, no network at all.
 *
 * Capture is time-sensitive and processing is not (§1.6), so the row lands
 * first and everything that can fail happens after it. A re-save updates the
 * note and touches nothing else: re-sharing a clip you already logged must not
 * reset a video that has since been ingested, and must never insert a second
 * row (§5.O2.1).
 */
export async function saveClip(input: SaveClipInput): Promise<SaveClipResult> {
  const url = canonicalClipUrl(input.url);
  if (!url) return { ok: false, error: "Not a usable http(s) URL." };
  if (url.length > CLIP_URL_LIMIT) {
    return { ok: false, error: `URL is longer than ${CLIP_URL_LIMIT} characters.` };
  }

  const note = cleanNote(input.note);
  const platform = platformForUrl(url);

  // Asked before writing, because the row itself cannot answer it afterwards:
  // a second save of an Instagram clip is byte-identical to a first one, and
  // reporting "created" for it would tell the caller (and the Shortcut's
  // success message) something untrue.
  const existing = await db.select({ id: clips.id }).from(clips).where(eq(clips.url, url)).limit(1);

  const [row] = await upsertReturning(
    db,
    clips,
    {
      url,
      platform,
      note,
      brandId: input.brandId || null,
      purpose: input.purpose ?? "other",
      tags: normalizeTags(input.tags),
      source: input.source ?? "web",
    },
    {
      target: clips.url,
      set: {
        // A re-save with no note keeps the note the clip already had — the
        // share sheet sends an empty field far more often than a correction.
        note: sql`coalesce(${note}, ${clips.note})`,
      },
    },
  );

  return { ok: true, clip: row, created: existing.length === 0 };
}

export type ClipCaptureFields = { brandId: string | null; purpose: ClipPurpose; tags: string[] };

/**
 * The inbox's inline edit (PLAN.md §6.S16): brand, purpose and tags of one
 * clip. A deliberate edit, so unlike a re-save it may overwrite them.
 */
export async function updateClipCapture(
  clipId: number,
  fields: ClipCaptureFields,
): Promise<Clip | null> {
  const [row] = await updateReturning(
    db,
    clips,
    {
      brandId: fields.brandId || null,
      purpose: fields.purpose,
      tags: normalizeTags(fields.tags),
    },
    eq(clips.id, clipId),
  );
  return row ?? null;
}

async function markFailed(clipId: number, error: string): Promise<Clip> {
  const [row] = await updateReturning(
    db,
    clips,
    { status: "failed", error: error.slice(0, 1024) },
    eq(clips.id, clipId),
  );
  return row;
}

/**
 * Route a YouTube clip through the pipeline that already exists.
 *
 * Never a second ingest path (§5.O2.2): this calls `ingestUrl`, the same
 * function the form action and the poller call, and then the same
 * `analyzeVideo` behind the same spend cap. What it adds is the clip row's
 * state machine on top.
 *
 * Statuses, precisely:
 *   `failed`   — something retryable broke (ingest error, analysis error, cap
 *                reached). `error` says what; the inbox offers a retry.
 *   `analyzed` — the clip has a video and the pipeline went as far as it can.
 *                That includes a video with no captions or one screening culled:
 *                there is nothing left to retry, and the video page shows why.
 *
 * A playlist or channel link is left `unprocessed` on purpose — one clip is one
 * link, and quietly ingesting 200 videos from a saved link is not what saving a
 * link means. Adding it as a tracked source is a deliberate act in /youtube.
 */
export async function processYouTubeClip(clip: Clip): Promise<Clip> {
  const ref = parseYouTubeUrl(clip.url);
  if (!ref) return markFailed(clip.id, "Not a recognisable YouTube URL.");
  if (ref.kind !== "video") {
    const [row] = await updateReturning(
      db,
      clips,
      {
        status: "unprocessed",
        error:
          "This is a playlist or channel link, not a single video. " +
          "Add it as a source in /youtube/sources to track it.",
      },
      eq(clips.id, clip.id),
    );
    return row;
  }

  await db
    .update(clips)
    .set({ status: "ingesting", error: null, ingestStartedAt: sql`current_timestamp(3)` })
    .where(eq(clips.id, clip.id));

  let video: Video;
  try {
    const summary = await ingestUrl(clip.url);
    const [ingested] = summary.videos;
    if (!ingested) return markFailed(clip.id, "YouTube returned no metadata for this video.");
    video = ingested;

    // Whatever happens to the analysis below, the clip is already worth more
    // than it was: it has a video row, a title and a thumbnail. Write that
    // before spending anything.
    await db
      .update(clips)
      .set({
        videoId: video.id,
        title: video.title,
        author: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
      })
      .where(eq(clips.id, clip.id));
  } catch (err) {
    return markFailed(clip.id, err instanceof Error ? err.message : "Ingest failed.");
  }

  const [transcript] = await db
    .select({ wordCount: transcripts.wordCount })
    .from(transcripts)
    .where(eq(transcripts.videoId, video.id))
    .limit(1);

  if (!transcript) {
    // No captions is not a failure — it is the end of the road for this video,
    // and the caption pipeline already recorded why on the video row.
    const [row] = await updateReturning(
      db,
      clips,
      { status: "analyzed", error: null },
      eq(clips.id, clip.id),
    );
    return row;
  }

  try {
    const estimatedUsd = estimateAnalysisCostUsd(transcript.wordCount, DEFAULT_MODEL);
    // Same call, same cap, as the single-video form path in ingest.actions.ts.
    // `analyzeVideo` no-ops when this video already has an analysis, so a
    // re-saved clip never pays twice.
    const result = await withSpendCap(estimatedUsd, () => analyzeVideo(video));

    if (result.status === "failed") {
      return markFailed(clip.id, `Analysis failed: ${result.error}`);
    }
    const [row] = await updateReturning(
      db,
      clips,
      { status: "analyzed", error: null },
      eq(clips.id, clip.id),
    );
    return row;
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      // Retryable in the most literal sense: the same clip, next month or after
      // the cap is raised, analyses fine. Keep the video link.
      return markFailed(clip.id, err.message);
    }
    return markFailed(
      clip.id,
      err instanceof Error ? err.message : `Analysis of "${video.title}" failed.`,
    );
  }
}
