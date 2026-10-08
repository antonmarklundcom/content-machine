import { deleteReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { IDEA_STATUSES, ideas, type IdeaStatus } from "@/db/schema";

/**
 * Ideas by brand and status (PLAN.md §6.S6). Reads and the few writes the
 * ideas workflow needs, so `PATCH /api/ideas/[id]` and the server actions in
 * `ideas.actions.ts` apply one `posted_at` rule rather than two copies of it.
 */

export type Idea = typeof ideas.$inferSelect;

export const IDEAS_PAGE_SIZE = 30;

export type IdeasQuery = { brandId: string; status?: IdeaStatus; page?: number };

export type IdeasPage = { ideas: Idea[]; total: number; page: number; totalPages: number };

export function isIdeaStatus(value: unknown): value is IdeaStatus {
  return typeof value === "string" && (IDEA_STATUSES as readonly string[]).includes(value);
}

/** One brand's ideas, newest first, optionally one status, one page. */
export async function listIdeas(query: IdeasQuery): Promise<IdeasPage> {
  const where = and(
    eq(ideas.brandId, query.brandId),
    query.status ? eq(ideas.status, query.status) : undefined,
  );

  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(ideas)
    .where(where);
  const total = Number(count?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / IDEAS_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const rows = await db
    .select()
    .from(ideas)
    .where(where)
    // One generate run inserts many ideas in the same instant; the id keeps
    // the order stable across a page boundary.
    .orderBy(desc(ideas.createdAt), desc(ideas.id))
    .limit(IDEAS_PAGE_SIZE)
    .offset((page - 1) * IDEAS_PAGE_SIZE);

  return { ideas: rows, total, page, totalPages };
}

/**
 * Every idea for a brand (optionally one status), unpaged — what
 * `GET /api/ideas` has always returned, kept for the brand page's client list.
 */
export async function listAllIdeas(brandId: string, status?: IdeaStatus): Promise<Idea[]> {
  return db
    .select()
    .from(ideas)
    .where(and(eq(ideas.brandId, brandId), status ? eq(ideas.status, status) : undefined))
    .orderBy(desc(ideas.createdAt), desc(ideas.id));
}

/** Counts for every status, zeros included, so the tabs never miss one. */
export async function ideaCountsByStatus(brandId: string): Promise<Record<IdeaStatus, number>> {
  const rows = await db
    .select({ status: ideas.status, n: sql<number>`count(*)` })
    .from(ideas)
    .where(eq(ideas.brandId, brandId))
    .groupBy(ideas.status);
  const counts = Object.fromEntries(IDEA_STATUSES.map((s) => [s, 0])) as Record<IdeaStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}

export async function getIdea(id: number): Promise<Idea | null> {
  const [row] = await db.select().from(ideas).where(eq(ideas.id, id)).limit(1);
  return row ?? null;
}

export type IdeaUpdate = {
  status?: IdeaStatus;
  title?: string;
  angle?: string;
  draftCopy?: string;
};

/**
 * Apply an edit and/or a status change; null when the idea does not exist.
 *
 * `posted_at` describes the current status (PLAN.md §1.23): stamped on the way
 * into `posted`, cleared on the way out. Re-sending `posted` for an idea
 * already posted keeps the original stamp — decided in the UPDATE itself,
 * against the row's own status, so there is no read to race.
 */
export async function updateIdea(id: number, update: IdeaUpdate): Promise<Idea | null> {
  const set: Omit<Partial<typeof ideas.$inferInsert>, "postedAt"> & { postedAt?: SQL | null } = {};
  if (update.title !== undefined) set.title = update.title;
  if (update.angle !== undefined) set.angle = update.angle;
  if (update.draftCopy !== undefined) set.draftCopy = update.draftCopy;
  if (update.status !== undefined) {
    // postedAt is cleared on every non-posted status. COALESCE stamps entry
    // and preserves repeats without reading status after MariaDB changes it.
    // Drizzle orders SET assignments by schema columns, not patch key order.
    set.postedAt =
      update.status === "posted" ? sql`coalesce(${ideas.postedAt}, current_timestamp(3))` : null;
    set.status = update.status;
  }
  if (Object.keys(set).length === 0) return getIdea(id);

  const [row] = await updateReturning(db, ideas, set, eq(ideas.id, id));
  return row ?? null;
}

/**
 * Delete an idea only if it is `rejected` — one statement, so an idea
 * re-approved a moment ago cannot be caught by a stale check.
 * Returns whether a row went.
 */
export async function deleteRejectedIdea(id: number): Promise<boolean> {
  const rows = await deleteReturning(
    db,
    ideas,
    and(eq(ideas.id, id), eq(ideas.status, "rejected")),
    { id: ideas.id },
  );
  return rows.length > 0;
}
