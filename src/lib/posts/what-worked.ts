import "server-only";
import { and, eq, gte, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { posts } from "@/db/schema";
import type { PromptWhatWorked } from "@/lib/ai";
import { latestPostMetrics } from "@/lib/bridge/metrics";

/**
 * "What worked" (PLAN.md §1.51, §5.O12): an account's top posts of the last
 * 90 days, ranked by (saves + shares + comments) / reach on each post's newest
 * `post_metrics` snapshot, handed to `draftPost` as context. A post without
 * reach is not ranked — a rate over nothing says nothing.
 */

export const WHAT_WORKED_DAYS = 90;
export const WHAT_WORKED_LIMIT = 5;
const CAPTION_CHARS = 160;

export function engagementRate(m: {
  reach: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
}): number | null {
  if (!m.reach || m.reach <= 0) return null;
  return ((m.saves ?? 0) + (m.shares ?? 0) + (m.comments ?? 0)) / m.reach;
}

export async function whatWorked(
  accountId: number,
  options: { now?: Date; limit?: number } = {},
): Promise<PromptWhatWorked[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - WHAT_WORKED_DAYS * 86_400_000);
  const recent = await db
    .select({
      id: posts.id,
      format: posts.format,
      title: posts.title,
      body: posts.body,
      caption: posts.caption,
    })
    .from(posts)
    .where(
      and(
        eq(posts.accountId, accountId),
        or(
          gte(posts.publishedAt, since),
          and(isNull(posts.publishedAt), gte(posts.createdAt, since)),
        ),
      ),
    );
  if (recent.length === 0) return [];

  const metrics = new Map(
    (await latestPostMetrics(recent.map((p) => p.id))).map((m) => [m.postId, m]),
  );
  const ranked: PromptWhatWorked[] = [];
  for (const p of recent) {
    const m = metrics.get(p.id);
    if (!m) continue;
    const rate = engagementRate(m);
    if (rate === null) continue;
    const body = (p.body ?? null) as { hook?: unknown; caption?: unknown } | null;
    const hook = typeof body?.hook === "string" && body.hook.trim() ? body.hook : p.title;
    const caption = (p.caption ?? (typeof body?.caption === "string" ? body.caption : "")).replace(
      /\s+/g,
      " ",
    );
    ranked.push({
      format: p.format,
      hook: hook.slice(0, 200),
      caption: caption.slice(0, CAPTION_CHARS),
      reach: m.reach!,
      saves: m.saves ?? 0,
      shares: m.shares ?? 0,
      comments: m.comments ?? 0,
      rate,
    });
  }
  return ranked.sort((a, b) => b.rate - a.rate).slice(0, options.limit ?? WHAT_WORKED_LIMIT);
}
