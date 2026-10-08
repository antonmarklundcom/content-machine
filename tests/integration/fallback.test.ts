import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";

import { MediaResolution } from "@google/genai";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { estimateVideoUrlAnalysisCostUsd, readUsage } from "@/lib/ai";
import { FALLBACK_PAYLOAD, FALLBACK_USAGE, fakeGeminiClient } from "@/lib/ai-fake";
import {
  analyzeWithoutCaptions,
  fallbackEstimate,
  FallbackNotFoundError,
  FallbackRefusedError,
} from "@/lib/analysis/fallback";
import { estimateCostUsd } from "@/lib/analysis/pricing";
import { monthToDateUsd, reservedUsd, SpendCapExceededError } from "@/lib/spend";

import { resetTables, teardown } from "./setup";

/**
 * The no-captions fallback (PLAN.md §1.35, §5.O7.4), against the Gemini fake:
 * the request carries the YouTube URL as `fileData` at LOW media resolution,
 * the answer is parsed and stored exactly like a caption analysis, and the
 * reservation comes from the video's duration.
 */

const CAP = "5";

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  await resetTables();
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

async function video(durationSeconds: number | null, youtubeId = "nocaps00001") {
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId,
    title: "Residency, no captions",
    channelTitle: "Expat Desk",
    durationSeconds,
    captionStatus: "none",
  });
  return row;
}

test("analyses from the URL, stores like the caption path, bills the real usage", async () => {
  const v = await video(31 * 60 + 20);

  const estimate = await fallbackEstimate(v.id);
  assert.ok(estimate.ok);
  assert.equal(estimate.estimatedUsd, estimateVideoUrlAnalysisCostUsd(v.durationSeconds));

  const result = await analyzeWithoutCaptions(v.id);
  assert.equal(result.status, "ok");

  // The request: the URL as fileData, low resolution, the analysis schema.
  const [call] = fakeGeminiClient().callsOf("generateContent");
  assert.equal(call.responseKind, "analysis");
  const params = call.params as {
    contents: { parts: { fileData?: { fileUri: string }; text?: string }[] }[];
    config: { mediaResolution: MediaResolution };
  };
  assert.equal(
    params.contents[0].parts[0].fileData?.fileUri,
    "https://www.youtube.com/watch?v=nocaps00001",
  );
  assert.equal(params.config.mediaResolution, MediaResolution.MEDIA_RESOLUTION_LOW);
  assert.match(params.contents[0].parts[1].text ?? "", /Residency, no captions/);

  // Stored the same way: an ordinary ok row with the parsed payload.
  const rows = await db.select().from(schema.analyses).where(eq(schema.analyses.videoId, v.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].summary, FALLBACK_PAYLOAD.summary);
  assert.equal(rows[0].model, "gemini-3.1-flash-lite");
  assert.equal(rows[0].inputTokens, FALLBACK_USAGE.promptTokenCount);

  // Billed once, from usage, and under the reservation it held.
  const billed = estimateCostUsd(
    "gemini-3.1-flash-lite",
    readUsage({ usageMetadata: FALLBACK_USAGE } as never),
  );
  assert.ok(Math.abs((await monthToDateUsd()) - billed) < 1e-6, "billed exactly once");
  assert.ok(
    billed < estimate.estimatedUsd,
    "the reservation covers what a real run of this length bills",
  );
  assert.equal(await reservedUsd(), 0, "reservation released");

  // Tags come from the same insert path.
  assert.ok((await db.select().from(schema.videoTopics)).length > 0);

  // Once analysed, a second click is free unless forced.
  assert.deepEqual(await analyzeWithoutCaptions(v.id), {
    status: "skipped",
    why: "already-analysed",
  });
  assert.equal((await analyzeWithoutCaptions(v.id, { force: true })).status, "ok");
});

test("refuses unknown duration, over 90 minutes, a transcript, and a missing video — before any call", async () => {
  const unknown = await video(null, "nocaps00002");
  const long = await video(91 * 60, "nocaps00003");
  const edge = await video(90 * 60, "nocaps00004");
  const captioned = await video(600, "nocaps00005");
  await db
    .insert(schema.transcripts)
    .values({ videoId: captioned.id, content: "hello world", wordCount: 2 });

  await assert.rejects(
    analyzeWithoutCaptions(unknown.id),
    (e: unknown) => e instanceof FallbackRefusedError && /duration is unknown/.test(e.message),
  );
  await assert.rejects(
    analyzeWithoutCaptions(long.id),
    (e: unknown) => e instanceof FallbackRefusedError && /91 minutes/.test(e.message),
  );
  await assert.rejects(
    analyzeWithoutCaptions(captioned.id),
    (e: unknown) => e instanceof FallbackRefusedError && /has a transcript/.test(e.message),
  );
  await assert.rejects(analyzeWithoutCaptions(9999), FallbackNotFoundError);

  assert.equal(fakeGeminiClient().calls.length, 0, "no refusal reached Gemini");
  assert.equal((await db.select().from(schema.analyses)).length, 0);

  for (const id of [unknown.id, long.id, captioned.id, 9999]) {
    const estimate = await fallbackEstimate(id);
    assert.equal(estimate.ok, false, `estimate for ${id} is a refusal`);
  }
  assert.ok((await fallbackEstimate(edge.id)).ok, "exactly 90 minutes is allowed");
});

test("goes through the spend cap: over the cap, no call and no row", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0.001";
  const v = await video(60 * 60);
  await assert.rejects(analyzeWithoutCaptions(v.id), SpendCapExceededError);
  assert.equal(fakeGeminiClient().calls.length, 0);
  assert.equal((await db.select().from(schema.analyses)).length, 0);
  assert.equal(await reservedUsd(), 0);
});

test("never reachable from poll or batch (§1.35)", () => {
  for (const file of [
    "src/lib/poll.ts",
    "src/lib/analysis/batch.ts",
    "scripts/poll-sources.ts",
    "scripts/backfill.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/analysis\/fallback|analyzeVideoUrl|analyzeWithoutCaptions/.test(source),
      `${file} must not import the fallback`,
    );
  }
});
