import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { clips, type Clip } from "@/db/schema";
import { normalizeTags } from "@/lib/clips/save";
import { configuredLanguages, configuredStrategies } from "@/lib/ingest/captions";
import { withLease } from "@/lib/lease";
import { SpendCapExceededError } from "@/lib/spend";
import { fetchListing } from "@/lib/studio/listing";
import { fetchCaptions } from "@/lib/youtube/captions";
import { parseVideoId } from "@/lib/youtube/url";

import { fetchRepoReadme, findGithubRepoUrl, githubRepoFromUrl } from "./github";
import {
  defaultLearnRunner,
  hasLearnContent,
  learnSummaryText,
  summarizeLearn,
  type LearnModelRunner,
  type LearnSummaryInput,
} from "./summarize";
import { describeScreenshot } from "./vision";

/**
 * `processLearnClip` (docs/PLAN-build4.md §1.13): gather what is known about a
 * learn clip — note, page title/description, GitHub README, YouTube captions,
 * an already-fetched transcript, a screenshot read by Gemini vision — then one
 * learn summary. Writes `summary`, `how_to_start`, `learn_category`, merges
 * tags. A failure sets `clips.error` and leaves the URL + note floor alone.
 *
 * Two runs never process the same clip: each clip is held under its own lease
 * (`learn:clip:<id>`) for the run, so the page's button and `npm run
 * learn:process` can overlap safely.
 */

export const LEARN_CLIP_LEASE_TTL_MS = 10 * 60 * 1000;
export const learnClipLease = (id: number) => `learn:clip:${id}`;

/** The pseudo-URL host the capture Worker gives a file sent with no link. */
const NO_LINK_HOST = "telegram.invalid";

export type LearnDeps = {
  run: LearnModelRunner;
  fetchPage: (url: string) => Promise<{ title: string | null; description: string | null } | null>;
  fetchReadme: (repoUrl: string) => Promise<string | null>;
  fetchCaptions: (videoId: string) => Promise<string | null>;
  describeScreenshot: (
    fileId: string,
    note: string | null,
  ) => Promise<{ text: string; costUsd: number }>;
};

export const defaultLearnDeps: LearnDeps = {
  run: defaultLearnRunner,
  fetchPage: async (url) => {
    try {
      const page = await fetchListing(url);
      return { title: page.title || null, description: page.description || null };
    } catch {
      return null;
    }
  },
  fetchReadme: (repoUrl) => fetchRepoReadme(repoUrl),
  fetchCaptions: async (videoId) => {
    try {
      const got = await fetchCaptions(videoId, {
        preferredLanguages: configuredLanguages(),
        strategies: configuredStrategies(),
      });
      return got.ok ? got.result.text || null : null;
    } catch {
      return null;
    }
  },
  describeScreenshot: (fileId, note) => describeScreenshot(fileId, note),
};

export type LearnOutcome =
  | { status: "done"; clipId: number; category: string; costUsd: number }
  | { status: "failed"; clipId: number; error: string; spendCap?: boolean }
  | { status: "skipped"; clipId: number; reason: string };

export class LearnClipNotFoundError extends Error {
  constructor(id: number) {
    super(`No clip ${id}.`);
    this.name = "LearnClipNotFoundError";
  }
}

function isNoLinkUrl(url: string): boolean {
  try {
    return new URL(url).hostname === NO_LINK_HOST;
  } catch {
    return false;
  }
}

async function fail(clipId: number, error: string, spendCap = false): Promise<LearnOutcome> {
  const message = error.slice(0, 1024);
  await db.update(clips).set({ error: message }).where(eq(clips.id, clipId));
  return { status: "failed", clipId, error: message, ...(spendCap ? { spendCap } : {}) };
}

/** Everything known about the clip, fetched best-effort. Vision is the one paid step here. */
export async function gatherLearnInput(
  clip: Clip,
  deps: LearnDeps,
): Promise<{ input: LearnSummaryInput; costUsd: number; screenshotError: string | null }> {
  const noLink = isNoLinkUrl(clip.url);
  let costUsd = 0;
  let title = clip.title;
  // A summary written by an earlier learn run is our own output, not a source.
  let caption = clip.postText ?? (clip.learnCategory ? null : clip.summary);
  let transcript = clip.transcript;

  if (!noLink) {
    const videoId = clip.platform === "youtube" ? parseVideoId(clip.url) : null;
    if (videoId && !transcript) transcript = await deps.fetchCaptions(videoId);
    if (!videoId || !title) {
      const page = await deps.fetchPage(clip.url);
      title ??= page?.title ?? null;
      caption ??= page?.description ?? null;
    }
  }

  const repoUrl = githubRepoFromUrl(clip.url)
    ? clip.url
    : (findGithubRepoUrl(clip.note) ?? findGithubRepoUrl(clip.postText));
  const repoReadme = repoUrl ? await deps.fetchReadme(repoUrl) : null;

  let screenshot: string | null = null;
  let screenshotError: string | null = null;
  if (clip.telegramFileId) {
    try {
      const shot = await deps.describeScreenshot(clip.telegramFileId, clip.note);
      screenshot = shot.text;
      costUsd += shot.costUsd;
    } catch (err) {
      // The cap refuses every later call too; anything else (a video, an
      // expired file id) still leaves the note and the link to work from.
      if (err instanceof SpendCapExceededError) throw err;
      screenshotError = (err as Error).message;
    }
  }

  return {
    input: {
      url: noLink ? "(a screenshot sent to the capture bot, no link)" : clip.url,
      platform: noLink ? "screenshot" : clip.platform,
      title,
      note: clip.note,
      caption,
      transcript,
      repoUrl,
      repoReadme,
      screenshot,
    },
    costUsd,
    screenshotError,
  };
}

