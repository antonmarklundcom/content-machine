import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { JobState } from "@google/genai";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { readUsage } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE } from "@/lib/ai-fake";
import { estimateCostUsd } from "@/lib/analysis/pricing";
import { pollSources } from "@/lib/poll";
import { monthToDateUsd } from "@/lib/spend";

import { resetTables, teardown } from "./setup";

/**
 * The poller, dry and wet, against the Gemini test double (PLAN.md §5.O5.2).
 *
 * The batch path is the one that spends the most and is watched the least: it
 * runs unattended on a cron, its results land hours later, and every safeguard
 * around it — the reservation held at submission, the `batches` row that keeps
 * an open job counted against the cap, the "already written" guard against
 * double-collection — was written against an API nobody had called. Every one of
 * them is exercised here.
 *
 * Two details of the fake matter to this file specifically. Its batch results
 * come back JSON-round-tripped, exactly as the SDK delivers `inlinedResponses`,
 * so the `responseText` parts fallback is what parses them — read the comment on
 * that function for what happens when it is missing. And `batches.get` reports
 * `JOB_STATE_SUCCEEDED` unless a test says otherwise, which is the only state
 * `mapProviderStatus` calls collectable.
 */

const CAP = "5";
const WORD_COUNT = 5_000;

/** One analysis in a batch: the fake's usage, at the model's rates, halved. */
function expectedBatchAnalysisUsd(): number {
  return estimateCostUsd(
    "gemini-3.1-flash-lite",
    readUsage({ usageMetadata: USAGE.analysis } as never),
    { batch: true },
  );
}

/** A video with captions and no analysis — the definition of "pending". */
async function seedPendingVideo(n: number) {
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: `vid0000000${n}`,
    title: `Pending video ${n}`,
    description: "A walkthrough of the residency process, stage by stage.",
    captionStatus: "available",
  });
  await db.insert(schema.transcripts).values({
    videoId: video.id,
    language: "en",
    source: "captions",
    wordCount: WORD_COUNT,
    content: `transcript for video ${n} `.repeat(300).trim(),
  });
  return video;
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  // A poll run builds its Data API client before it looks at how many sources
  // there are, and that constructor requires a key. No source is seeded in this
  // file, so the client is never actually used and nothing reaches the network.
  process.env.YOUTUBE_API_KEY = "test-key";
  // Screening has its own test below; keeping it off elsewhere means the
  // batch assertions are about the batch and not about a second paid call.
  process.env.SCREENING_ENABLED = "0";
  await resetTables();
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.SCREENING_ENABLED;
  await teardown();
});

test("a dry run prices the work and submits nothing", async () => {
  await seedPendingVideo(1);
  await seedPendingVideo(2);
  const fake = fakeGeminiClient();

  const result = await pollSources({ dryRun: true });

  assert.equal(result.pendingAnalysis, 2);
  assert.equal(result.submitted, null);
  assert.equal(result.skipped?.reason, "dry-run");
  assert.ok((result.skipped?.estimatedUsd ?? 0) > 0, "a dry run still says what it would cost");

  // "Report what would be spent, submit nothing" has to mean nothing at all:
  // no provider call, no batches row, no spend, and — because screening also
  // spends — no screening either.
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.batches)).length, 0);
  assert.equal((await db.select().from(schema.analyses)).length, 0);
  assert.equal(await monthToDateUsd(), 0);
  assert.equal(result.screening, null);
});

