import { insertReturning, isDuplicateKey, updateReturning } from "@/db/mutations";
import "server-only";
import { isAutomationAllowed } from "@/lib/automation/store";
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
import {
  assertLeaseCurrent,
  LeaseLostError,
  withLeaseCommit,
  withRenewableLease,
  type Lease,
} from "@/lib/lease";
import {
  clipWorkLease,
  CLIP_WORK_LEASE_TTL_MS,
  CLIP_NO_CAPTIONS_MESSAGE,
  ClipWorkBusyError,
} from "./work";

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

  try {
    const [row] = await insertReturning(db, clips, {
      url,
      platform,
      note,
      brandId: input.brandId || null,
      purpose: input.purpose ?? "other",
      tags: normalizeTags(input.tags),
      source: input.source ?? "web",
    });
    return { ok: true, clip: row, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // The failed insert transaction has rolled back before this update: no
    // duplicate-INSERT shared lock is upgraded during concurrent first saves.
    const [existing] = await db.select().from(clips).where(eq(clips.url, url)).limit(1);
    if (!existing) throw error; // Never swallow an unrelated unique-key failure.
    if (note === null || note === existing.note)
      return { ok: true, clip: existing, created: false };
    const held = await withRenewableLease(
      clipWorkLease(existing.id),
      CLIP_WORK_LEASE_TTL_MS,
      (lease) =>
        withLeaseCommit(lease, async (tx) => {
          const [current] = await tx
            .select()
            .from(clips)
            .where(eq(clips.id, existing.id))
            .for("update");
          if (!current) throw error;
          const changed = note !== current.note;
          const [row] = await updateReturning(
            tx,
            clips,
            {
              note,
              ...(changed && current.purpose === "learn"
                ? {
                    summary: null,
                    learnCategory: null,
                    howToStart: null,
                    learnDetails: null,
                    error: null,
                  }
                : {}),
            },
            eq(clips.id, current.id),
          );
          return row;
        }),
    );
    if (!held.acquired)
      return {
        ok: false,
        error:
          "This link is already saved and is being processed. Retry after it finishes to update its note.",
      };
    return { ok: true, clip: held.value, created: false };
  }
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
  const held = await withRenewableLease(clipWorkLease(clipId), CLIP_WORK_LEASE_TTL_MS, (lease) =>
    withLeaseCommit(lease, (tx) =>
      updateReturning(
        tx,
        clips,
        {
          brandId: fields.brandId || null,
          purpose: fields.purpose,
          tags: normalizeTags(fields.tags),
        },
        eq(clips.id, clipId),
      ),
    ),
  );
  if (!held.acquired) throw new ClipWorkBusyError();
  return held.value[0] ?? null;
}