async function processHeld(clip: Clip, deps: LearnDeps): Promise<LearnOutcome> {
  let gathered: Awaited<ReturnType<typeof gatherLearnInput>>;
  try {
    gathered = await gatherLearnInput(clip, deps);
  } catch (err) {
    if (err instanceof SpendCapExceededError) return fail(clip.id, err.message, true);
    return fail(clip.id, `Learn summary failed: ${(err as Error).message}`);
  }
  const { input, screenshotError } = gathered;
  if (!hasLearnContent(input)) {
    return fail(
      clip.id,
      screenshotError
        ? `Could not read the screenshot (${screenshotError}). Add a note about what it shows and run it again.`
        : "Nothing to summarise yet: no caption, transcript or README could be fetched. Add a note about what it covers and run it again.",
    );
  }

  try {
    const summary = await summarizeLearn(input, deps.run);
    await db
      .update(clips)
      .set({
        title: clip.title ?? input.title?.slice(0, 512) ?? summary.title,
        summary: learnSummaryText(summary),
        howToStart: summary.howToStart,
        learnCategory: summary.category,
        tags: normalizeTags([...clip.tags, ...summary.tags]),
        transcript: clip.transcript ?? input.transcript ?? null,
        error: null,
      })
      .where(eq(clips.id, clip.id));
    return {
      status: "done",
      clipId: clip.id,
      category: summary.category,
      costUsd: gathered.costUsd + summary.costUsd,
    };
  } catch (err) {
    if (err instanceof SpendCapExceededError) return fail(clip.id, err.message, true);
    return fail(clip.id, `Learn summary failed: ${(err as Error).message}`);
  }
}

/**
 * Summarise one learn clip. Without `force`, a clip that already has a
 * category is skipped; a clip another run is holding is skipped too. Throws
 * only for a missing clip.
 */
export async function processLearnClip(
  id: number,
  options: { force?: boolean; deps?: Partial<LearnDeps> } = {},
): Promise<LearnOutcome> {
  const deps = { ...defaultLearnDeps, ...options.deps };
  const held = await withLease(learnClipLease(id), LEARN_CLIP_LEASE_TTL_MS, async () => {
    // Read inside the lease, so a run that just finished is seen as finished.
    const [clip] = await db.select().from(clips).where(eq(clips.id, id)).limit(1);
    if (!clip) throw new LearnClipNotFoundError(id);
    if (clip.purpose !== "learn") {
      return { status: "skipped", clipId: id, reason: "not a learn clip" } as const;
    }
    if (clip.learnCategory && !options.force) {
      return { status: "skipped", clipId: id, reason: "already summarised" } as const;
    }
    return processHeld(clip, deps);
  });
  return held.acquired
    ? held.value
    : { status: "skipped", clipId: id, reason: "another run is processing it" };
}

/** Learn clips with no category yet (all learn clips with `force`), oldest first. */
export async function eligibleLearnClipIds(
  options: { limit?: number; force?: boolean; retryFailed?: boolean } = {},
): Promise<number[]> {
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(
      and(
        eq(clips.purpose, "learn"),
        options.force ? undefined : isNull(clips.learnCategory),
        options.force || options.retryFailed ? undefined : isNull(clips.error),
      ),
    )
    .orderBy(asc(clips.savedAt), asc(clips.id))
    .limit(Math.max(1, Math.min(options.limit ?? 20, 500)));
  return rows.map((r) => r.id);
}

/** The `npm run learn:process` loop. Stops at the first spend-cap refusal. */
export async function processLearnClips(
  options: {
    limit?: number;
    force?: boolean;
    retryFailed?: boolean;
    deps?: Partial<LearnDeps>;
    onOutcome?: (o: LearnOutcome) => void;
  } = {},
): Promise<{ outcomes: LearnOutcome[]; costUsd: number; stoppedEarly: string | null }> {
  const outcomes: LearnOutcome[] = [];
  let costUsd = 0;
  for (const id of await eligibleLearnClipIds(options)) {
    const outcome = await processLearnClip(id, { force: options.force, deps: options.deps });
    outcomes.push(outcome);
    options.onOutcome?.(outcome);
    if (outcome.status === "done") costUsd += outcome.costUsd;
    if (outcome.status === "failed" && outcome.spendCap) {
      return { outcomes, costUsd, stoppedEarly: outcome.error };
    }
  }
  return { outcomes, costUsd, stoppedEarly: null };
}
