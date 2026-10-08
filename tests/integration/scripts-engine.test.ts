import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { GET as exportScript } from "@/app/api/scripts/[id]/export/route";
import { POST as writeScript } from "@/app/api/scripts/route";
import { POST as suggestTitles } from "@/app/api/scripts/titles/route";
import { messageCostUsd, readUsage, TITLE_SUGGESTION_COUNT } from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE, WEB_SEARCH_QUERIES } from "@/lib/ai-fake";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import type { ShotList } from "@/lib/scripts/export";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * O8's routes against the Gemini test double (PLAN.md §5.O8): titles,
 * generate + save, and the three exports. Money is computed from the fake's
 * usage through `pricing.ts`, never hardcoded (see generate.test.ts).
 */

const BRAND = {
  id: "residency-guide",
  name: "Paraguay Residency Guide",
  domain: "paraguayresidencyguide.com",
  niche: "residency",
  market: "global",
  language: "es",
  voice: "Trustworthy expat guide.",
  platforms: ["youtube"],
};

let owner: Record<string, string> = {};

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values(BRAND);
  owner = { cookie: (await signIn("owner")).cookie };
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

function promptOf(call: { params: unknown }): { contents: string; system: string } {
  const params = call.params as { contents: string; config: { systemInstruction: string } };
  return { contents: params.contents, system: params.config.systemInstruction };
}

/** A competitor video with an analysis, the way the corpus stores one. */
async function competitorVideo(): Promise<number> {
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "comp0000001",
    title: "Paraguay Residency FAST",
    channelTitle: "Rival Channel",
    durationSeconds: 900,
  });
  await db.insert(schema.analyses).values({
    videoId: video.id,
    model: "gemini-3.1-flash-lite",
    status: "ok",
    summary: "SECRET-SUMMARY-WORDING that must never reach the script prompt",
    hookBreakdown: {
      technique: "Cold open on a rejection letter",
      first_30s: "…",
      why_it_works: "Fear of wasted months",
    },
    timeline: [
      { ts: "00:00", topic: "Rejection story", beat: "…" },
      { ts: "03:10", topic: "Checklist", beat: "…" },
    ],
    gaps: [{ gap: "Never mentions costs", counter_angle: "Cost table" }],
  });
  return video.id;
}

// ---------------------------------------------------------------------------
// titles
// ---------------------------------------------------------------------------

test("titles: ten options, the brand's saved patterns and style guide in the prompt, billed ungrounded", async () => {
  await db.insert(schema.lessons).values([
    { text: "Contradict a number people repeat", kind: "title_pattern", brandId: BRAND.id },
    { text: "Portfolio-wide hook lesson", kind: "hook", brandId: null },
    { text: "Other brand's pattern", kind: "title_pattern", brandId: "pozo" },
    { text: "A fact, not for titles", kind: "fact", brandId: BRAND.id },
  ]);
  const fake = fakeGeminiClient();

  const response = await callRoute(
    suggestTitles,
    jsonPost("/api/scripts/titles", { brandId: BRAND.id, topic: "Residency timeline" }, owner),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    titles: { title: string; angle: string }[];
    language: string;
    costUsd: number;
  };
  assert.equal(body.titles.length, TITLE_SUGGESTION_COUNT);
  assert.equal(body.language, "en", "residency defaults to English (§1.33)");

  const [call] = fake.callsOf("generateContent");
  assert.equal(call.responseKind, "titles");
  assert.equal(call.groundingQueries, 0, "titles are not grounded");
  const { contents } = promptOf(call);
  assert.match(contents, /Contradict a number people repeat/);
  assert.match(contents, /Portfolio-wide hook lesson/);
  assert.doesNotMatch(contents, /Other brand's pattern/);
  assert.doesNotMatch(contents, /A fact, not for titles/);
  assert.match(
    contents,
    /STYLE GUIDE[\s\S]*Style guide — English/,
    "content/style/en.md is in the prompt",
  );

  const expected = messageCostUsd(readUsage({ usageMetadata: USAGE.titles } as never), 0);
  assert.equal(body.costUsd.toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));
});

