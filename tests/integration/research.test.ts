import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { sql } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  brandsForSource,
  InvalidBrandSourceRoleError,
  linkSourceToBrand,
  listBrandCompetitors,
  topOutliersForBrand,
  unlinkSourceFromBrand,
} from "@/lib/bridge/research";
import { outlierScores, type OutlierRow } from "@/lib/research/outlier";

import { resetTables, teardown } from "./setup";

/**
 * `bridge/research.ts` (PLAN.md §5.O7.3): competitor links and the outlier
 * board. The outlier query is one SQL statement per brand; the test that
 * matters most here holds it to `lib/research/outlier.ts`, the pure reference.
 */

beforeEach(resetTables);
after(teardown);

async function source(youtubeId: string, title = youtubeId): Promise<number> {
  const [row] = await insertReturning(
    db,
    schema.sources,
    {
      kind: "channel",
      youtubeId,
      title,
      url: `https://www.youtube.com/channel/${youtubeId}`,
    },
    { id: schema.sources.id },
  );
  return row.id;
}

let videoSeq = 0;

/** A video `daysAgo` old by the database's clock, so the N-day window is deterministic. */
async function video(sourceId: number | null, viewCount: number | null, daysAgo: number | null) {
  videoSeq += 1;
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: `v${String(videoSeq).padStart(10, "0")}`,
    sourceId,
    title: `Video ${videoSeq}`,
    channelTitle: sourceId === null ? null : `Channel ${sourceId}`,
    viewCount,
    publishedAt: daysAgo === null ? null : sql`now() - make_interval(days => ${daysAgo})`,
    durationSeconds: 600,
  });
  return row;
}

test("link, relink with a new role, list per source, unlink", async () => {
  const a = await source("UCaaaa");
  const b = await source("UCbbbb");

  const link = await linkSourceToBrand("pozo", a);
  assert.equal(link.role, "competitor", "competitor is the default role");
  await linkSourceToBrand("pozo", b, "inspiration");
  await linkSourceToBrand("propia", a);

  // Re-linking is an upsert on the pair: the role changes, no duplicate row.
  const relinked = await linkSourceToBrand("pozo", a, "inspiration");
  assert.equal(relinked.role, "inspiration");
  assert.equal((await db.select().from(schema.brandSources)).length, 3);

  const forA = await brandsForSource(a);
  assert.deepEqual(
    forA.map((r) => r.brandId),
    ["pozo", "propia"],
    "one channel, several brands (§1.29)",
  );

  assert.equal(await unlinkSourceFromBrand("pozo", a), true);
  assert.equal(await unlinkSourceFromBrand("pozo", a), false, "second unlink finds nothing");
  assert.equal(
    (await db.select().from(schema.sources)).length,
    2,
    "unlinking never deletes the source",
  );

  await assert.rejects(linkSourceToBrand("pozo", a, "rival" as never), InvalidBrandSourceRoleError);
});

test("listBrandCompetitors: stats per linked channel, role filter, newest link first", async () => {
  const a = await source("UCaaaa", "Alpha");
  const b = await source("UCbbbb", "Beta");
  const unlinked = await source("UCcccc", "Gamma");

  for (const views of [100, 200, 300, 400, 500, 600]) await video(a, views, 10);
  const analysed = await video(a, null, 5);
  await db.insert(schema.analyses).values([
    { videoId: analysed.id, model: "gemini-3.1-flash-lite", status: "ok", summary: "ok" },
    { videoId: analysed.id, model: "gemini-3.1-flash-lite", status: "failed" },
  ]);
  for (const views of [10, 20]) await video(b, views, 3);
  await video(unlinked, 999, 1);

  await linkSourceToBrand("pozo", a);
  await linkSourceToBrand("pozo", b, "inspiration");

  const all = await listBrandCompetitors("pozo");
  assert.deepEqual(
    all.map((c) => c.title),
    ["Beta", "Alpha"],
  );

  const alpha = all.find((c) => c.sourceId === a)!;
  assert.equal(alpha.videoCount, 7);
  assert.equal(alpha.analyzedCount, 1, "a failed row is not an analysis");
  assert.equal(alpha.medianViews, 350, "median of the six with a view count");
  assert.ok(alpha.latestPublishedAt instanceof Date);
  assert.ok(
    Math.abs(Date.now() - alpha.latestPublishedAt.getTime() - 5 * 86_400_000) < 3_600_000,
    "timestamps come back in UTC, not shifted by the machine's zone",
  );

  const beta = all.find((c) => c.sourceId === b)!;
  assert.equal(beta.medianViews, null, "under 5 videos → no baseline");
  assert.equal(beta.role, "inspiration");

  const competitors = await listBrandCompetitors("pozo", { role: "competitor" });
  assert.deepEqual(
    competitors.map((c) => c.sourceId),
    [a],
  );
  assert.deepEqual(await listBrandCompetitors("nobody"), []);
});