test("a real run submits a batch, collects it, and bills at the batch rate", async () => {
  const first = await seedPendingVideo(1);
  const second = await seedPendingVideo(2);
  const fake = fakeGeminiClient();

  const result = await pollSources({ wait: true });

  // Submission.
  assert.ok(result.submitted, "a run with pending videos submits");
  assert.equal(result.submitted?.videoCount, 2);
  assert.equal(result.skipped, null);
  const created = fake.callsOf("batches.create");
  assert.equal(created.length, 1, "one batch, not one call per video");
  const submittedRequests = (
    created[0].params as { src: Array<{ metadata: Record<string, string> }> }
  ).src;
  assert.deepEqual(
    submittedRequests.map((r) => r.metadata["custom_id"]).sort(),
    [`video-${first.id}`, `video-${second.id}`].sort(),
    "each request carries our own id — results are keyed by it, never by position",
  );

  // Collection.
  assert.equal(result.waited?.finished, true);
  assert.equal(result.waited?.outcome?.succeeded, 2);
  assert.equal(result.waited?.outcome?.failed, 0);
  assert.equal(result.waited?.outcome?.alreadyWritten, 0);

  const canned = PAYLOADS.analysis as { summary: string; content_type: string };
  const analyses = await db.select().from(schema.analyses);
  assert.equal(analyses.length, 2);
  for (const analysis of analyses) {
    assert.equal(analysis.status, "ok", "the JSON-round-tripped response still parsed");
    assert.equal(analysis.summary, canned.summary);
    assert.equal(analysis.contentType, canned.content_type);
    assert.equal(analysis.batchId, result.submitted?.batchId);
    // The batch discount is the reason this path exists at all.
    assert.equal(Number(analysis.costUsd).toFixed(6), expectedBatchAnalysisUsd().toFixed(6));
  }

  // Money: two analyses at half price, and the batch row closed out so it no
  // longer counts as committed.
  assert.equal((await monthToDateUsd()).toFixed(6), (expectedBatchAnalysisUsd() * 2).toFixed(6));
  const [batch] = await db.select().from(schema.batches);
  assert.equal(batch.status, "collected");
  assert.equal(batch.videoCount, 2);
  assert.ok(batch.collectedAt instanceof Date);

  const [reservation] = await db.select().from(schema.spendReservation);
  assert.equal(Number(reservation?.reservedUsd ?? 0), 0);
});

test("a batch still running blocks a second submission of the same transcripts", async () => {
  await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  // Submit, but do not wait — the row is left in_progress.
  const first = await pollSources({ wait: false });
  assert.ok(first.submitted);

  // The next hourly run finds the job still going.
  fake.controls.batchState = JobState.JOB_STATE_RUNNING;
  const second = await pollSources({ wait: false });

  assert.equal(second.submitted, null);
  assert.equal(second.skipped?.reason, "batch-in-flight");
  assert.match(second.skipped?.detail ?? "", /not submitting again/);
  assert.equal(fake.callsOf("batches.create").length, 1, "the same work is never paid for twice");
  assert.equal((await db.select().from(schema.batches)).length, 1);
});

test("an open batch is counted against the cap before it is collected", async () => {
  await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  const submitted = await pollSources({ wait: false });
  assert.ok(submitted.submitted);

  // spend_log is written at collection time, so between submitting and
  // collecting the only thing holding the line is the batches row (PR-26).
  assert.equal(await monthToDateUsd(), 0, "nothing is billed until results land");
  assert.ok(submitted.spend.after.committedUsd > 0, "but the job is committed money");
  assert.equal(
    submitted.spend.after.projectedUsd.toFixed(6),
    submitted.spend.after.committedUsd.toFixed(6),
  );

  fake.controls.batchState = JobState.JOB_STATE_SUCCEEDED;
  const collected = await pollSources({ wait: false });
  assert.equal(collected.collected.length, 1);
  assert.equal(
    collected.spend.after.committedUsd,
    0,
    "collecting moves it from committed to billed",
  );
  assert.ok((await monthToDateUsd()) > 0);
});

test("re-collecting a batch writes nothing and charges nothing a second time", async () => {
  await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  const run = await pollSources({ wait: true });
  const batchId = run.submitted!.batchId;
  const billedOnce = await monthToDateUsd();
  assert.equal((await db.select().from(schema.analyses)).length, 1);

  // Force the collected row back open, as a crash between writing the analyses
  // and marking the batch would leave it, and collect again.
  await db
    .update(schema.batches)
    .set({ status: "in_progress", collectedAt: null })
    .where(eq(schema.batches.providerBatchId, batchId));

  const again = await pollSources({ wait: false });

  assert.equal(again.collected[0]?.outcome.alreadyWritten, 1);
  assert.equal(again.collected[0]?.outcome.succeeded, 0);
  assert.equal(
    (await db.select().from(schema.analyses)).length,
    1,
    "analyses are append-only — no duplicate",
  );
  assert.equal(await monthToDateUsd(), billedOnce, "and no second charge for one purchase");
  assert.equal(fake.callsOf("batches.create").length, 1);
});

