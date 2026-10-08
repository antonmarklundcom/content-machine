import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { POST as writeScript } from "@/app/api/scripts/route";
import { fakeGeminiClient } from "@/lib/ai-fake";
import { compareBrandChannels } from "@/lib/bridge/compare";
import {
  brandScriptsNeedingCorrection,
  createFact,
  getFact,
  InvalidFactError,
  listFactsByTopic,
  markFactChecked,
  updateFact,
} from "@/lib/bridge/facts";
import {
  createFactAction,
  deleteFactAction,
  markFactCheckedAction,
  updateFactAction,
} from "@/lib/facts.actions";
import { outlierScores } from "@/lib/research/outlier";
import { sampleScriptBody } from "@/lib/scripts/fixture";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Build 2b · B: fact sheets (CRUD, the updatedAt rule, the out-of-date check,
 * facts in the script prompt) and the own-channel compare bridge, against a
 * real Postgres. The staleness rule itself is unit-tested beside its module.
 */

const BRAND = {
  id: "residency-guide",
  name: "Paraguay Residency Guide",
  domain: "paraguayresidencyguide.com",
  niche: "residency",
  market: "global",
  platforms: ["youtube"],
};
const SOURCE_URL = "https://example.gov.py/migraciones/plazos";

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values(BRAND);
});
after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

/** Run a server action as a signed-in user (see research-ui.test.ts for why the store is patched). */
async function as<T>(role: "owner" | "employee", run: () => Promise<T>): Promise<T> {
  const { cookie } = await signIn(role, `${role}-${Math.random()}@example.com`);
  let value: T;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore() as unknown as Record<string, unknown>;
      store.incrementalCache ??= {};
      value = await run();
      return new Response(null, { status: 204 });
    },
    new Request("http://localhost/facts", { method: "POST", headers: { cookie } }),
  );
  return value!;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const factFields = {
  topic: "Residency",
  claim: "Applications take about 45 days.",
  sourceUrl: SOURCE_URL,
  notes: "",
};

// ---------------------------------------------------------------------------
// facts
// ---------------------------------------------------------------------------

test("facts: the owner adds, edits, checks and deletes; an employee is refused every write", async () => {
  assert.deepEqual(await as("owner", () => createFactAction(BRAND.id, null, form(factFields))), {
    ok: true,
  });
  assert.deepEqual(
    await as("owner", () =>
      createFactAction(
        BRAND.id,
        null,
        form({ ...factFields, topic: "Costs", claim: "The fee is fixed." }),
      ),
    ),
    { ok: true },
  );
  const groups = await listFactsByTopic(BRAND.id);
  assert.deepEqual(
    groups.map((g) => [g.topic, g.facts.length]),
    [
      ["Costs", 1],
      ["Residency", 1],
    ],
    "grouped by topic, in topic order",
  );
  const fact = groups[1].facts[0];
  assert.equal(fact.sourceUrl, SOURCE_URL);
  assert.equal(fact.notes, null, "a blank note is stored as none");

  for (const denied of [
    () => createFactAction(BRAND.id, null, form(factFields)),
    () => updateFactAction(fact.id, null, form({ ...factFields, claim: "changed" })),
    () => markFactCheckedAction(fact.id),
    () => deleteFactAction(fact.id),
  ]) {
    assert.deepEqual(await as("employee", denied), { ok: false, error: "facts.error.owner" });
  }
  assert.equal((await getFact(fact.id))?.claim, factFields.claim, "the employee changed nothing");

  assert.deepEqual(
    await as("owner", () =>
      updateFactAction(fact.id, null, form({ ...factFields, claim: "About 60 days now." })),
    ),
    { ok: true },
  );
  assert.equal((await getFact(fact.id))?.claim, "About 60 days now.");

  await db
    .update(schema.facts)
    .set({ lastCheckedAt: new Date("2025-01-01T00:00:00Z") })
    .where(eq(schema.facts.id, fact.id));
  assert.deepEqual(await as("owner", () => markFactCheckedAction(fact.id)), { ok: true });
  const checked = await getFact(fact.id);
  assert.ok(
    checked && checked.lastCheckedAt.getTime() > new Date("2026-01-01").getTime(),
    "checked today",
  );

  assert.deepEqual(await as("owner", () => deleteFactAction(fact.id)), { ok: true });
  assert.equal(await getFact(fact.id), null);
  assert.deepEqual(await as("owner", () => deleteFactAction(fact.id)), {
    ok: false,
    error: "facts.error.missing",
  });
});

