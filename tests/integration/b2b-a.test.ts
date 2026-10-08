import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  FinishReason,
  GenerateContentResponse,
  type GenerateContentParameters,
} from "@google/genai";
import { sql } from "drizzle-orm";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { fakeGeminiClient, validate } from "@/lib/ai-fake";
import { listAudienceQuestions, setAudienceQuestionStatus } from "@/lib/bridge/questions";
import { brandIdsWithCompetitors, listCompetitorReports } from "@/lib/bridge/reports";
import { linkSourceToBrand } from "@/lib/bridge/research";
import {
  generateReportAction,
  mineQuestionsAction,
  writeScriptFromQuestionAction,
} from "@/lib/report.actions";
import { mineQuestions } from "@/lib/studio/questions";
import { buildCompetitorReport } from "@/lib/studio/report";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Build 2b-A: the weekly competitor report and comment mining, end to end
 * against Postgres, the Gemini fake and a stubbed YouTube.
 *
 * The fake has no canned answer for these two schemas and this phase does not
 * edit `ai-fake.ts`, so the answers are added here: `generateContent` is
 * wrapped for the two schemas this file owns and passes everything else
 * through. Each canned answer is still checked with the fake's own
 * `validate()` against the schema the app sent, and carries realistic usage
 * metadata so the spend arithmetic runs for real.
 */

const BRAND = "pozo";
const USAGE = {
  promptTokenCount: 5_200,
  candidatesTokenCount: 900,
  thoughtsTokenCount: 400,
  totalTokenCount: 6_500,
};

type Generate = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
const fake = fakeGeminiClient();
let original: Generate;
/** Built per test, because it names video ids only known after seeding. */
let answer: ((prompt: string) => unknown) | null = null;
const prompts: string[] = [];

function kindOf(schema: unknown): "report" | "questions" | null {
  const keys = Object.keys((schema as { properties?: object } | undefined)?.properties ?? {});
  if (keys.includes("winners") && keys.includes("ideas")) return "report";
  if (keys.length === 1 && keys[0] === "questions") return "questions";
  return null;
}

before(() => {
  original = fake.models.generateContent;
  fake.models.generateContent = async (params) => {
    const schema = params.config?.responseJsonSchema;
    if (!kindOf(schema)) return original(params);
    assert.ok(answer, "a test reached the model without setting a canned answer");
    const prompt = String(params.contents);
    prompts.push(prompt);
    const payload = answer(prompt);
    validate(payload, schema);
    return Object.assign(new GenerateContentResponse(), {
      candidates: [
        {
          content: { role: "model", parts: [{ text: JSON.stringify(payload) }] },
          finishReason: FinishReason.STOP,
          index: 0,
        },
      ],
      usageMetadata: USAGE,
    });
  };
});

const realFetch = globalThis.fetch;
let commentPages: Record<string, Response | (() => Response)> = {};
let commentCalls = 0;

beforeEach(async () => {
  await resetTables();
  answer = null;
  prompts.length = 0;
  commentPages = {};
  commentCalls = 0;
  process.env.YOUTUBE_API_KEY ??= "test-key";
  await db.insert(schema.brands).values([
    {
      id: BRAND,
      name: "Pozo",
      domain: "pozo.example",
      niche: "well drilling",
      market: "paraguay",
      platforms: ["youtube"],
    },
    {
      id: "quiet",
      name: "Quiet",
      domain: "quiet.example",
      niche: "nothing",
      market: "paraguay",
      platforms: ["youtube"],
    },
  ]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "www.googleapis.com") return realFetch(input);
    assert.equal(url.pathname, "/youtube/v3/commentThreads");
    commentCalls += 1;
    const page = commentPages[url.searchParams.get("videoId") ?? ""];
    if (!page) return Response.json({ items: [] });
    return typeof page === "function" ? page() : page.clone();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(async () => {
  fake.models.generateContent = original;
  await teardown();
});

let seq = 0;
async function channel(title: string): Promise<number> {
  seq += 1;
  const [row] = await insertReturning(
    db,
    schema.sources,
    {
      kind: "channel",
      youtubeId: `UC${seq}`,
      title,
      url: `https://www.youtube.com/channel/UC${seq}`,
    },
    { id: schema.sources.id },
  );
  return row.id;
}
async function video(sourceId: number, title: string, views: number, daysAgo: number) {
  seq += 1;
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: `yt${String(seq).padStart(9, "0")}`,
    sourceId,
    title,
    channelTitle: "Rival Drilling",
    viewCount: views,
    publishedAt: sql`now() - make_interval(days => ${daysAgo})`,
    durationSeconds: 600,
  });
  return row;
}