test("one failed entry is recorded without losing the rest of the batch", async () => {
  const first = await seedPendingVideo(1);
  await seedPendingVideo(2);
  const fake = fakeGeminiClient();
  fake.controls.batchEntryErrors.set(`video-${first.id}`, { code: 429, message: "rate limited" });

  const result = await pollSources({ wait: true });

  assert.equal(result.waited?.outcome?.succeeded, 1);
  assert.equal(result.waited?.outcome?.failed, 1);

  const [failed] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.videoId, first.id));
  assert.equal(failed.status, "failed");
  // The status code is the actionable part: 429 means retrying might work,
  // 400 means it never will.
  assert.match(failed.error ?? "", /batch error: 429: rate limited/);
  assert.equal(Number(failed.costUsd), 0, "an entry that produced nothing is billed nothing");

  assert.equal((await monthToDateUsd()).toFixed(6), expectedBatchAnalysisUsd().toFixed(6));
});

test("a cap that will not fund the batch skips the run instead of submitting", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  const result = await pollSources({ wait: false });

  assert.equal(result.submitted, null);
  assert.equal(result.skipped?.reason, "spend-cap");
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.batches)).length, 0);
});

test("nothing pending means no batch and no calls", async () => {
  const fake = fakeGeminiClient();

  const result = await pollSources({ wait: false });

  assert.equal(result.pendingAnalysis, 0);
  assert.equal(result.skipped?.reason, "nothing-pending");
  assert.equal(fake.calls.length, 0);
});

test("the gallring screens on the fake and culls below the bar", async () => {
  process.env.SCREENING_ENABLED = "1";
  // The fake scores 72; a bar above that culls, and a culled video leaves the
  // analysis work list without being marked failed.
  process.env.SCREEN_MIN_SCORE = "80";
  const video = await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  try {
    const result = await pollSources({ wait: false });

    assert.equal(result.screening?.screened, 1);
    assert.equal(result.screening?.failed, 0);
    assert.equal(result.screening?.culled, 1);

    const canned = PAYLOADS.screening as { score: number; reason: string };
    const [screening] = await db.select().from(schema.screenings);
    assert.equal(screening.videoId, video.id);
    assert.equal(screening.status, "ok");
    assert.equal(screening.score, canned.score);
    assert.equal(screening.reason, canned.reason);
    assert.equal(screening.model, "gemini-3.1-flash-lite");

    // Screened out, so the batch is never assembled — that saving is the whole
    // point of screening before the work list is read.
    assert.equal(result.pendingAnalysis, 0);
    assert.equal(result.submitted, null);
    assert.equal(fake.callsOf("batches.create").length, 0);

    const call = fake.callsOf("generateContent")[0];
    assert.equal(call.responseKind, "screening");
    assert.ok((await monthToDateUsd()) > 0, "a screening is cheap, not free");
  } finally {
    delete process.env.SCREEN_MIN_SCORE;
  }
});

test("a video that clears the bar is screened and then analysed", async () => {
  process.env.SCREENING_ENABLED = "1";
  process.env.SCREEN_MIN_SCORE = "50";
  await seedPendingVideo(1);
  const fake = fakeGeminiClient();

  try {
    const result = await pollSources({ wait: true });

    assert.equal(result.screening?.culled, 0);
    assert.equal(result.waited?.outcome?.succeeded, 1);
    assert.equal(fake.callsOf("generateContent").length, 1, "one screening");
    assert.equal(fake.callsOf("batches.create").length, 1, "then one batch");

    const [screening] = await db.select().from(schema.screenings);
    const [analysis] = await db.select().from(schema.analyses);
    assert.equal(screening.status, "ok");
    assert.equal(analysis.status, "ok");
  } finally {
    delete process.env.SCREEN_MIN_SCORE;
  }
});
