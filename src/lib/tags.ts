import { insertIfAbsent, queryRows } from "@/db/mutations";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";

import { entities, topics, videoEntities, videoTopics, videos } from "@/db/schema";

/**
 * [PR-34] Projecting an analysis's topics and entities into the lookup tables
 * that make cross-corpus grouping a query instead of a scan (PLAN.md §7).
 *
 * The analysis row keeps its own immutable copy of both lists; these tables are
 * the *current* tagging of a video, rebuilt whenever a newer analysis succeeds.
 * See the comment on `analyses.topics` for why both exist.
 */

/**
 * The match key for a tag.
 *
 * Two tags are the same tag when their slugs match, so this decides how coarse
 * the grouping is. Punctuation is dropped rather than mapped, which is what
 * makes "Next.js" and "nextjs" one shelf instead of two — the single most
 * common way a corpus of open-ended tags fragments.
 *
 * Deliberately *not* stripping spaces: "local seo" and "localseo" are the same
 * subject, but collapsing whitespace globally would also merge "AI video" into
 * "aivideo" and then into anything else that lost a space, and over-merging is
 * harder to notice than under-merging.
 */
export function slugifyTag(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks so "café" and "cafe" agree.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 128)
  );
}

type TagTables =
  | { lookup: typeof topics; link: typeof videoTopics; linkKey: "topicId" }
  | { lookup: typeof entities; link: typeof videoEntities; linkKey: "entityId" };

const TOPIC_TABLES: TagTables = { lookup: topics, link: videoTopics, linkKey: "topicId" };
const ENTITY_TABLES: TagTables = { lookup: entities, link: videoEntities, linkKey: "entityId" };

/**
 * Replace a video's topic and entity links with the ones from its newest
 * analysis.
 *
 * Replace rather than merge: a re-analysis that drops a topic means the model
 * no longer thinks the video is about it, and a merge would make tags
 * accumulate forever with no way to ever remove one.
 *
 * Runs in a transaction so a video is never briefly untagged — the feed and the
 * /topics page read these tables continuously, and a half-applied retag is a
 * visible wrong answer rather than a slow one.
 */
export async function syncVideoTags(
  videoId: number,
  tags: { topics: string[]; entities: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    await syncOne(tx, TOPIC_TABLES, videoId, tags.topics);
    await syncOne(tx, ENTITY_TABLES, videoId, tags.entities);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncOne(tx: Tx, tables: TagTables, videoId: number, names: string[]): Promise<void> {
  const { lookup, link, linkKey } = tables;

  // Slug is the identity, so two spellings of one tag collapse here rather than
  // producing two rows that the unique index would then reject.
  const bySlug = new Map<string, string>();
  for (const name of names) {
    const slug = slugifyTag(name);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, name.trim());
  }

  await tx.delete(link).where(eq(link.videoId, videoId));
  if (bySlug.size === 0) return;

  // Insert-on-conflict-do-nothing then read back, rather than select-then-
  // insert: two analyses collected from the same batch can introduce the same
  // new topic concurrently, and the check-then-act version loses that race
  // against the unique index. `insertIfAbsent` deliberately leaves `name`
  // alone on a conflict: the first spelling to arrive wins, which keeps
  // "Next.js" from being rewritten to "next.js" by a later, sloppier analysis.
  await insertIfAbsent(
    tx,
    lookup,
    [...bySlug].map(([slug, name]) => ({ name, slug })),
    { target: lookup.slug },
  );

  const rows = await tx
    .select({ id: lookup.id, slug: lookup.slug })
    .from(lookup)
    .where(inArray(lookup.slug, [...bySlug.keys()]));

  if (rows.length === 0) return;
  await tx.insert(link).values(rows.map((row) => ({ videoId, [linkKey]: row.id })));
}

export type TagCount = {
  name: string;
  slug: string;
  videoCount: number;
  /** Most recent publication date among the tagged videos. */
  latest: Date | null;
};

/**
 * The shelves, most-populated first.
 *
 * `minCount` defaults to 2 because a tag on exactly one video is not a grouping
 * — it is a label, and a corpus of open-ended tags produces a long tail of them
 * that buries the shelves that actually have something on them. The index page
 * offers a control to see them anyway.
 */
async function listTags(
  lookup: typeof topics | typeof entities,
  link: typeof videoTopics | typeof videoEntities,
  tagIdColumn: typeof videoTopics.topicId | typeof videoEntities.entityId,
  options: { minCount?: number; limit?: number } = {},
): Promise<TagCount[]> {
  const minCount = options.minCount ?? 2;
  const rows = await db
    .select({
      name: lookup.name,
      slug: lookup.slug,
      videoCount: sql<number>`count(distinct ${link.videoId})`,
      latest: sql<Date | null>`max(${videos.publishedAt})`.mapWith(videos.publishedAt),
    })
    .from(lookup)
    .innerJoin(link, eq(tagIdColumn, lookup.id))
    .innerJoin(videos, eq(videos.id, link.videoId))
    .groupBy(lookup.id, lookup.name, lookup.slug)
    .having(sql`count(distinct ${link.videoId}) >= ${minCount}`)
    .orderBy(sql`count(distinct ${link.videoId}) desc`, lookup.name)
    .limit(options.limit ?? 200);
  return rows.map((r) => ({ ...r, videoCount: Number(r.videoCount) }));
}

export function listTopics(options?: { minCount?: number; limit?: number }) {
  return listTags(topics, videoTopics, videoTopics.topicId, options);
}

export function listEntities(options?: { minCount?: number; limit?: number }) {
  return listTags(entities, videoEntities, videoEntities.entityId, options);
}

/** Display name for one slug, so a grouping page can title itself. */
export async function findTagName(kind: "topic" | "entity", slug: string): Promise<string | null> {
  const lookup = kind === "topic" ? topics : entities;
  const [row] = await db
    .select({ name: lookup.name })
    .from(lookup)
    .where(eq(lookup.slug, slug))
    .limit(1);
  return row?.name ?? null;
}

/**
 * The shapes present in the corpus, counted over each video's newest successful
 * analysis.
 *
 * Grouped in SQL over a derived per-video value rather than over every analysis
 * row: a video re-analysed three times would otherwise count three times, and
 * under whichever labels it has since abandoned. A window ranks successful
 * analyses with a nonnull type by id, then counts one selected row per video.
 */
export async function listContentTypes(): Promise<
  Array<{ contentType: string; videoCount: number }>
> {
  const rows = await queryRows<{ content_type: string; video_count: number | string }>(
    db,
    sql`
    with ranked as (
      select video_id, content_type,
        row_number() over (partition by video_id order by id desc) as rn
      from analyses
      where status = 'ok' and content_type is not null
    )
    select content_type, count(*) as video_count
    from ranked where rn = 1
    group by content_type
    order by count(*) desc
  `,
  );

  return rows
    .filter((r) => Boolean(r.content_type))
    .map((r) => ({ contentType: r.content_type, videoCount: Number(r.video_count) }));
}
