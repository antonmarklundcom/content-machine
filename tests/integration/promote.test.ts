import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { analysisForIdea, promoteToIdea } from "@/lib/promote";
import { saveClip } from "@/lib/clips/save";

import { resetTables, teardown } from "./setup";

/**
 * Promote, verbatim (PLAN.md §5.O4.3).
 *
 * The verbatim path is the one that must never cost anything or call a model —
 * `adapt: false` is the default precisely because the button gets pressed dozens
 * of times in an evening (§5.O2.3). Nothing here passes `adapt`, so nothing here
 * touches `src/lib/ai.ts`; the adapted path is O5's, behind the fake.
 */

const IDEAS = [
  {
    title: "Residency in 90 days",
    premise: "Walk the timeline end to end.",
    why_now: "Rule change.",
  },
  { title: "The tax myth", premise: "0% is not the whole story.", why_now: "Everyone repeats it." },
];

async function seedCorpus() {
  await db.insert(schema.brands).values({
    id: "residency-guide",
    name: "Paraguay Residency Guide",
    domain: "paraguayresidencyguide.com",
    niche: "residency",
    market: "global",
    language: "en",
    voice: "Trustworthy expat guide.",
    platforms: ["instagram"],
  });

  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "vid00000001",
    title: "How residency actually works",
  });

  const [analysis] = await insertReturning(db, schema.analyses, {
    videoId: video.id,
    model: "gemini-3.7-flash",
    status: "ok",
    summary: "A walkthrough of the residency process.",
    takeaways: ["Bring apostilled documents.", "The police check expires."],
    ideas: IDEAS,
  });

  return { video, analysis };
}

beforeEach(resetTables);
after(teardown);

test("promoting an analysis idea writes an idea linked to the analysis", async () => {
  const { video, analysis } = await seedCorpus();

  const result = await promoteToIdea({
    source: { kind: "analysis-idea", analysisId: analysis.id, ideaIndex: 0 },
    brandId: "residency-guide",
    format: "reel",
    platform: "instagram",
  });

  assert.ok(result.ok);
  assert.equal(result.costUsd, 0, "verbatim promotion is free");
  assert.equal(result.idea.brandId, "residency-guide");
  assert.equal(result.idea.status, "proposed", "promoting is a suggestion, not an approval");
  assert.equal(result.idea.title, "Residency in 90 days");
  assert.equal(result.idea.visualNotes, null);
  // §1.3: the analysis, not the video, is what grounded the idea.
  assert.equal(result.idea.sourceAnalysisId, analysis.id);
  assert.match(result.idea.angle, /How residency actually works/);
  // The body is the analysis's own words, joined — not a rewrite.
  assert.equal(
    result.idea.draftCopy,
    [IDEAS[0].title, IDEAS[0].premise, IDEAS[0].why_now].join("\n"),
  );

  assert.equal((await db.select().from(schema.ideas)).length, 1);
  assert.equal((await analysisForIdea(result.idea))?.id, analysis.id);
  assert.equal(video.id, analysis.videoId);
});

test("promoting a marked unit takes that unit's text verbatim", async () => {
  const { analysis } = await seedCorpus();

  const result = await promoteToIdea({
    source: { kind: "unit", videoId: analysis.videoId, unitType: "takeaway", unitIndex: 1 },
    brandId: "residency-guide",
    format: "carousel",
    platform: "instagram",
  });

  assert.ok(result.ok);
  assert.equal(result.idea.draftCopy, "The police check expires.");
  assert.equal(result.idea.format, "carousel");
  assert.equal(result.idea.sourceAnalysisId, analysis.id);
});

test("promoting from a clip marks the clip promoted and links the idea back", async () => {
  const { analysis } = await seedCorpus();
  const saved = await saveClip({ url: "https://www.youtube.com/watch?v=vid00000001" });
  assert.ok(saved.ok);

  const result = await promoteToIdea({
    source: { kind: "analysis-idea", analysisId: analysis.id, ideaIndex: 1 },
    brandId: "residency-guide",
    format: "reel",
    platform: "instagram",
    clipId: saved.clip.id,
  });

  assert.ok(result.ok);
  const [clip] = await db.select().from(schema.clips).where(eq(schema.clips.id, saved.clip.id));
  assert.equal(clip.status, "promoted");
  assert.equal(clip.ideaId, result.idea.id);
  assert.equal(clip.error, null);
});

test("an unknown brand is a 404 and writes nothing", async () => {
  const { analysis } = await seedCorpus();

  const result = await promoteToIdea({
    source: { kind: "analysis-idea", analysisId: analysis.id, ideaIndex: 0 },
    brandId: "no-such-brand",
    format: "reel",
    platform: "instagram",
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.status, 404);
  assert.equal((await db.select().from(schema.ideas)).length, 0);
});

test("a source that does not resolve is a 404 and writes nothing", async () => {
  const { analysis } = await seedCorpus();

  const missingIndex = await promoteToIdea({
    source: { kind: "analysis-idea", analysisId: analysis.id, ideaIndex: 99 },
    brandId: "residency-guide",
    format: "reel",
    platform: "instagram",
  });
  assert.ok(!missingIndex.ok);
  assert.equal(missingIndex.status, 404);

  const missingVideo = await promoteToIdea({
    source: { kind: "unit", videoId: 999_999, unitType: "takeaway", unitIndex: 0 },
    brandId: "residency-guide",
    format: "reel",
    platform: "instagram",
  });
  assert.ok(!missingVideo.ok);
  assert.equal(missingVideo.status, 404);

  // A unit that the current analysis no longer has — analyses are append-only
  // and a re-analysis can drop what a mark pointed at.
  const droppedUnit = await promoteToIdea({
    source: { kind: "unit", videoId: analysis.videoId, unitType: "gap", unitIndex: 0 },
    brandId: "residency-guide",
    format: "reel",
    platform: "instagram",
  });
  assert.ok(!droppedUnit.ok);
  assert.equal(droppedUnit.status, 404);

  assert.equal((await db.select().from(schema.ideas)).length, 0);
});