/** Five old videos at 1,000 views set the median; one new hit and one new flop. */
async function seedCompetitor() {
  const src = await channel("Rival Drilling");
  await linkSourceToBrand(BRAND, src, "competitor");
  for (let i = 0; i < 5; i++) await video(src, `Old video ${i}`, 1_000, 40 + i);
  const hit = await video(src, "How deep should a well be?", 9_000, 2);
  const flop = await video(src, "Our new truck", 300, 3);
  await db.insert(schema.analyses).values({
    videoId: hit.id,
    model: "gemini-3.1-flash-lite",
    status: "ok",
    summary: "Explains depth by soil type.",
  });
  return { src, hit, flop };
}

let revalidated = false;
async function as<T>(role: "owner" | "employee", run: () => Promise<T>): Promise<T> {
  const { cookie } = await signIn(role, `${role}-${Math.random()}@example.com`);
  let value: T;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore() as unknown as Record<string, unknown>;
      store.incrementalCache ??= {};
      value = await run();
      revalidated = store.pathWasRevalidated === true;
      return new Response(null, { status: 204 });
    },
    new Request("http://localhost/research/report", { method: "POST", headers: { cookie } }),
  );
  return value!;
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

test("a report is built from the window's outliers, validated, and saved with its cost", async () => {
  const { hit, flop } = await seedCompetitor();
  answer = () => ({
    summary: "Depth explainers beat the channel median by 9×.",
    winners: [
      { videoId: hit.id, whyItWorked: "A question every buyer has, answered with numbers." },
      { videoId: 999_999, whyItWorked: "Invented by the model." },
    ],
    patterns: ["A question as the title"],
    ideas: [
      { title: "How deep should a well be?", angle: "A copy.", basedOnVideoIds: [hit.id] },
      {
        title: "Well depth in the Chaco, by district",
        angle: "Local numbers they skipped.",
        basedOnVideoIds: [hit.id, flop.id],
      },
    ],
  });

  const result = await buildCompetitorReport(BRAND);
  assert.ok(result.ok);
  const { report } = result;
  assert.equal(report.periodDays, 7);
  assert.ok(report.costUsd > 0, "Gemini mode bills the call");

  const prompt = prompts[0];
  assert.match(prompt, new RegExp(`id ${hit.id}: "How deep should a well be\\?"`));
  assert.match(prompt, /Explains depth by soil type\./, "the analysis summary reaches the model");
  assert.doesNotMatch(
    prompt,
    /Our new truck/,
    "a video under its channel's median is not an outlier",
  );
  assert.doesNotMatch(prompt, /Old video/, "older than the window");

  assert.deepEqual(
    report.body.winners.map((w) => w.videoId),
    [hit.id],
    "unknown ids dropped",
  );
  assert.equal(report.body.winners[0].outlierScore, 9, "score from our data: 9,000 ÷ median 1,000");
  assert.deepEqual(
    report.body.ideas.map((i) => i.title),
    ["Well depth in the Chaco, by district"],
    "the copy is dropped",
  );
  assert.deepEqual(
    report.body.ideas[0].basedOnVideoIds,
    [hit.id],
    "the sub-median flop was not in the input",
  );

  const [stored] = await listCompetitorReports(BRAND);
  assert.equal(stored.id, report.id);
  const [spend] = await db.select().from(schema.spendLog);
  assert.equal(
    Number(spend.costUsd).toFixed(6),
    report.costUsd.toFixed(6),
    "the row's cost is what was billed",
  );
});

test("nothing above the median in the window: no model call, nothing saved", async () => {
  const src = await channel("Sleepy");
  await linkSourceToBrand("quiet", src);
  for (let i = 0; i < 5; i++) await video(src, `Old ${i}`, 1_000, 40 + i);
  await video(src, "New but average", 900, 1);

  const result = await buildCompetitorReport("quiet");
  assert.deepEqual(result.ok, false);
  assert.equal(!result.ok && result.reason, "no_outliers");
  assert.equal(prompts.length, 0);
  assert.deepEqual(await listCompetitorReports("quiet"), []);
});

test("brandIdsWithCompetitors lists only brands with linked channels", async () => {
  await seedCompetitor();
  assert.deepEqual(await brandIdsWithCompetitors(), [BRAND]);
});

test("Generate now is owner-only and returns the refusal as text", async () => {
  await seedCompetitor();
  const refused = await as("employee", () => generateReportAction(BRAND));
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.error : "", /owner/i);
  assert.equal(prompts.length, 0, "an employee never reaches the model");

  const quiet = await as("owner", () => generateReportAction("quiet"));
  assert.equal(quiet.ok, false);
  assert.match(!quiet.ok ? quiet.error : "", /No new outliers/);

  answer = () => ({
    summary: "s",
    winners: [],
    patterns: [],
    ideas: [{ title: "Mine", angle: "a", basedOnVideoIds: [] }],
  });
  const made = await as("owner", () => generateReportAction(BRAND));
  assert.ok(made.ok);
  assert.ok(revalidated);
  assert.equal((await listCompetitorReports(BRAND)).length, 1);
});