async function markFailed(lease: Lease, clipId: number, error: string): Promise<Clip> {
  const [row] = await withLeaseCommit(lease, (tx) =>
    updateReturning(
      tx,
      clips,
      { status: "failed", error: error.slice(0, 1024) },
      eq(clips.id, clipId),
    ),
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
 *   `analyzed` — an analysis is available. Missing captions leave the clip
 *                unprocessed with the manual-evidence recovery step.
 *
 * A playlist or channel link is left `unprocessed` on purpose — one clip is one
 * link, and quietly ingesting 200 videos from a saved link is not what saving a
 * link means. Adding it as a tracked source is a deliberate act in /youtube.
 */
export async function processYouTubeClip(
  clip: Clip,
  options: { automatic?: boolean } = {},
): Promise<Clip> {
  const held = await withRenewableLease(
    clipWorkLease(clip.id),
    CLIP_WORK_LEASE_TTL_MS,
    async (lease) => {
      const [current] = await db.select().from(clips).where(eq(clips.id, clip.id)).limit(1);
      if (!current) throw new Error("This clip no longer exists.");
      if (current.status === "analyzed" || current.status === "promoted") return current;
      if (options.automatic && !(await isAutomationAllowed("captureAnalysis"))) return current;
      return processHeldYouTubeClip(current, options, lease);
    },
  );
  if (!held.acquired) throw new ClipWorkBusyError();
  return held.value;
}

async function processHeldYouTubeClip(
  clip: Clip,
  options: { automatic?: boolean },
  lease: Lease,
): Promise<Clip> {
  const ref = parseYouTubeUrl(clip.url);
  if (!ref) return markFailed(lease, clip.id, "Not a recognisable YouTube URL.");
  if (ref.kind !== "video") {
    const [row] = await withLeaseCommit(lease, (tx) =>
      updateReturning(
        tx,
        clips,
        {
          status: "unprocessed",
          error:
            "This is a playlist or channel link, not a single video. " +
            "Add it as a source in /youtube/sources to track it.",
        },
        eq(clips.id, clip.id),
      ),
    );
    return row;
  }

  await withLeaseCommit(lease, (tx) =>
    tx
      .update(clips)
      .set({ status: "ingesting", error: null, ingestStartedAt: sql`current_timestamp(3)` })
      .where(eq(clips.id, clip.id)),
  );

  let video: Video;
  let captionsFailed = false;
  try {
    await assertLeaseCurrent(lease);
    const summary = await ingestUrl(clip.url);
    const [ingested] = summary.videos;
    if (!ingested)
      return markFailed(lease, clip.id, "YouTube returned no metadata for this video.");
    video = ingested;
    captionsFailed = summary.captionCounts.failed > 0;

    // Whatever happens to the analysis below, the clip is already worth more
    // than it was: it has a video row, a title and a thumbnail. Write that
    // before spending anything.
    await withLeaseCommit(lease, (tx) =>
      tx
        .update(clips)
        .set({
          videoId: video.id,
          title: video.title,
          author: video.channelTitle,
          thumbnailUrl: video.thumbnailUrl,
        })
        .where(eq(clips.id, clip.id)),
    );
  } catch (err) {
    if (err instanceof LeaseLostError) throw err;
    return markFailed(lease, clip.id, err instanceof Error ? err.message : "Ingest failed.");
  }

  const [transcript] = await db
    .select({ wordCount: transcripts.wordCount })
    .from(transcripts)
    .where(eq(transcripts.videoId, video.id))
    .limit(1);

  if (!transcript) {
    if (captionsFailed)
      return markFailed(
        lease,
        clip.id,
        "Caption fetching failed. Retry, or add a manual transcript from YouTube Ingest.",
      );
    const [row] = await withLeaseCommit(lease, (tx) =>
      updateReturning(
        tx,
        clips,
        { status: "unprocessed", error: CLIP_NO_CAPTIONS_MESSAGE },
        eq(clips.id, clip.id),
      ),
    );
    return row;
  }

  try {
    if (options.automatic && !(await isAutomationAllowed("captureAnalysis"))) {
      const [saved] = await withLeaseCommit(lease, (tx) =>
        updateReturning(tx, clips, { status: "unprocessed", error: null }, eq(clips.id, clip.id)),
      );
      return saved;
    }
    const estimatedUsd = estimateAnalysisCostUsd(transcript.wordCount, DEFAULT_MODEL);
    // Same call, same cap, as the single-video form path in ingest.actions.ts.
    // `analyzeVideo` no-ops when this video already has an analysis, so a
    // re-saved clip never pays twice.
    await assertLeaseCurrent(lease);
    const result = await withSpendCap(estimatedUsd, () => analyzeVideo(video));

    if (result.status === "failed") {
      return markFailed(lease, clip.id, `Analysis failed: ${result.error}`);
    }
    const [row] = await withLeaseCommit(lease, (tx) =>
      updateReturning(tx, clips, { status: "analyzed", error: null }, eq(clips.id, clip.id)),
    );
    return row;
  } catch (err) {
    if (err instanceof LeaseLostError) throw err;
    if (err instanceof SpendCapExceededError) {
      // Retryable in the most literal sense: the same clip, next month or after
      // the cap is raised, analyses fine. Keep the video link.
      return markFailed(lease, clip.id, err.message);
    }
    return markFailed(
      lease,
      clip.id,
      err instanceof Error ? err.message : `Analysis of "${video.title}" failed.`,
    );
  }
}
