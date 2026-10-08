import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { sources, videos, type Source } from "@/db/schema";

export async function listSources(): Promise<Source[]> {
  return db.select().from(sources).orderBy(desc(sources.createdAt));
}

/** A source row plus how many videos it has produced (PR-20). */
export type SourceWithCount = Source & { videoCount: number };

/**
 * Counts in one grouped join rather than N queries — the list is unbounded and
 * a per-row count would scale with the number of tracked channels.
 */
export async function listSourcesWithCounts(): Promise<SourceWithCount[]> {
  const rows = await db
    .select({
      source: sources,
      videoCount: sql<number>`count(${videos.id})`,
    })
    .from(sources)
    .leftJoin(videos, eq(videos.sourceId, sources.id))
    .groupBy(...Object.values(getTableColumns(sources)))
    .orderBy(desc(sources.createdAt));

  return rows.map((row) => ({ ...row.source, videoCount: Number(row.videoCount) }));
}
