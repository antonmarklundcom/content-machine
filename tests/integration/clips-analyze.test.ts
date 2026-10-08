import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { POST as clips } from "@/app/api/clips/route";
import { readUsage } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE } from "@/lib/ai-fake";
import { estimateCostUsd } from "@/lib/analysis/pricing";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * `POST /api/clips`, Bearer path, all the way to `analyzed` (PLAN.md §5.O5.2).
 *
 * This is the capture endpoint a phone share sheet hits, and the only route in
 * the app that authenticates itself rather than sitting behind the middleware —
 * so "does the Bearer path work end to end" is a question only a route-level
 * test can answer.
 *
 * The video's metadata call is the one thing here that is neither Gemini nor
 * Postgres, so it is stubbed at `fetch`. The transcript is seeded rather than
 * fetched: the caption pipeline skips a video that already has one
 * (`already-have-transcript`), which keeps the whole test off the network
 * without pretending anything about captions — and captions are S7's subject,
 * not this phase's. Everything after that point is the real pipeline:
 * `ingestUrl`, `analyzeVideo`, the spend cap, and the clip's state machine.
 */

const CAP = "5";
const CLIP_TOKEN = "clip-token-for-tests";
const YOUTUBE_ID = "vid00000001";
const CLIP_URL = `https://www.youtube.com/watch?v=${YOUTUBE_ID}`;
const WORD_COUNT = 5_000;

/** What the fake's analysis call must bill, interactive (no batch discount). */
function expectedAnalysisCostUsd(): number {
  return estimateCostUsd(
    "gemini-3.1-flash-lite",
    readUsage({ usageMetadata: USAGE.analysis } as never),
  );
}

const realFetch = globalThis.fetch;

/** Serve `videos.list` for our one id; refuse everything else, loudly. */
function stubYouTubeDataApi(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      return Response.json({
        items: [
          {
            id: YOUTUBE_ID,
            snippet: {
              title: "How residency actually works",
              description: "A walkthrough.",
              channelId: "UCtest0000000000000000",
              channelTitle: "Expat Desk",
              publishedAt: "2026-08-01T10:00:00Z",
              thumbnails: {
                high: { url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 360 },
              },
            },
            contentDetails: { duration: "PT31M20S" },
            statistics: { viewCount: "12345", likeCount: "678" },
          },
        ],
      });
    }
    throw new Error(`unexpected network call in a test: ${url.href}`);
  }) as typeof globalThis.fetch;
}

/**
 * The video row and its transcript, in place before the clip is saved.
 *
 * `captionStatus: "available"` plus a transcript row is what makes the caption
 * pipeline return `skipped` — see fetchAndStoreCaptions. The video is otherwise
 * untouched; ingest still updates it from the stubbed metadata.
 */
async function seedTranscribedVideo() {
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: YOUTUBE_ID,
    title: "Placeholder title",
    captionStatus: "available",
  });
  await db.insert(schema.transcripts).values({
    videoId: video.id,
    language: "en",
    source: "captions",
    wordCount: WORD_COUNT,
    content: "everyone still says ninety days ".repeat(200).trim(),
  });
  return video;
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  process.env.CLIP_TOKEN = CLIP_TOKEN;
  process.env.YOUTUBE_API_KEY = "test-key";
  process.env.SCREENING_ENABLED = "0";
  stubYouTubeDataApi();
  await resetTables();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  delete process.env.CLIP_TOKEN;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.SCREENING_ENABLED;
  await teardown();
});

test("a Bearer capture ingests, analyses on the fake, and lands `analyzed`", async () => {
  const video = await seedTranscribedVideo();
  const fake = fakeGeminiClient();

  const response = await callRoute(
    clips,
    jsonPost(
      "/api/clips",
      { url: CLIP_URL, note: "for the residency series" },
      {
        authorization: `Bearer ${CLIP_TOKEN}`,
      },
    ),
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { clip: { status: string }; created: boolean };
  assert.equal(body.created, true);
  assert.equal(body.clip.status, "analyzed");

  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.status, "analyzed");
  assert.equal(clip.error, null);
  assert.equal(clip.note, "for the residency series");
  assert.equal(clip.videoId, video.id);
  // §1.6: the best-effort metadata is written before anything is spent.
  assert.equal(clip.title, "How residency actually works");
  assert.equal(clip.author, "Expat Desk");

  // The analysis itself — one row, parsed from the fake's canned payload.
  const canned = PAYLOADS.analysis as { summary: string; takeaways: string[]; topics: string[] };
  const [analysis] = await db.select().from(schema.analyses);
  assert.equal(analysis.status, "ok");
  assert.equal(analysis.videoId, video.id);
  assert.equal(analysis.model, "gemini-3.1-flash-lite");
  assert.equal(analysis.promptVersion, 2);
  assert.equal(analysis.summary, canned.summary);
  assert.deepEqual(analysis.takeaways, canned.takeaways);
  assert.equal(analysis.batchId, null, "the interactive path is not a batch");

  // The usage columns are where the cached-prefix arithmetic is provable:
  // `promptTokenCount` includes the cached tokens, and `readUsage` subtracts
  // them so they are not billed twice.
  assert.equal(analysis.cacheReadTokens, USAGE.analysis.cachedContentTokenCount);
  assert.equal(
    analysis.inputTokens,
    USAGE.analysis.promptTokenCount! - USAGE.analysis.cachedContentTokenCount!,
  );
  assert.equal(analysis.outputTokens, USAGE.analysis.candidatesTokenCount);
  assert.equal(analysis.cacheWriteTokens, 0, "Gemini has no cache-write counter");

  const expected = expectedAnalysisCostUsd();
  assert.equal(Number(analysis.costUsd).toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));

  // PR-34: the analysis retags the video through the same insert path.
  const topics = await db.select().from(schema.topics);
  assert.ok(
    canned.topics.every((topic) => topics.some((row) => row.name === topic)),
    "every topic in the payload reached the lookup table",
  );

  const call = fake.callsOf("generateContent")[0];
  assert.equal(call.responseKind, "analysis");
  assert.equal(call.groundingQueries, 0, "the analysis pipeline does not search");
  const params = call.params as { contents: string };
  assert.match(params.contents, /everyone still says ninety days/, "the transcript is the input");
});