// ---------------------------------------------------------------------------
// comment mining
// ---------------------------------------------------------------------------

function comments(...texts: string[]) {
  return Response.json({
    items: texts.map((text, i) => ({
      id: `c${i}`,
      snippet: {
        totalReplyCount: 0,
        topLevelComment: { id: `c${i}`, snippet: { textDisplay: text, likeCount: i } },
      },
    })),
  });
}

test("mining: only question-like comments reach the model; clusters upsert and merge", async () => {
  const { hit, flop } = await seedCompetitor();
  commentPages[hit.youtubeId] = comments(
    "How deep for a house in Luque?",
    "Great video!!",
    "¿Cuánto cuesta perforar?",
  );
  commentPages[flop.youtubeId] = new Response(
    JSON.stringify({ error: { code: 403, errors: [{ reason: "commentsDisabled" }] } }),
    { status: 403 },
  );

  answer = () => ({
    questions: [
      {
        question: "How deep should a well be for a house?",
        askCount: 1,
        examples: ["How deep for a house in Luque?"],
        videoIds: [hit.id, 424242],
      },
      {
        question: "¿Cuánto cuesta perforar un pozo?",
        askCount: 1,
        examples: ["¿Cuánto cuesta perforar?"],
        videoIds: [hit.id],
      },
    ],
  });
  const first = await mineQuestions(BRAND, { videos: 10 });
  assert.ok(first.ok);
  assert.equal(first.inserted, 2);
  assert.equal(first.questionComments, 2);
  assert.equal(commentCalls, 7, "one page per scored video; comments disabled is not an error");
  assert.match(prompts[0], /How deep for a house in Luque\?/);
  assert.doesNotMatch(prompts[0], /Great video/, "praise is filtered out before it is paid for");

  let rows = await listAudienceQuestions(BRAND);
  const depth = rows.find((r) => r.question.startsWith("How deep"))!;
  assert.deepEqual(depth.videoIds, [hit.id], "unknown video ids dropped");
  await setAudienceQuestionStatus(depth.id, "dismissed");

  // Same question, different punctuation and case: bumped and merged, status kept.
  answer = () => ({
    questions: [
      {
        question: "how deep should a well be for a house",
        askCount: 3,
        examples: ["Is 40 m enough?"],
        videoIds: [flop.id],
      },
    ],
  });
  commentPages[flop.youtubeId] = comments("Is 40 m enough?");
  const second = await mineQuestions(BRAND);
  assert.ok(second.ok);
  assert.deepEqual([second.inserted, second.updated], [0, 1]);
  rows = await listAudienceQuestions(BRAND);
  assert.equal(rows.length, 2);
  const merged = rows.find((r) => r.id === depth.id)!;
  assert.equal(merged.askCount, 4);
  assert.deepEqual(merged.examples, ["How deep for a house in Luque?", "Is 40 m enough?"]);
  assert.deepEqual(merged.videoIds, [hit.id, flop.id]);
  assert.equal(merged.status, "dismissed", "a dismissed question stays dismissed");
  assert.deepEqual(
    rows.map((r) => r.askCount),
    [4, 1],
    "most asked first",
  );
});

test("mining with no question-like comments spends nothing", async () => {
  const { hit } = await seedCompetitor();
  commentPages[hit.youtubeId] = comments("Great video!!", "Que buen contenido");
  const result = await mineQuestions(BRAND);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no_questions");
  assert.equal(prompts.length, 0);
});

test("Mine comments is owner-only; Write script marks a question used and links the brief", async () => {
  const { hit } = await seedCompetitor();
  commentPages[hit.youtubeId] = comments("Why is my well water salty?");
  answer = () => ({
    questions: [
      {
        question: "Why is my well water salty?",
        askCount: 2,
        examples: ["Why is my well water salty?"],
        videoIds: [hit.id],
      },
    ],
  });

  const refused = await as("employee", () => mineQuestionsAction(BRAND));
  assert.equal(refused.ok, false);
  assert.equal(commentCalls, 0, "an employee never reaches YouTube");

  const mined = await as("owner", () => mineQuestionsAction(BRAND));
  assert.ok(mined.ok && mined.inserted === 1);

  const [q] = await listAudienceQuestions(BRAND);
  const res = await as("employee", () => writeScriptFromQuestionAction(q.id));
  assert.ok(res.ok);
  const url = new URL(res.ok ? res.href : "", "http://x");
  assert.equal(url.pathname, "/studio/new");
  assert.equal(url.searchParams.get("brand"), BRAND);
  assert.equal(url.searchParams.get("topic"), "Why is my well water salty?");
  assert.equal((await listAudienceQuestions(BRAND, { status: "used" })).length, 1);
});
