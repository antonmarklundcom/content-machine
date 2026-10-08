import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { createPool } from "mysql2/promise";
import { databaseOptions } from "@/db/driver";

import { db, schema } from "@/db";
import { listClips } from "@/lib/bridge";
import { saveClip, updateClipCapture } from "@/lib/clips/save";
import { POST as saveClipRoute } from "@/app/api/clips/route";
import {
  handleWebhook,
  resetBrandCache,
  type Query,
} from "../../workers/telegram-capture/src/handler";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";
import { workerQueryFromPool } from "./worker-db";

/**
 * S16 (PLAN.md §6.S16): the inbox's brand / purpose / tag filters, the capture
 * fields on `POST /api/clips`, the inline edit, and the Telegram Worker's one
 * SQL statement run against native MariaDB (its unit tests use a mock).
 */

const BRANDS = [
  { id: "guide", name: "Guide", domain: "g.test", niche: "n", market: "paraguay", platforms: [] },
  { id: "flytta", name: "Flytta", domain: "f.test", niche: "n", market: "sweden", platforms: [] },
];

const pool = createPool({ ...databaseOptions(process.env.DATABASE_URL), flags: ["-FOUND_ROWS"] });
const mysqlQuery: Query = workerQueryFromPool(pool);

beforeEach(async () => {
  await resetTables();
  resetBrandCache();
  await db.insert(schema.brands).values(BRANDS);
});
after(async () => {
  await pool.end();
  await teardown();
});

test("the inbox filters by brand, purpose and tag, alone and combined", async () => {
  await saveClip({
    url: "https://x.com/1",
    brandId: "guide",
    purpose: "fact_check",
    tags: ["visa"],
  });
  await saveClip({
    url: "https://x.com/2",
    brandId: "guide",
    purpose: "inspo",
    tags: ["Visa", "#hook"],
  });
  await saveClip({ url: "https://x.com/3", brandId: "flytta", purpose: "fact_check" });
  await saveClip({ url: "https://x.com/4" });

  const urls = async (q: Parameters<typeof listClips>[0]) =>
    (await listClips(q)).clips.map((c) => c.url).sort();

  assert.deepEqual(await urls({ brandId: "guide" }), ["https://x.com/1", "https://x.com/2"]);
  assert.deepEqual(await urls({ purpose: "fact_check" }), ["https://x.com/1", "https://x.com/3"]);
  assert.deepEqual(await urls({ tag: "visa" }), ["https://x.com/1", "https://x.com/2"]);
  assert.deepEqual(await urls({ tag: "hook" }), ["https://x.com/2"], "tags are stored without #");
  assert.deepEqual(await urls({ brandId: "guide", purpose: "fact_check", tag: "visa" }), [
    "https://x.com/1",
  ]);
  assert.equal((await listClips({ purpose: "other" })).total, 1, "the default purpose");
  assert.equal((await listClips({ brandId: "guide", tag: "nope" })).total, 0);
});

test("a re-save keeps brand, purpose and tags and only updates the note", async () => {
  await saveClip({ url: "https://x.com/a", note: "one", brandId: "guide", purpose: "own" });
  const again = await saveClip({
    url: "https://x.com/a",
    note: "two",
    brandId: "flytta",
    purpose: "inspo",
  });
  assert.ok(again.ok);
  assert.equal(again.created, false);
  assert.equal(again.clip.note, "two");
  assert.equal(again.clip.brandId, "guide");
  assert.equal(again.clip.purpose, "own");
});

test("the inline edit overwrites brand, purpose and tags", async () => {
  const saved = await saveClip({ url: "https://x.com/e", brandId: "guide", tags: ["a"] });
  assert.ok(saved.ok);
  const row = await updateClipCapture(saved.clip.id, {
    brandId: "flytta",
    purpose: "competitor",
    tags: ["#B", "b", " c "],
  });
  assert.equal(row?.brandId, "flytta");
  assert.equal(row?.purpose, "competitor");
  assert.deepEqual(row?.tags, ["b", "c"]);
  assert.equal(await updateClipCapture(9999, { brandId: null, purpose: "other", tags: [] }), null);
});