test("facts: bad input comes back as a key and a reason, never a thrown error", async () => {
  assert.deepEqual(await as("owner", () => createFactAction("nope", null, form(factFields))), {
    ok: false,
    error: "facts.error.brand",
  });
  const noClaim = await as("owner", () =>
    createFactAction(BRAND.id, null, form({ ...factFields, claim: "  " })),
  );
  assert.equal(noClaim.ok, false);
  assert.equal(!noClaim.ok && noClaim.error, "facts.error.invalid");
  const badUrl = await as("owner", () =>
    createFactAction(BRAND.id, null, form({ ...factFields, sourceUrl: "javascript:alert(1)" })),
  );
  assert.equal(!badUrl.ok && badUrl.error, "facts.error.invalid");
  assert.deepEqual(await as("owner", () => updateFactAction(999, null, form(factFields))), {
    ok: false,
    error: "facts.error.missing",
  });
  await assert.rejects(createFact(BRAND.id, { topic: "", claim: "x" }), InvalidFactError);
  assert.deepEqual(await listFactsByTopic(BRAND.id), []);
});

test("facts: only a new claim or source bumps updatedAt; topic, notes and checking do not", async () => {
  const fact = await createFact(BRAND.id, factFields);
  const long_ago = new Date("2026-01-01T00:00:00.000Z");
  await db.update(schema.facts).set({ updatedAt: long_ago }).where(eq(schema.facts.id, fact.id));

  await updateFact(fact.id, { ...factFields, topic: "Residency permits", notes: "re-filed" });
  await markFactChecked(fact.id);
  assert.equal((await getFact(fact.id))?.updatedAt.getTime(), long_ago.getTime());

  await updateFact(fact.id, {
    ...factFields,
    topic: "Residency permits",
    sourceUrl: `${SOURCE_URL}/2026`,
  });
  const moved = await getFact(fact.id);
  assert.ok(moved && moved.updatedAt.getTime() > long_ago.getTime(), "a new source is a change");

  await db.update(schema.facts).set({ updatedAt: long_ago }).where(eq(schema.facts.id, fact.id));
  await updateFact(fact.id, { ...factFields, claim: "Something else" });
  assert.ok(
    (await getFact(fact.id))!.updatedAt.getTime() > long_ago.getTime(),
    "a new claim is a change",
  );
});

// ---------------------------------------------------------------------------
// out-of-date check
// ---------------------------------------------------------------------------

async function postedScript(
  title: string,
  postedDaysAgo: number,
  status: "posted" | "ready" = "posted",
) {
  const [row] = await insertReturning(db, schema.scripts, {
    brandId: BRAND.id,
    title,
    language: "en",
    status,
    body: sampleScriptBody(),
    postedAt: status === "posted" ? sql`date_sub(now(), interval ${postedDaysAgo} day)` : null,
  });
  return row;
}

