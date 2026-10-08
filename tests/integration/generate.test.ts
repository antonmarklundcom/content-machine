import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { POST as generate } from "@/app/api/generate/route";
import { estimateContentPlanCostUsd, messageCostUsd, readUsage } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE, WEB_SEARCH_QUERIES } from "@/lib/ai-fake";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * `/api/generate` against the Gemini test double (PLAN.md §5.O5.2).
 *
 * This is the app's most expensive call and, until this file, the least
 * verified: it streams, it grounds, it bills per search query on top of tokens,
 * and every one of those was a comment rather than a passing test. What is
 * asserted here is the whole chain — the request the route built, the rows it
 * wrote, and the exact dollar figure that reached `spend_log`.
 *
 * The money assertions are computed from the fake's own `usageMetadata` through
 * `pricing.ts`, never hardcoded. A hardcoded figure passes when the rates table
 * and the ledger drift together, which is the one failure this whole layer
 * exists to catch.
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

/** What the fake's grounded ideas call must bill: tokens at 3.7 Flash + 3 queries. */
function expectedGenerateCostUsd(): number {
  const usage = readUsage({ usageMetadata: USAGE.ideas } as never);
  return messageCostUsd(usage, WEB_SEARCH_QUERIES.length);
}

async function seedBrand() {
  await db.insert(schema.brands).values(BRAND);
}

/** Signed in as the owner by default: generate spends money (PLAN.md §1.20). */
let owner: Record<string, string> = {};

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  await resetTables();
  owner = { cookie: (await signIn("owner")).cookie };
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

test("a grounded run inserts ideas, research notes, and one priced spend row", async () => {
  await seedBrand();

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id }, owner),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ideas: unknown[];
    researchNotesAdded: number;
    costUsd: number;
  };

  // The plan the fake returned, all the way into the database.
  const canned = PAYLOADS.ideas as { ideas: unknown[]; researchNotes: unknown[] };
  const ideas = await db.select().from(schema.ideas);
  assert.equal(ideas.length, canned.ideas.length, "every idea in the plan became a row");
  assert.equal(body.ideas.length, canned.ideas.length);
  assert.equal(ideas[0].brandId, BRAND.id);
  assert.equal(ideas[0].status, "proposed");
  assert.equal(ideas[0].sourceAnalysisId, null, "an ungrounded run has no source analysis");
  assert.ok(ideas[0].draftCopy.length > 40, "draft copy is a caption, not a placeholder");

  const notes = await db.select().from(schema.researchNotes);
  assert.equal(notes.length, canned.researchNotes.length);
  assert.equal(body.researchNotesAdded, notes.length);
  // The fake reports a note with no related brands; the route is expected to
  // fall back to the brand that paid for it rather than storing an empty list.
  assert.deepEqual(notes[0].relatedBrandIds, [BRAND.id]);
  assert.equal(notes[0].market, BRAND.market);
  // The model tagged that note with no brand, so nothing says the ideas were
  // spun from it: stored for the brand, but not linked (§5.O6.5).
  assert.equal(ideas[0].researchNoteId, null, "no link to a note the model did not tag");

  // The money. Tokens at the ideation model's rates PLUS three grounding
  // queries at $14/1,000 — the per-query fee is the half a token-only
  // assertion would miss.
  const expected = expectedGenerateCostUsd();
  assert.equal(body.costUsd.toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));

  const spendRows = await db.select().from(schema.spendLog);
  assert.equal(spendRows.length, 1, "one call, one day, one row");
  assert.equal(Number(spendRows[0].costUsd).toFixed(6), expected.toFixed(6));

  // Grounding is not free and must not be assumed: prove the fee is really in
  // the total by checking the token-only figure is strictly smaller.
  const tokensOnly = messageCostUsd(readUsage({ usageMetadata: USAGE.ideas } as never), 0);
  assert.ok(expected > tokensOnly, "the three search queries are billed on top of tokens");

  // The reservation is released whatever happened, so nothing is left held.
  const [reservation] = await db.select().from(schema.spendReservation);
  assert.equal(Number(reservation?.reservedUsd ?? 0), 0);
});

