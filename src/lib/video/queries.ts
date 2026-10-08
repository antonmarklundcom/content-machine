import { updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, inArray, lt, or, isNull } from "drizzle-orm";

import { db } from "@/db";
import { videoRenders, type VideoRender } from "@/db/schema";

import type { RenderPlan } from "./render";

/** Reads of `video_renders` for the /video page, the status route and re-renders. */

export const RENDER_LIST_LIMIT = 200;

/** Rows left `queued`/`rendering` this long were stopped by a restart: they are failed, not shown as running forever. */
export const STALE_RENDER_MS = 6 * 60 * 60_000;

export type RenderQuery = { ownerKind?: string; ownerRef?: string; limit?: number };

export async function listRenders(query: RenderQuery = {}): Promise<VideoRender[]> {
  const where = [
    query.ownerKind
      ? eq(videoRenders.ownerKind, query.ownerKind as VideoRender["ownerKind"])
      : null,
    query.ownerRef ? eq(videoRenders.ownerRef, query.ownerRef) : null,
  ].filter((w) => w !== null);
  return db
    .select()
    .from(videoRenders)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(videoRenders.createdAt), desc(videoRenders.id))
    .limit(Math.min(Math.max(1, query.limit ?? RENDER_LIST_LIMIT), RENDER_LIST_LIMIT));
}

export async function getRender(id: number): Promise<VideoRender | null> {
  const [row] = await db.select().from(videoRenders).where(eq(videoRenders.id, id)).limit(1);
  return row ?? null;
}

/** The request a render was made from, when its plan holds one. */
export function planRequest(row: VideoRender): RenderPlan["request"] | null {
  const plan = row.plan as RenderPlan | null;
  return plan && typeof plan === "object" && plan.request && Array.isArray(plan.request.scenes)
    ? plan.request
    : null;
}

/** Fail renders that have sat `queued`/`rendering` past `STALE_RENDER_MS`. Returns how many. */
export async function failStaleRenders(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RENDER_MS);
  const rows = await updateReturning(
    db,
    videoRenders,
    {
      status: "failed",
      error: "Interrupted: the app stopped while this render was queued or running. Re-render it.",
      finishedAt: now,
    },
    and(
      inArray(videoRenders.status, ["queued", "rendering"]),
      or(
        lt(videoRenders.startedAt, cutoff),
        and(isNull(videoRenders.startedAt), lt(videoRenders.createdAt, cutoff)),
      ),
    ),
    { id: videoRenders.id },
  );
  return rows.length;
}