test("a posted script is flagged once a fact on a source it cites changes after posting", async () => {
  const fact = await createFact(BRAND.id, { ...factFields, sourceUrl: `${SOURCE_URL}/` });
  await db
    .update(schema.facts)
    .set({ updatedAt: sql`date_sub(now(), interval 30 day)` })
    .where(eq(schema.facts.id, fact.id));
  const recent = await postedScript("Posted after the change", 10);
  await postedScript("Not posted yet", 0, "ready");
  await db.insert(schema.scripts).values({
    brandId: "other",
    title: "Other brand",
    language: "en",
    status: "posted",
    body: sampleScriptBody(),
    postedAt: sql`date_sub(now(), interval 40 day)`,
  });

  assert.deepEqual(
    await brandScriptsNeedingCorrection(BRAND.id),
    [],
    "the fact changed before the video went out",
  );

  const older = await postedScript("Posted before the change", 60);
  let flagged = await brandScriptsNeedingCorrection(BRAND.id);
  assert.deepEqual(
    flagged.map((f) => f.scriptId),
    [older.id],
  );
  assert.deepEqual(
    flagged[0].facts.map((f) => f.id),
    [fact.id],
  );

  // Editing the claim today flags the recent one too; checking it again does not.
  await updateFact(fact.id, { ...factFields, claim: "About 60 days now." });
  flagged = await brandScriptsNeedingCorrection(BRAND.id);
  assert.deepEqual(
    flagged.map((f) => f.scriptId),
    [recent.id, older.id],
    "newest-posted first",
  );
  assert.equal(flagged[0].title, "Posted after the change");
});

test("a script whose body has no sources array is simply not flagged", async () => {
  await createFact(BRAND.id, factFields);
  await db.insert(schema.scripts).values({
    brandId: BRAND.id,
    title: "Odd body",
    language: "en",
    status: "posted",
    body: { version: 0 },
    postedAt: sql`date_sub(now(), interval 5 day)`,
  });
  assert.deepEqual(await brandScriptsNeedingCorrection(BRAND.id), []);
});

// ---------------------------------------------------------------------------
// facts in the script prompt
// ---------------------------------------------------------------------------

test("POST /api/scripts gives the model the brand's facts, to use as-is and cite", async () => {
  await createFact(BRAND.id, factFields);
  await createFact("other", { topic: "Wells", claim: "OTHER-BRAND-FACT", sourceUrl: null });
  await createFact(BRAND.id, { topic: "Costs", claim: "Unsourced cost fact", sourceUrl: null });
  const owner = { cookie: (await signIn("owner")).cookie };
  const fake = fakeGeminiClient();

  const response = await callRoute(
    writeScript,
    jsonPost(
      "/api/scripts",
      { brandId: BRAND.id, topic: "Timeline", title: "Residency in 45 days", targetMinutes: 5 },
      owner,
    ),
  );
  assert.equal(response.status, 201);

  const [call] = fake.callsOf("generateContent");
  const contents = (call.params as { contents: string }).contents;
  assert.match(
    contents,
    /FACTS — [\s\S]*use these checked facts as-is[\s\S]*A fact not listed here[\s\S]*still needs its own source/i,
  );
  assert.ok(
    contents.includes(`- [Residency] Applications take about 45 days. (source: ${SOURCE_URL})`),
    "the fact and its URL, verbatim",
  );
  assert.match(contents, /- \[Costs\] Unsourced cost fact \(no source URL on file\)/);
  assert.doesNotMatch(contents, /OTHER-BRAND-FACT/, "another brand's sheet stays out");
});

test("with no facts on the sheet, the prompt has no FACTS block", async () => {
  const owner = { cookie: (await signIn("owner")).cookie };
  const fake = fakeGeminiClient();
  const response = await callRoute(
    writeScript,
    jsonPost(
      "/api/scripts",
      { brandId: BRAND.id, topic: "Timeline", title: "Residency in 45 days", targetMinutes: 5 },
      owner,
    ),
  );
  assert.equal(response.status, 201);
  assert.doesNotMatch(
    (fake.callsOf("generateContent")[0].params as { contents: string }).contents,
    /FACTS —/,
  );
});

// ---------------------------------------------------------------------------
// own channel vs competitors
// ---------------------------------------------------------------------------