test("the request carries Search grounding, the ideas schema and the brand's own prompt", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();

  await callRoute(generate, jsonPost("/api/generate", { brandId: BRAND.id }, owner));

  const calls = fake.callsOf("generateContentStream");
  assert.equal(calls.length, 1, "one streamed call per generate");
  assert.equal(calls[0].responseKind, "ideas");
  assert.equal(calls[0].groundingQueries, WEB_SEARCH_QUERIES.length);

  const params = calls[0].params as {
    contents: string;
    config: { tools?: unknown[]; responseMimeType?: string; systemInstruction?: string };
  };
  assert.ok(
    (params.config.tools ?? []).some((tool) => "googleSearch" in (tool as object)),
    "generate grounds with Search — that is what it pays the per-query fee for",
  );
  assert.equal(params.config.responseMimeType, "application/json");
  assert.match(params.contents, /Paraguay Residency Guide/);
  assert.match(params.contents, /Language for copy: es/, "the brand's language reaches the model");
});

test("an analysisId seeds the prompt and is recorded on every idea", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();

  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "vid00000001",
    title: "How residency actually works",
    channelTitle: "Expat Desk",
  });
  const [analysis] = await insertReturning(db, schema.analyses, {
    videoId: video.id,
    model: "gemini-3.1-flash-lite",
    status: "ok",
    summary: "A walkthrough of the residency process.",
    takeaways: ["Bring apostilled documents."],
    topics: ["residency"],
    ideas: [
      { title: "The 45-day timeline", premise: "Walk it end to end.", why_now: "Rule change." },
    ],
  });

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id, analysisId: analysis.id }, owner),
  );
  assert.equal(response.status, 200);

  const ideas = await db.select().from(schema.ideas);
  assert.ok(ideas.length > 0);
  assert.ok(
    ideas.every((idea) => idea.sourceAnalysisId === analysis.id),
    "PLAN §1.3: where a grounded idea came from survives on the row",
  );

  // §5.O2.4: the stored analysis is passed as context, and the video it came
  // from is named — that is what makes it grounding rather than a bare quote.
  const params = fake.callsOf("generateContentStream")[0].params as { contents: string };
  assert.match(params.contents, /GROUNDING/);
  assert.match(params.contents, /How residency actually works/);
  assert.match(params.contents, /Expat Desk/);
  assert.match(params.contents, /A walkthrough of the residency process\./);
});

test("an unknown analysisId is 404 and spends nothing", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id, analysisId: 4321 }, owner),
  );

  assert.equal(response.status, 404);
  assert.equal(
    fake.calls.length,
    0,
    "the model is never called for a request that cannot be built",
  );
  assert.equal(await monthToDateUsd(), 0);
});

test("a cap of 0 answers 429 before the model is called", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  await seedBrand();
  const fake = fakeGeminiClient();

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id }, owner),
  );

  assert.equal(response.status, 429, "the cap is its own status code, not a 500 (§1.10)");
  const body = (await response.json()) as { error: string; spend: { capUsd: number } };
  assert.match(body.error, /Refusing to start/);
  assert.equal(body.spend.capUsd, 0);

  // Refusing to *start* is the whole claim: nothing was sent, nothing written.
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.ideas)).length, 0);
  assert.equal((await db.select().from(schema.spendLog)).length, 0);
  const [reservation] = await db.select().from(schema.spendReservation);
  assert.equal(Number(reservation?.reservedUsd ?? 0), 0, "a refused reservation holds nothing");
});

test("a cap that cannot cover the reservation refuses even when the real cost would fit", async () => {
  // The reservation is a ceiling, not a forecast: it holds MAX_OUTPUT_TOKENS
  // plus reasoning plus eight searches. This cap sits between what the call
  // would really bill and what it has to reserve, so a run that "would have
  // been affordable" is still refused — which is the safe direction (§1.10).
  const estimate = estimateContentPlanCostUsd();
  const actual = expectedGenerateCostUsd();
  assert.ok(
    actual < estimate,
    "the fake's usage is inside the reservation, as a real call should be",
  );

  process.env.MONTHLY_SPEND_CAP_USD = ((actual + estimate) / 2).toFixed(6);
  await seedBrand();

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id }, owner),
  );
  assert.equal(response.status, 429);
  assert.equal(await monthToDateUsd(), 0);
});

