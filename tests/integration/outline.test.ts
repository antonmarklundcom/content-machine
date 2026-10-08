import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { readUsage } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE } from "@/lib/ai-fake";
import { estimateOutlineCostUsd, generateOutline } from "@/lib/analysis/outline";
import { estimateCostUsd } from "@/lib/analysis/pricing";
import { monthToDateUsd } from "@/lib/spend";

import { resetTables, teardown } from "./setup";

/**
 * The outline path against the test double (PLAN.md §5.O5.1).
 *
 * The fifth and last schema in the repo, and the only paid call the required
 * coverage list does not name — which is exactly why it is here: an unexercised
 * canned response is one nobody would notice going stale, and `outlines` is the
 * one table in the app with a replace-on-conflict key, so "regenerating replaces
 * rather than accumulates" is a claim worth a test.
 */

const CAP = "5";

function expectedOutlineCostUsd(): number {
  return estimateCostUsd(
    "gemini-3.1-flash-lite",
    readUsage({ usageMetadata: USAGE.outline } as never),
  );
}

async function seedAnalysis() {
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "vid00000001",
    title: "How residency actually works",
  });
  const [analysis] = await insertReturning(db, schema.analyses, {
    videoId: video.id,
    model: "gemini-3.1-flash-lite",
    status: "ok",
    summary: "A walkthrough.",
    ideas: [
      { title: "The 45-day timeline", premise: "Walk it end to end.", why_now: "Rule change." },
      {
        title: "The four documents",
        premise: "Name each one.",
        why_now: "Most files are incomplete.",
      },
    ],
  });
  return { video, analysis };
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  await resetTables();
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

test("an outline is stored, priced, and built from the idea it names", async () => {
  const { analysis } = await seedAnalysis();
  const fake = fakeGeminiClient();

  const result = await generateOutline(analysis.id, 1);

  assert.equal(result.status, "ok");
  const canned = PAYLOADS.outline as { hook: string; teaching_points: string[]; cta: string };
  const [row] = await db.select().from(schema.outlines);
  assert.equal(row.status, "ok");
  assert.equal(row.analysisId, analysis.id);
  assert.equal(row.ideaIndex, 1);
  assert.equal(row.error, null);
  assert.equal(row.content?.hook, canned.hook);
  assert.deepEqual(row.content?.teaching_points, canned.teaching_points);
  assert.equal(row.content?.cta, canned.cta);

  const expected = expectedOutlineCostUsd();
  assert.equal(Number(row.costUsd).toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));

  // Index 1, not 0 — a prompt built from the wrong idea is the failure this
  // catches, and it is invisible in the stored outline itself.
  const params = fake.callsOf("generateContent")[0].params as { contents: string };
  assert.match(params.contents, /The four documents/);
  assert.doesNotMatch(params.contents, /The 45-day timeline/);
  assert.match(params.contents, /How residency actually works/);
});

test("regenerating replaces the outline rather than accumulating rows", async () => {
  const { analysis } = await seedAnalysis();

  await generateOutline(analysis.id, 0);
  await generateOutline(analysis.id, 0);

  const rows = await db.select().from(schema.outlines);
  assert.equal(rows.length, 1, "unique on (analysis_id, idea_index)");
  // Both calls happened and both were real, so both are billed.
  assert.equal((await monthToDateUsd()).toFixed(6), (expectedOutlineCostUsd() * 2).toFixed(6));
});

test("a missing analysis or index fails without spending", async () => {
  const { analysis } = await seedAnalysis();
  const fake = fakeGeminiClient();

  assert.equal((await generateOutline(9999, 0)).status, "failed");
  assert.equal((await generateOutline(analysis.id, 42)).status, "failed");

  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);
  assert.equal((await db.select().from(schema.outlines)).length, 0);
});

test("a cap of 0 refuses before the call", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  const { analysis } = await seedAnalysis();
  const fake = fakeGeminiClient();

  await assert.rejects(() => generateOutline(analysis.id, 0), /Refusing to start/);
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.outlines)).length, 0);
});

test("the outline reservation is a ceiling above what the call bills", async () => {
  assert.ok(
    expectedOutlineCostUsd() < estimateOutlineCostUsd("gemini-3.1-flash-lite"),
    "the fake's outline usage fits inside its reservation",
  );
});
