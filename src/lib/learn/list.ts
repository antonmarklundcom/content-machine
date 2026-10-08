import "server-only";
import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { clips, type Clip } from "@/db/schema";

import { learnConditions, type LearnQuery } from "./query";

/** Cards per page on /learn. */
export const LEARN_PAGE_SIZE = 20;

export type LearnPage = { clips: Clip[]; total: number; page: number; totalPages: number };

/** One page of learn clips, newest first (id breaks ties, as the inbox does). */
export async function listLearnClips(query: LearnQuery): Promise<LearnPage> {
  const where = learnConditions(query);
  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(clips)
    .where(where);
  const total = Number(count?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LEARN_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const rows = await db
    .select()
    .from(clips)
    .where(where)
    .orderBy(desc(clips.savedAt), desc(clips.id))
    .limit(LEARN_PAGE_SIZE)
    .offset((page - 1) * LEARN_PAGE_SIZE);
  return { clips: rows, total, page, totalPages };
}

/**
 * Learn clips per category under the other filters (category ignored), for
 * the badges. `none` counts the ones not summarised yet.
 */
export async function learnCategoryCounts(
  query: Omit<LearnQuery, "page">,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      category: sql<string>`coalesce(${clips.learnCategory}, 'none')`,
      total: sql<number>`count(*)`,
    })
    .from(clips)
    .where(learnConditions(query, false))
    .groupBy(sql`1`);
  return Object.fromEntries(rows.map((r) => [r.category, Number(r.total)]));
}