test("existing research for the brand is offered back to the model", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();

  await db.insert(schema.researchNotes).values({
    topic: "Apostille backlog",
    summary: "Apostille turnaround in the home country is the current bottleneck.",
    market: BRAND.market,
    relatedBrandIds: [BRAND.id],
    sources: ["https://example.com/apostille"],
  });
  await db.insert(schema.researchNotes).values({
    topic: "Unrelated brand's finding",
    summary: "Should not be offered to this brand.",
    market: BRAND.market,
    relatedBrandIds: ["some-other-brand"],
    sources: [],
  });

  await callRoute(generate, jsonPost("/api/generate", { brandId: BRAND.id }, owner));

  const params = fake.callsOf("generateContentStream")[0].params as { contents: string };
  assert.match(params.contents, /Apostille backlog/, "reuse what is already paid for");
  assert.doesNotMatch(params.contents, /Unrelated brand's finding/);
});

test("an unknown brandId is 400 and never reaches the model", async () => {
  const fake = fakeGeminiClient();

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: "no-such-brand" }, owner),
  );

  assert.equal(response.status, 400);
  assert.equal(fake.calls.length, 0);
});

test("two runs accumulate into one day's spend row", async () => {
  await seedBrand();

  await callRoute(generate, jsonPost("/api/generate", { brandId: BRAND.id }, owner));
  await callRoute(generate, jsonPost("/api/generate", { brandId: BRAND.id }, owner));

  const rows = await db.select().from(schema.spendLog);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].costUsd).toFixed(6), (expectedGenerateCostUsd() * 2).toFixed(6));

  const ideas = await db.select().from(schema.ideas).where(eq(schema.ideas.brandId, BRAND.id));
  assert.equal(ideas.length, (PAYLOADS.ideas as { ideas: unknown[] }).ideas.length * 2);
});

test("signed out is 401 and spends nothing (PLAN.md §1.20)", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();

  const response = await callRoute(generate, jsonPost("/api/generate", { brandId: BRAND.id }));

  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys((await response.json()) as object), ["error"]);
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.ideas)).length, 0);
});

test("an employee is 403 with promote's adapt shape, and spends nothing", async () => {
  await seedBrand();
  const fake = fakeGeminiClient();
  const employee = { cookie: (await signIn("employee")).cookie };

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: BRAND.id }, employee),
  );

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: string };
  assert.deepEqual(
    Object.keys(body),
    ["error"],
    "same { error } body promote's adapt gate returns",
  );
  assert.match(body.error, /owner/);
  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);
});

/** Run generate with the fake's ideas payload swapped for one call. */
async function generateWithNotes(notes: Array<{ topic: string; relatedBrandIds: string[] }>) {
  const canned = PAYLOADS.ideas as { researchNotes: unknown[]; ideas: unknown[] };
  const original = canned.researchNotes;
  canned.researchNotes = notes.map((n) => ({
    ...n,
    summary: `${n.topic} — summary.`,
    sources: ["https://example.com/note"],
  }));
  try {
    const response = await callRoute(
      generate,
      jsonPost("/api/generate", { brandId: BRAND.id }, owner),
    );
    assert.equal(response.status, 200);
  } finally {
    canned.researchNotes = original;
  }
}

test("ideas link to the first returned note that lists this brand", async () => {
  await seedBrand();

  await generateWithNotes([
    { topic: "Another brand's finding", relatedBrandIds: ["propia"] },
    { topic: "Shared finding", relatedBrandIds: ["propia", BRAND.id] },
  ]);

  const notes = await db.select().from(schema.researchNotes);
  const shared = notes.find((n) => n.topic === "Shared finding")!;
  const ideas = await db.select().from(schema.ideas);
  assert.ok(ideas.length > 0);
  for (const idea of ideas) assert.equal(idea.researchNoteId, shared.id);
});

test("no returned note lists this brand → no link, even though notes were stored", async () => {
  await seedBrand();

  await generateWithNotes([{ topic: "Another brand's finding", relatedBrandIds: ["propia"] }]);

  assert.equal((await db.select().from(schema.researchNotes)).length, 1);
  for (const idea of await db.select().from(schema.ideas)) assert.equal(idea.researchNoteId, null);
});