test("titles and script writing are owner-only, with generate's 401/403 shape, and spend nothing otherwise", async () => {
  const employee = { cookie: (await signIn("employee")).cookie };
  const fake = fakeGeminiClient();
  const brief = { brandId: BRAND.id, topic: "t", title: "T", targetMinutes: 5 };

  for (const [handler, path] of [
    [suggestTitles, "/api/scripts/titles"],
    [writeScript, "/api/scripts"],
  ] as const) {
    const anon = await callRoute(handler, jsonPost(path, brief));
    assert.equal(anon.status, 401);
    assert.deepEqual(await anon.json(), { error: "Sign in first." });
    const denied = await callRoute(handler, jsonPost(path, brief, employee));
    assert.equal(denied.status, 403);
    assert.match(((await denied.json()) as { error: string }).error, /owner's to spend/);
  }
  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);
});

test("titles: a bad language or missing topic is a 400 before any call", async () => {
  const fake = fakeGeminiClient();
  for (const payload of [
    { brandId: BRAND.id, topic: "x", language: "es" },
    { brandId: BRAND.id },
    { brandId: "nope", topic: "x" },
  ]) {
    const res = await callRoute(suggestTitles, jsonPost("/api/scripts/titles", payload, owner));
    assert.equal(res.status, 400, JSON.stringify(payload));
  }
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// generate + save
// ---------------------------------------------------------------------------

async function writeOne(extra: Record<string, unknown> = {}) {
  const response = await callRoute(
    writeScript,
    jsonPost(
      "/api/scripts",
      {
        brandId: BRAND.id,
        topic: "Residency timeline",
        title: "Paraguay residency in 45 days",
        targetMinutes: 6,
        ...extra,
      },
      owner,
    ),
  );
  return response;
}

test("generate: grounded call, competitor structure without its wording, a valid draft saved, tokens + queries billed", async () => {
  const videoId = await competitorVideo();
  const [lesson] = await insertReturning(db, schema.lessons, {
    text: "Migraciones publishes plazos monthly",
    kind: "fact",
    brandId: BRAND.id,
    sourceUrl: "https://example.gov.py",
  });
  const fake = fakeGeminiClient();

  const response = await writeOne({
    competitorVideoIds: [videoId],
    lessonIds: [lesson.id],
    language: "es-PY",
  });
  assert.equal(response.status, 201);
  const { script, costUsd } = (await response.json()) as {
    script: { id: number; title: string; status: string; language: string; body: ScriptBodyV1 };
    costUsd: number;
  };

  // The request.
  const [call] = fake.callsOf("generateContent");
  assert.equal(call.responseKind, "script");
  assert.equal(call.groundingQueries, WEB_SEARCH_QUERIES.length, "Search grounding is on");
  const { contents, system } = promptOf(call);
  assert.match(contents, /STRUCTURE REFERENCES[\s\S]*Do NOT copy their wording/);
  assert.match(
    contents,
    /Paraguay Residency FAST[\s\S]*Cold open on a rejection letter[\s\S]*00:00 Rejection story → 03:10 Checklist/,
  );
  assert.match(contents, /What it leaves out: Never mentions costs/);
  assert.doesNotMatch(
    contents,
    /SECRET-SUMMARY-WORDING/,
    "the competitor's own words never reach the prompt",
  );
  assert.match(
    contents,
    /Migraciones publishes plazos monthly \(source: https:\/\/example\.gov\.py\)/,
  );
  assert.match(
    contents,
    /Guía de estilo — castellano paraguayo/,
    "content/style/es-PY.md is in the prompt",
  );
  assert.match(contents, /about 840 spoken words/, "6 minutes at 140 wpm");
  assert.match(system, /sources" with the full URL/);

  // The row.
  assert.equal(script.status, "draft");
  assert.equal(script.title, "Paraguay residency in 45 days");
  assert.equal(script.language, "es-PY");
  const [row] = await db.select().from(schema.scripts);
  assert.equal(row.id, script.id);
  assert.deepEqual(validateScriptBody(row.body), { ok: true });
  const body = row.body as ScriptBodyV1;
  assert.equal(body.chosenTitle, "Paraguay residency in 45 days");
  assert.equal(body.targetMinutes, 6);
  assert.ok(
    body.sources.every((s) => /^https?:\/\//.test(s.url)),
    "every source carries a URL",
  );
  assert.ok(
    body.sources.every((s) => s.verifyBeforeRecording),
    "residency and fee facts are flagged",
  );
  assert.equal(
    body.sources.length,
    (PAYLOADS.script as { sources: unknown[] }).sources.length - 1,
    "the URL-less source is dropped",
  );

  // The money: tokens plus three grounding queries.
  const expected = messageCostUsd(
    readUsage({ usageMetadata: USAGE.script } as never),
    WEB_SEARCH_QUERIES.length,
  );
  assert.equal(costUsd.toFixed(6), expected.toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));
  const [reservation] = await db.select().from(schema.spendReservation);
  assert.equal(Number(reservation?.reservedUsd ?? 0), 0, "the reservation is released");
});

test("generate: an unknown or unanalysed competitor video is a 400 before anything is spent", async () => {
  const [bare] = await insertReturning(db, schema.videos, {
    youtubeId: "bare0000001",
    title: "No analysis",
  });
  const fake = fakeGeminiClient();
  for (const ids of [[999_999], [bare.id], ["x"]]) {
    const res = await writeOne({ competitorVideoIds: ids });
    assert.equal(res.status, 400, JSON.stringify(ids));
  }
  for (const bad of [{ targetMinutes: 0 }, { title: " " }, { language: "sv" }]) {
    assert.equal((await writeOne(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(fake.calls.length, 0);
  assert.equal((await db.select().from(schema.scripts)).length, 0);
});

test("generate: over the cap is a 429 and nothing is saved", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0.01";
  const res = await writeOne();
  assert.equal(res.status, 429);
  assert.equal((await db.select().from(schema.scripts)).length, 0);
});

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

function exportRequest(
  id: number | string,
  query: string,
  headers: Record<string, string> = owner,
): Request {
  return new Request(`http://localhost/api/scripts/${id}/export?${query}`, { headers });
}

async function runExport(id: number | string, query: string, headers?: Record<string, string>) {
  return callRoute(
    (req) => exportScript(req, { params: Promise.resolve({ id: String(id) }) }),
    exportRequest(id, query, headers),
  );
}

test("exports: teleprompter md, raw json, and the shot list as Markdown + JSON", async () => {
  const created = (await (await writeOne()).json()) as {
    script: { id: number; body: ScriptBodyV1 };
  };
  const id = created.script.id;

  const md = await runExport(id, "format=md");
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type") ?? "", /text\/markdown/);
  const text = await md.text();
  assert.match(text, /^# Paraguay residency in 45 days/);
  assert.match(text, /## Hook\n\nEveryone still says ninety days\.\n\nThat number changed\./);
  assert.match(text, /⚠ VERIFY BEFORE RECORDING: s1/);
  assert.match(text, /UNSOURCED — verify or cut/);

  const json = await runExport(id, "format=json&download=1");
  assert.deepEqual(await json.json(), created.script.body);
  assert.match(
    json.headers.get("content-disposition") ?? "",
    /attachment; filename="script-\d+-paraguay-residency-in-45-days\.json"/,
  );

  const shotsMd = await (await runExport(id, "format=shots")).text();
  assert.match(shotsMd, new RegExp(`media/${id}/01-calendar-pages-flipping\\.png`));
  assert.match(shotsMd, /```json/);

  const shots = (await (await runExport(id, "format=shots&as=json")).json()) as ShotList;
  assert.equal(shots.scriptId, id);
  assert.deepEqual(
    shots.shots.map((s) => [s.number, s.aspectRatio, s.videoPrompt === null, s.files.video]),
    [
      [1, "16:9", false, `media/${id}/01-calendar-pages-flipping.mp4`],
      [2, "16:9", true, null],
      [3, "9:16", false, `media/${id}/03-receipts-spread-on-a-table.mp4`],
    ],
  );
  assert.equal(shots.shots[0].spokenLine, "Everyone still says ninety days.");
  assert.ok(shots.shots.every((s) => s.imagePrompt.length > 10));
  assert.equal(shots.thumbnails.length, 3);
});

test("exports: signed-in only, 404 for no such script, 400 for a bad format or id", async () => {
  const created = (await (await writeOne()).json()) as { script: { id: number } };
  assert.equal((await runExport(created.script.id, "format=md", {})).status, 401);
  const employee = { cookie: (await signIn("employee")).cookie };
  assert.equal(
    (await runExport(created.script.id, "format=md", employee)).status,
    200,
    "reading is free, so not owner-gated",
  );
  assert.equal((await runExport(999_999, "format=md")).status, 404);
  assert.equal((await runExport(created.script.id, "format=pdf")).status, 400);
  assert.equal((await runExport("abc", "format=md")).status, 400);
});