test("POST /api/clips takes capture fields and lifts hashtags out of the note", async () => {
  const { cookie } = await signIn("owner");

  const byHashtag = await callRoute(
    saveClipRoute,
    jsonPost(
      "/api/clips",
      { url: "https://instagram.com/reel/h", note: "#guide #factcheck #visa 90 days?" },
      { cookie },
    ),
  );
  assert.equal(byHashtag.status, 201);
  const a = (await byHashtag.json()).clip;
  assert.equal(a.brandId, "guide");
  assert.equal(a.purpose, "fact_check");
  assert.deepEqual(a.tags, ["visa"]);
  assert.equal(a.note, "90 days?");
  assert.equal(a.source, "web");

  const explicit = await callRoute(
    saveClipRoute,
    jsonPost(
      "/api/clips",
      {
        url: "https://instagram.com/reel/e",
        note: "#guide #x",
        brandId: "flytta",
        purpose: "inspo",
        tags: "y, z",
        source: "share",
      },
      { cookie },
    ),
  );
  assert.equal(explicit.status, 201);
  const b = (await explicit.json()).clip;
  assert.equal(b.brandId, "flytta", "an explicit field wins over a hashtag");
  assert.equal(b.purpose, "inspo");
  assert.deepEqual(b.tags, ["x", "y", "z"]);
  assert.equal(b.source, "share");

  const badBrand = await callRoute(
    saveClipRoute,
    jsonPost("/api/clips", { url: "https://x.com/bad", brandId: "nope" }, { cookie }),
  );
  assert.equal(badBrand.status, 400);
  const badPurpose = await callRoute(
    saveClipRoute,
    jsonPost("/api/clips", { url: "https://x.com/bad", purpose: "nope" }, { cookie }),
  );
  assert.equal(badPurpose.status, 400);
  assert.equal((await listClips({})).total, 2, "a refused request writes nothing");
});

test("the Telegram Worker's upsert works against the native MariaDB clips table", async () => {
  const env = { TELEGRAM_WEBHOOK_SECRET: "sek", TELEGRAM_ALLOWED_CHAT_IDS: "5" };
  const send = async (text: string) => {
    const res = await handleWebhook(
      new Request("https://w.test/", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "sek" },
        body: JSON.stringify({ message: { message_id: 1, chat: { id: 5 }, text } }),
      }),
      env,
      mysqlQuery,
    );
    return ((await res.json()) as { text: string }).text;
  };

  assert.equal(
    await send("https://www.instagram.com/reel/t/?igsh=1 #guide #competitor #hook first"),
    "Saved ✓ (guide, competitor)",
  );
  assert.equal(
    await send("https://instagram.com/reel/t #flytta #inspo second"),
    "Already saved, note updated",
  );

  const { clips } = await listClips({ brandId: "guide" });
  assert.equal(clips.length, 1);
  const [clip] = clips;
  assert.equal(clip!.url, "https://instagram.com/reel/t", "canonicalised like the app");
  assert.equal(clip!.note, "second");
  assert.equal(clip!.purpose, "competitor", "a re-save changes the note only");
  assert.deepEqual(clip!.tags, ["hook"]);
  assert.equal(clip!.source, "telegram");
  assert.equal(clip!.platform, "instagram");

  // The same link from the app afterwards is the same row.
  const fromApp = await saveClip({ url: "https://instagram.com/reel/t?utm_source=x" });
  assert.ok(fromApp.ok);
  assert.equal(fromApp.created, false);
});

test("an unchanged Worker duplicate is Already saved, including no-note captures", async () => {
  const { SAVE_SQL } = await import("../../workers/telegram-capture/src/handler");
  const args = ["https://worker.test/unchanged", "other", null];
  const first = await mysqlQuery(SAVE_SQL, args);
  const repeat = await mysqlQuery(SAVE_SQL, args);
  assert.equal(first[0].created, true);
  assert.equal(repeat[0].created, false);
  assert.equal(first[0].id, repeat[0].id);
});