test("topOutliersForBrand agrees with the pure outlier function", async () => {
  const a = await source("UCaaaa", "Alpha");
  const b = await source("UCbbbb", "Beta");
  const small = await source("UCsmall", "Small");
  const other = await source("UCother", "Other brand's");

  // Alpha: 35 videos, so the 30-video cut matters; an old viral one outside
  // the window must not appear but a recent spike must.
  const rows: OutlierRow[] = [];
  const add = async (sourceId: number, views: number | null, daysAgo: number | null) => {
    const v = await video(sourceId, views, daysAgo);
    rows.push({ id: v.id, sourceId, viewCount: views, publishedAt: v.publishedAt });
    return v;
  };
  for (let i = 0; i < 34; i++) await add(a, 1_000 + (i % 7) * 100, 2 + i * 3);
  const spike = await add(a, 25_000, 1);
  const oldViral = await add(a, 900_000, 400);
  await add(a, null, 1); // hidden counter: not scored, not in the baseline
  // Beta: exactly 5, one of them an even-split median.
  for (const views of [100, 200, 300, 400, 5_000]) await add(b, views, 20);
  // Small: 4 videos → no baseline, never on the board.
  for (const views of [1, 2, 3, 1_000_000]) await add(small, views, 5);
  // A zero-median channel is excluded rather than dividing by zero.
  const zero = await source("UCzero", "Zero");
  for (const views of [0, 0, 0, 5, 50]) await add(zero, views, 5);
  // A channel linked to another brand only.
  for (const views of [1, 1, 1, 1, 1_000_000]) await video(other, views, 5);

  for (const id of [a, b, small, zero]) await linkSourceToBrand("pozo", id);
  await linkSourceToBrand("propia", other);

  // The latest ok analysis is joined; a newer failed one does not hide it.
  await db.insert(schema.analyses).values([
    { videoId: spike.id, model: "gemini-3.1-flash-lite", status: "ok", summary: "first" },
    { videoId: spike.id, model: "gemini-3.1-flash-lite", status: "ok", summary: "second" },
    { videoId: spike.id, model: "gemini-3.1-flash-lite", status: "failed" },
  ]);

  const board = await topOutliersForBrand("pozo", { days: 90, limit: 200 });
  const reference = outlierScores(rows);

  assert.ok(board.length > 0);
  for (const entry of board) {
    const expected = reference.get(entry.videoId);
    assert.ok(
      expected !== null && expected !== undefined,
      `video ${entry.videoId} has a reference score`,
    );
    assert.ok(
      Math.abs(entry.score - expected) < 1e-9,
      `video ${entry.videoId}: ${entry.score} vs ${expected}`,
    );
    assert.ok(entry.sourceId !== small && entry.sourceId !== zero && entry.sourceId !== other);
  }
  // Everything the reference scores inside the window is on the board.
  const inWindow = rows.filter(
    (r) =>
      r.sourceId !== small &&
      r.sourceId !== zero &&
      reference.get(r.id) !== null &&
      r.publishedAt !== null &&
      Date.now() - r.publishedAt.getTime() <= 90 * 86_400_000,
  );
  assert.equal(board.length, inWindow.length);

  assert.equal(board[0].videoId, spike.id, "highest score first");
  assert.equal(board[0].analysisSummary, "second", "latest ok analysis");
  assert.equal(board[0].sourceTitle, "Alpha");
  assert.ok(!board.some((e) => e.videoId === oldViral.id), "outside the window");
  const sorted = [...board].sort((x, y) => y.score - x.score);
  assert.deepEqual(
    board.map((e) => e.score),
    sorted.map((e) => e.score),
  );

  // Window, limit and role all narrow the same statement.
  const recent = await topOutliersForBrand("pozo", { days: 1 });
  assert.ok(recent.every((e) => e.videoId === spike.id));
  assert.equal((await topOutliersForBrand("pozo", { limit: 3 })).length, 3);
  await linkSourceToBrand("pozo", b, "inspiration");
  const inspirations = await topOutliersForBrand("pozo", { role: "inspiration", days: 90 });
  assert.ok(inspirations.length > 0 && inspirations.every((e) => e.sourceId === b));
  assert.deepEqual(await topOutliersForBrand("nobody"), []);
});
