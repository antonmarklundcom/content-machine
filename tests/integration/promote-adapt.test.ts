import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { POST as promote } from "@/app/api/ideas/promote/route";
import { estimateAdaptCostUsd, messageCostUsd, readUsage } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE } from "@/lib/ai-fake";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * `POST /api/ideas/promote` with `adapt` (PLAN.md §5.O5.2).
 *
 * O4 covered the verbatim path, which spends nothing and calls nothing. This is
 * the other half: the one cheap paid call in the promote endpoint, plus the
 * owner gate in front of it. Both halves matter for the same reason — `adapt`
 * is the only thing here that costs money, so it is the only thing the role
 * check exists for (§1.20, PR-24).
 */

const CAP = "5";

const BRAND = {
  id: "residency-guide",
  name: "Paraguay Residency Guide",
  domain: "paraguayresidencyguide.com",
  niche: "residency",
  market: "global",
  language: "es",
  voice: "Trustworthy expat guide.",
  platforms: ["instagram"],
};

const ANALYSIS_IDEAS = [
  {
    title: "Residency in 90 days",
    premise: "Walk the timeline end to end.",
    why_now: "Rule change.",
  },
];

/** What the fake's adapt call must bill: tokens at the promote model, no grounding. */
function expectedAdaptCostUsd(): number {
  const usage = readUsage({ usageMetadata: USAGE.adapt } as never);
  return messageCostUsd(usage, 0, process.env.GEMINI_PROMOTE_MODEL ?? "gemini-3.1-flash-lite");
}

async function seedCorpus() {
  await db.insert(schema.brands).values(BRAND);
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "vid00000001",
    title: "How residency actually works",
  });
  const [analysis] = await insertReturning(db, schema.analyses, {
    videoId: video.id,
    model: "gemini-3.1-flash-lite",
    status: "ok",
    summary: "A walkthrough of the residency process.",
    ideas: ANALYSIS_IDEAS,
  });
  return { video, analysis };
}

function promoteBody(analysisId: number, extra: Record<string, unknown> = {}) {
  return {
    brandId: BRAND.id,
    format: "carousel",
    platform: "instagram",
    source: { kind: "analysis-idea", analysisId, ideaIndex: 0 },
    ...extra,
  };
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  await resetTables();
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

test("an owner adapting gets rewritten copy and one priced spend row", async () => {
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("owner");
  const fake = fakeGeminiClient();

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true }), { cookie }),
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { idea: { id: number }; costUsd: number };

  const canned = PAYLOADS.adapt as {
    title: string;
    angle: string;
    draftCopy: string;
    visualNotes: string;
  };
  const [idea] = await db.select().from(schema.ideas);
  assert.equal(idea.title, canned.title, "the adapted title replaces the source's");
  assert.equal(idea.angle, canned.angle);
  assert.equal(idea.draftCopy, canned.draftCopy);
  assert.equal(idea.visualNotes, canned.visualNotes);
  assert.equal(idea.sourceAnalysisId, analysis.id, "provenance survives the rewrite");
  assert.equal(idea.status, "proposed");
  assert.equal(idea.format, "carousel");

  const expected = expectedAdaptCostUsd();
  assert.equal(body.costUsd.toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));

  // The cheap model, and no grounding — a promote that searched the web would
  // turn a $0.001 call into a $0.10 one.
  const call = fake.callsOf("generateContent")[0];
  assert.equal(call.responseKind, "adapt");
  assert.equal(call.model, "gemini-3.1-flash-lite");
  assert.equal(call.groundingQueries, 0);
  const params = call.params as {
    config: { tools?: unknown[]; thinkingConfig?: { thinkingLevel?: string } };
  };
  assert.equal(params.config.tools, undefined, "promote never grounds");
  assert.equal(params.config.thinkingConfig?.thinkingLevel, "MINIMAL");

  const [reservation] = await db.select().from(schema.spendReservation);
  assert.equal(Number(reservation?.reservedUsd ?? 0), 0);
});

test("the source material and the brand's voice reach the model", async () => {
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("owner");
  const fake = fakeGeminiClient();

  await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true }), { cookie }),
  );

  const params = fake.callsOf("generateContent")[0].params as { contents: string };
  assert.match(
    params.contents,
    /Walk the timeline end to end\./,
    "the analysis idea is the source text",
  );
  assert.match(params.contents, /How residency actually works/, "the video it came from is named");
  assert.match(
    params.contents,
    /Trustworthy expat guide\./,
    "the brand's voice is passed, not inferred",
  );
  assert.match(params.contents, /Language for copy: es/);
});

test("an employee asking to adapt is refused and nothing is spent", async () => {
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("employee");
  const fake = fakeGeminiClient();

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true }), { cookie }),
  );

  assert.equal(response.status, 403, "spending is the owner's (§1.20)");
  assert.equal(fake.calls.length, 0);
  assert.equal(
    (await db.select().from(schema.ideas)).length,
    0,
    "refused rather than quietly downgraded",
  );
  assert.equal(await monthToDateUsd(), 0);
});

test("an employee promoting verbatim still works, free", async () => {
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("employee");
  const fake = fakeGeminiClient();

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id), { cookie }),
  );

  assert.equal(response.status, 201);
  const [idea] = await db.select().from(schema.ideas);
  assert.equal(idea.draftCopy, "Residency in 90 days\nWalk the timeline end to end.\nRule change.");
  assert.equal(fake.calls.length, 0, "the default path is free and never calls a model");
  assert.equal(await monthToDateUsd(), 0);
});

test("a signed-out request is 401", async () => {
  const { analysis } = await seedCorpus();

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true })),
  );

  assert.equal(response.status, 401);
  assert.equal(await monthToDateUsd(), 0);
});

test("a cap of 0 answers 429 and writes no idea", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("owner");
  const fake = fakeGeminiClient();

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true }), { cookie }),
  );

  assert.equal(response.status, 429);
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.ideas)).length, 0);
});

test("promoting an inbox clip marks it promoted and links the idea", async () => {
  const { analysis } = await seedCorpus();
  const { cookie } = await signIn("owner");

  const [clip] = await insertReturning(db, schema.clips, {
    url: "https://www.youtube.com/watch?v=vid00000001",
    platform: "youtube",
    status: "analyzed",
  });

  const response = await callRoute(
    promote,
    jsonPost("/api/ideas/promote", promoteBody(analysis.id, { adapt: true, clipId: clip.id }), {
      cookie,
    }),
  );
  assert.equal(response.status, 201);

  const [updated] = await db.select().from(schema.clips);
  const [idea] = await db.select().from(schema.ideas);
  assert.equal(updated.status, "promoted");
  assert.equal(updated.ideaId, idea.id);
  assert.equal(updated.error, null);
});

test("the adapt reservation is a ceiling above what the call really bills", async () => {
  // Same guarantee as generate's, at the other end of the price range: the
  // reservation held against the cap must never be smaller than the bill.
  assert.ok(
    expectedAdaptCostUsd() < estimateAdaptCostUsd(),
    "the fake's adapt usage fits inside the reservation, as a real call should",
  );
});