test("no Bearer and no cookie is 401, and saves nothing", async () => {
  await seedTranscribedVideo();
  const fake = fakeGeminiClient();

  const response = await callRoute(clips, jsonPost("/api/clips", { url: CLIP_URL }));

  assert.equal(response.status, 401);
  assert.equal((await db.select().from(schema.clips)).length, 0, "the route never falls open");
  assert.equal(fake.calls.length, 0);
});

test("a wrong Bearer token is 401", async () => {
  await seedTranscribedVideo();

  const response = await callRoute(
    clips,
    jsonPost("/api/clips", { url: CLIP_URL }, { authorization: "Bearer not-the-token" }),
  );

  assert.equal(response.status, 401);
  assert.equal((await db.select().from(schema.clips)).length, 0);
});

test("a signed-in browser with no Bearer takes the cookie path", async () => {
  await seedTranscribedVideo();
  const { cookie } = await signIn("owner");

  const response = await callRoute(clips, jsonPost("/api/clips", { url: CLIP_URL }, { cookie }));

  assert.equal(response.status, 201);
  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.status, "analyzed");
});

test("re-saving an analysed clip does not pay for a second analysis", async () => {
  await seedTranscribedVideo();
  const fake = fakeGeminiClient();
  const header = { authorization: `Bearer ${CLIP_TOKEN}` };

  await callRoute(clips, jsonPost("/api/clips", { url: CLIP_URL, note: "first" }, header));
  const afterFirst = await monthToDateUsd();

  const second = await callRoute(clips, jsonPost("/api/clips", { url: CLIP_URL }, header));
  assert.equal(second.status, 200, "a re-save is not a creation");
  const body = (await second.json()) as { created: boolean };
  assert.equal(body.created, false);

  assert.equal((await db.select().from(schema.clips)).length, 1, "never a second row (§5.O2.1)");
  assert.equal(fake.callsOf("generateContent").length, 1, "analyse once, store forever (§1.3)");
  assert.equal(await monthToDateUsd(), afterFirst);

  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.note, "first", "a re-save with no note keeps the note it had");
});

test("a cap of 0 leaves the clip failed with the video link intact", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  const video = await seedTranscribedVideo();
  const fake = fakeGeminiClient();

  const response = await callRoute(
    clips,
    jsonPost("/api/clips", { url: CLIP_URL }, { authorization: `Bearer ${CLIP_TOKEN}` }),
  );

  // The capture itself still succeeded — that is the whole point of writing the
  // row before spending anything.
  assert.equal(response.status, 201);
  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.status, "failed");
  assert.match(clip.error ?? "", /Refusing to start/);
  assert.equal(clip.videoId, video.id, "retryable: the ingest half is kept");
  assert.equal(clip.title, "How residency actually works");

  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.analyses)).length, 0);
});

test("an unset CLIP_TOKEN answers 503, not 401", async () => {
  delete process.env.CLIP_TOKEN;
  await seedTranscribedVideo();

  const response = await callRoute(
    clips,
    jsonPost("/api/clips", { url: CLIP_URL }, { authorization: "Bearer anything" }),
  );

  // A misconfiguration, not a rejected credential (§4.5) — answering 401 sends
  // someone hunting for a token the deployment simply has none of.
  assert.equal(response.status, 503);
});

test("a playlist link is parked `unprocessed` rather than ingesting 200 videos", async () => {
  const fake = fakeGeminiClient();

  const response = await callRoute(
    clips,
    jsonPost(
      "/api/clips",
      { url: "https://www.youtube.com/playlist?list=PLtest000000000000000000" },
      { authorization: `Bearer ${CLIP_TOKEN}` },
    ),
  );

  assert.equal(response.status, 201);
  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.status, "unprocessed");
  assert.match(clip.error ?? "", /playlist or channel link/);
  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);
});

test("a video with no transcript is `analyzed` without paying for anything", async () => {
  // Not a failure: the road ends here for this video, and the video page says
  // why. The clip inbox must not offer a retry that cannot succeed.
  await insertReturning(db, schema.videos, {
    youtubeId: YOUTUBE_ID,
    title: "Placeholder",
    captionStatus: "none",
  });
  const fake = fakeGeminiClient();

  const response = await callRoute(
    clips,
    jsonPost("/api/clips", { url: CLIP_URL }, { authorization: `Bearer ${CLIP_TOKEN}` }),
  );

  assert.equal(response.status, 201);
  const [clip] = await db.select().from(schema.clips);
  assert.equal(clip.status, "analyzed");
  assert.equal(clip.error, null);
  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);

  const [video] = await db
    .select()
    .from(schema.videos)
    .where(eq(schema.videos.youtubeId, YOUTUBE_ID));
  assert.equal(video.captionStatus, "none");
});