async function channel(
  youtubeId: string,
  title: string,
  role: "own" | "competitor" | "inspiration" | null,
) {
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
  if (role)
    await db.insert(schema.brandSources).values({ brandId: BRAND.id, sourceId: row.id, role });
  return row.id;
}

let seq = 0;
async function upload(sourceId: number, viewCount: number | null, daysAgo: number) {
  seq += 1;
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: `c${String(seq).padStart(10, "0")}`,
    sourceId,
    title: `Title ${seq}`,
    viewCount,
    publishedAt: sql`date_sub(now(), interval ${daysAgo} day)`,
    durationSeconds: 600,
  });
  return row;
}

test("compare: own channel first, median, uploads per month, best five by the reference outlier score", async () => {
  const mine = await channel("UCmine", "Anton", "own");
  const rival = await channel("UCrival", "Rival", "competitor");
  const muse = await channel("UCmuse", "Muse", "inspiration");
  await channel("UCunlinked", "Not linked", null);

  // Mine: 6 videos, 3 of them in the last 90 days → 1 upload/month.
  const mineViews = [100, 200, 300, 400, 500, 5000];
  for (const [i, views] of mineViews.entries())
    await upload(mine, views, i < 3 ? 10 + i * 20 : 200 + i);
  // Rival: 8 videos, all recent → 8 × 30 / 90 = 2.7 per month; one hidden count.
  const rivalRows = [];
  for (const [i, views] of [1000, 2000, 3000, 4000, 5000, 6000, 90000, null].entries()) {
    rivalRows.push(await upload(rival, views, 1 + i));
  }
  // Muse: 3 videos — no baseline, so no median and no best list.
  for (const views of [10, 20, 30]) await upload(muse, views, 5);

  const result = await compareBrandChannels(BRAND.id);
  assert.deepEqual(
    result.channels.map((c) => [c.title, c.role]),
    [
      ["Anton", "own"],
      ["Rival", "competitor"],
      ["Muse", "inspiration"],
    ],
    "own first, then by median, unlinked channels absent",
  );
  const [a, r, m] = result.channels;
  assert.equal(a.medianViews, 350);
  assert.equal(a.uploadsPerMonth, 1);
  assert.equal(a.videoCount, 6);
  assert.equal(r.medianViews, 4000);
  assert.equal(r.uploadsPerMonth, 2.7);
  assert.equal(m.medianViews, null);
  assert.deepEqual(m.best, []);

  // Best five agree with the pure reference.
  const allVideos = await db.select().from(schema.videos).where(eq(schema.videos.sourceId, rival));
  const reference = outlierScores(allVideos);
  const expected = allVideos
    .filter((v) => reference.get(v.id) !== null)
    .sort((x, y) => reference.get(y.id)! - reference.get(x.id)! || y.id - x.id)
    .slice(0, 5);
  assert.deepEqual(
    r.best.map((v) => v.videoId),
    expected.map((v) => v.id),
  );
  for (const v of r.best) assert.ok(Math.abs(v.score! - reference.get(v.videoId)!) < 1e-9);
  assert.equal(r.best[0].viewCount, 90000);

  // Titles: my latest (newest first) beside the competitors' best across channels.
  assert.equal(result.ownTitles.length, 6);
  assert.equal(result.ownTitles[0].sourceId, mine);
  const ownDates = result.ownTitles.map((v) => v.publishedAt!.getTime());
  assert.deepEqual(
    ownDates,
    [...ownDates].sort((x, y) => y - x),
  );
  assert.ok(
    result.competitorTitles.every((v) => v.sourceId !== mine),
    "no own titles on the competitor side",
  );
  assert.equal(result.competitorTitles[0].title, rivalRows[6].title);
});

test("compare: a brand with no links is empty, not an error", async () => {
  assert.deepEqual(await compareBrandChannels(BRAND.id), {
    channels: [],
    ownTitles: [],
    competitorTitles: [],
  });
});
