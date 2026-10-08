import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { generateEncryptionKey } from "@/lib/crypto";
import { setGraphFetch, type GraphFetch } from "@/lib/meta/graph";
import { saveMetaConnection } from "@/lib/meta/integration";
import {
  addIgCompetitor,
  bestCompetitorPosts,
  discoveryFields,
  median,
  normalizeIgHandle,
  NOT_AVAILABLE,
  rankAgainstMedian,
  removeIgCompetitor,
  suggestNextPosts,
  syncIgCompetitors,
  weeklyReport,
} from "@/lib/meta/discovery";

import { resetTables, teardown } from "./setup";

/**
 * S21 against recorded Business Discovery shapes (PLAN.md §6.S21): handle
 * parsing, median ranking, the sync's upsert, a personal account stored as
 * "not available", token rejection, and the weekly report. No test reaches Meta.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const IG_ID = "17841400000000001";
const TOKEN = "EAAFAKElongLivedUserToken0000000000000";
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** A Business Discovery answer for @rivalresidency, as Graph v23 returns it. */
const RIVAL = {
  business_discovery: {
    id: "17841499999999991",
    username: "rivalresidency",
    name: "Rival Residency",
    followers_count: 12400,
    media_count: 311,
    media: {
      data: [
        {
          id: "17900000000000001",
          caption: "5 documents you need for Paraguay residency\nSave this!",
          media_type: "CAROUSEL_ALBUM",
          media_product_type: "FEED",
          permalink: "https://www.instagram.com/p/AAA111/",
          timestamp: day(2),
          like_count: 900,
          comments_count: 100,
        },
        {
          id: "17900000000000002",
          caption: "Asunción on a Sunday",
          media_type: "VIDEO",
          media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/BBB222/",
          timestamp: day(3),
          like_count: 180,
          comments_count: 20,
          view_count: 5400,
        },
        {
          id: "17900000000000003",
          caption: "Office hours",
          media_type: "IMAGE",
          media_product_type: "FEED",
          permalink: "https://www.instagram.com/p/CCC333/",
          timestamp: day(20),
          like_count: 240,
          comments_count: 10,
        },
        {
          id: "17900000000000004",
          caption: "Tax residency myths",
          media_type: "IMAGE",
          media_product_type: "FEED",
          permalink: "https://www.instagram.com/p/DDD444/",
          timestamp: day(40),
          like_count: 280,
          comments_count: 20,
        },
      ],
      paging: { cursors: { after: "QVFIU" } },
    },
  },
  id: IG_ID,
};

/** A small inspiration account whose one post is 3× its usual. */
const SMALL = {
  business_discovery: {
    id: "17841499999999992",
    username: "smallcreator",
    followers_count: 800,
    media: {
      data: [
        {
          id: "17900000000000011",
          caption: "Moving with kids",
          media_type: "VIDEO",
          media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/EEE555/",
          timestamp: day(1),
          like_count: 55,
          comments_count: 5,
        },
        {
          id: "17900000000000012",
          caption: "Just a view",
          media_type: "IMAGE",
          permalink: "https://www.instagram.com/p/FFF666/",
          timestamp: day(4),
          like_count: 18,
          comments_count: 2,
        },
        {
          id: "17900000000000013",
          caption: "Another view",
          media_type: "IMAGE",
          permalink: "https://www.instagram.com/p/GGG777/",
          timestamp: day(5),
          like_count: 20,
          comments_count: 0,
        },
      ],
    },
  },
  id: IG_ID,
};

/** Graph's answer for a personal (non-Business/Creator) or unknown username. */
const NOT_BUSINESS = {
  error: {
    message: "Invalid user id",
    type: "OAuthException",
    code: 110,
    error_subcode: 2207013,
    error_user_title: "Cannot find User",
    error_user_msg: "The user with username: someperson cannot be found.",
    fbtrace_id: "AbCdEf",
  },
};

const TOKEN_ERROR = {
  error: { message: "Error validating access token", type: "OAuthException", code: 190 },
};

function discoveryFetch(answers: Record<string, { status?: number; body: unknown }>): {
  fetch: GraphFetch;
  calls: URL[];
} {
  const calls: URL[] = [];
  const fetchImpl: GraphFetch = async (raw) => {
    const url = new URL(raw);
    calls.push(url);
    const handle = url.searchParams.get("fields")?.match(/username\(([^)]+)\)/)?.[1] ?? "";
    const a = answers[handle] ?? { status: 400, body: NOT_BUSINESS };
    return new Response(JSON.stringify(a.body), {
      status: a.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

let ig = 0;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  setGraphFetch(null);
  await resetTables();
  await db.insert(schema.brands).values({
    id: "residency",
    name: "Paraguay Residency",
    domain: "paraguayresidency.co.uk",
    niche: "residency",
    market: "global",
    language: "en",
    platforms: ["instagram"],
  });
  const [row] = await insertReturning(db, schema.socialAccounts, {
    brandId: "residency",
    platform: "instagram",
    handle: "paraguayresidency",
    status: "active",
  });
  ig = row.id;
});

after(async () => {
  setGraphFetch(null);
  await teardown();
});

async function connected() {
  const row = await saveMetaConnection({
    token: TOKEN,
    expiresAt: new Date(NOW.getTime() + 50 * 86_400_000),
    userId: "10000000000001",
    userName: "Anton Marklund",
    scopes: ["instagram_basic"],
  });
  await db
    .update(schema.socialAccounts)
    .set({ externalId: IG_ID, integrationId: row.id, isProfessional: true })
    .where(eq(schema.socialAccounts.id, ig));
  return row;
}

// ---------------------------------------------------------------------------

test("handles: @, case and profile links normalise; junk is refused", () => {
  assert.equal(normalizeIgHandle("@Rival.Residency"), "rival.residency");
  assert.equal(normalizeIgHandle("https://www.instagram.com/rival_res/?hl=en"), "rival_res");
  assert.equal(normalizeIgHandle("not a handle"), null);
  assert.equal(normalizeIgHandle(""), null);
  assert.match(discoveryFields("rival", 10), /business_discovery\.username\(rival\)/);
  assert.match(discoveryFields("rival", 10), /media\.limit\(10\)/);
});

test("ranking: each post against its own account's median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const base = {
    externalId: "x",
    permalink: null,
    caption: null,
    mediaType: "IMAGE",
    postedAt: NOW,
    views: null,
    capturedAt: NOW,
  };
  const rows = [
    { ...base, id: 1, competitorId: 1, likes: 1000, comments: 0 },
    { ...base, id: 2, competitorId: 1, likes: 900, comments: 100 },
    { ...base, id: 3, competitorId: 1, likes: 2000, comments: 0 },
    { ...base, id: 4, competitorId: 2, likes: 30, comments: 0 },
    { ...base, id: 5, competitorId: 2, likes: 10, comments: 0 },
    { ...base, id: 6, competitorId: 2, likes: 10, comments: 0 },
    { ...base, id: 7, competitorId: 2, likes: null, comments: null },
  ];
  const ranked = rankAgainstMedian(rows, [
    { id: 1, handle: "big", role: "competitor" },
    { id: 2, handle: "small", role: "inspiration" },
  ]);
  assert.equal(ranked[0].id, 4, "the small account's 3× post beats the big one's 2×");
  assert.equal(ranked[0].score, 3);
  assert.equal(ranked[1].id, 3);
  assert.equal(ranked[1].score, 2);
  assert.ok(!ranked.some((r) => r.id === 7), "a post without counts is not ranked");
});

test("competitors: add normalises and upserts; remove takes the posts too", async () => {
  const a = await addIgCompetitor("residency", "@RivalResidency");
  assert.ok(a.ok);
  const again = await addIgCompetitor("residency", "rivalresidency", "inspiration");
  assert.ok(again.ok && again.competitor.id === (a.ok ? a.competitor.id : -1));
  assert.equal(again.ok && again.competitor.role, "inspiration");
  assert.deepEqual(await addIgCompetitor("residency", "no spaces"), {
    ok: false,
    error: "That is not an Instagram username.",
  });
  assert.equal((await addIgCompetitor("nope", "rival")).ok, false);

  await connected();
  const { fetch } = discoveryFetch({ rivalresidency: { body: RIVAL } });
  await syncIgCompetitors({ fetch, now: NOW });
  assert.equal((await db.select().from(schema.competitorPosts)).length, 4);
  await removeIgCompetitor(a.ok ? a.competitor.id : -1);
  assert.equal((await db.select().from(schema.socialCompetitors)).length, 0);
  assert.equal((await db.select().from(schema.competitorPosts)).length, 0);
});

test("sync: without a linked IG account nothing is called and the reason is given", async () => {
  await addIgCompetitor("residency", "rivalresidency");
  const { fetch, calls } = discoveryFetch({});
  const r = await syncIgCompetitors({ fetch, now: NOW });
  assert.equal(calls.length, 0);
  assert.match(r.skipped ?? "", /Settings → Meta/);
});

test("sync: stores posts idempotently, marks a personal account 'not available'", async () => {
  await connected();
  await addIgCompetitor("residency", "rivalresidency");
  await addIgCompetitor("residency", "smallcreator", "inspiration");
  await addIgCompetitor("residency", "someperson");
  const { fetch, calls } = discoveryFetch({
    rivalresidency: { body: RIVAL },
    smallcreator: { body: SMALL },
  });

  const r = await syncIgCompetitors({ fetch, now: NOW });
  assert.deepEqual(
    { synced: r.synced, notAvailable: r.notAvailable, posts: r.posts, errors: r.errors },
    { synced: 2, notAvailable: 1, posts: 7, errors: [] },
  );
  assert.ok(
    calls.every((u) => u.pathname.endsWith(`/${IG_ID}`)),
    "asked through our own IG id",
  );
  assert.ok(calls.every((u) => u.searchParams.get("access_token") === TOKEN));

  const comps = await db.select().from(schema.socialCompetitors);
  const rival = comps.find((c) => c.handle === "rivalresidency")!;
  assert.equal(rival.externalId, "17841499999999991");
  assert.equal(rival.followers, 12400);
  assert.equal(rival.lastError, null);
  const person = comps.find((c) => c.handle === "someperson")!;
  assert.equal(person.lastError, NOT_AVAILABLE);
  assert.ok(person.lastSyncedAt);

  const reel = (await db.select().from(schema.competitorPosts)).find(
    (p) => p.externalId === "17900000000000002",
  )!;
  assert.equal(reel.mediaType, "REEL");
  assert.equal(reel.views, 5400);

  // A second run updates counts in place.
  const bumped = structuredClone(RIVAL);
  bumped.business_discovery.media.data[0].like_count = 1900;
  const second = discoveryFetch({
    rivalresidency: { body: bumped },
    smallcreator: { body: SMALL },
  });
  await syncIgCompetitors({ fetch: second.fetch, now: NOW });
  const stored = await db.select().from(schema.competitorPosts);
  assert.equal(stored.length, 7);
  assert.equal(stored.find((p) => p.externalId === "17900000000000001")!.likes, 1900);
});

test("sync: a rejected token marks the integration expired", async () => {
  const row = await connected();
  await addIgCompetitor("residency", "rivalresidency");
  const { fetch } = discoveryFetch({ rivalresidency: { status: 400, body: TOKEN_ERROR } });
  const r = await syncIgCompetitors({ fetch, now: NOW });
  assert.equal(r.synced, 0);
  assert.equal(r.errors.length, 1);
  const [after] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, row.id));
  assert.equal(after.status, "expired");
  assert.ok(!(after.lastError ?? "").includes(TOKEN));
});

test("weekly report: own metrics, best competitor posts, three next posts", async () => {
  await connected();
  await addIgCompetitor("residency", "rivalresidency");
  await addIgCompetitor("residency", "smallcreator", "inspiration");
  const { fetch } = discoveryFetch({
    rivalresidency: { body: RIVAL },
    smallcreator: { body: SMALL },
  });
  await syncIgCompetitors({ fetch, now: NOW });

  const [own] = await insertReturning(db, schema.posts, {
    accountId: ig,
    brandId: "residency",
    format: "carousel",
    status: "published",
    title: "Residency in 5 steps",
    publishedAt: new Date(day(3)),
    permalink: "https://www.instagram.com/p/OWN1/",
  });
  await db.insert(schema.postMetrics).values({
    postId: own.id,
    capturedAt: NOW,
    reach: 1000,
    likes: 80,
    comments: 10,
    saves: 30,
    shares: 10,
  });
  await db.insert(schema.accountMetrics).values([
    { accountId: ig, date: day(6).slice(0, 10), followers: 500, reach: 300 },
    { accountId: ig, date: day(1).slice(0, 10), followers: 530, reach: 700 },
  ]);

  const best = await bestCompetitorPosts("residency", { now: NOW, days: 30 });
  assert.ok(!best.some((p) => p.externalId === "17900000000000004"), "older than 30 days");

  const report = await weeklyReport(ig, { now: NOW });
  assert.ok(report);
  assert.deepEqual(report.followers, { start: 500, end: 530 });
  assert.equal(report.reach, 1000);
  assert.equal(report.own.length, 1);
  assert.equal(report.own[0].rate, 0.05);
  // Rival median over all 4 stored posts is 275; small's median is 20.
  assert.equal(report.best[0].handle, "rivalresidency");
  assert.ok(Math.abs(report.best[0].score - 1000 / 275) < 1e-9);
  assert.ok(report.best.every((p) => p.postedAt!.getTime() >= NOW.getTime() - 7 * 86_400_000));
  assert.equal(report.suggestions.length, 3);
  assert.match(report.suggestions[0].title, /carousel.*@rivalresidency.*5 documents/);
  assert.match(report.suggestions[1].title, /@smallcreator/, "one per competitor first");
  assert.equal(await weeklyReport(999_999, { now: NOW }), null);
});

test("suggestions fall back to our own best post when competitors are few", () => {
  const s = suggestNextPosts(
    "me",
    [],
    [
      {
        id: 1,
        title: "Cost of living",
        format: "reel",
        permalink: null,
        publishedAt: NOW,
        reach: 100,
        likes: 1,
        comments: 1,
        saves: 1,
        shares: 1,
        rate: 0.03,
      },
    ],
  );
  assert.equal(s.length, 1);
  assert.match(s[0].title, /Cost of living/);
});

test("two brands tracking one handle both see its posts; removing one keeps them", async () => {
  await connected();
  await db.insert(schema.brands).values({
    id: "flytta",
    name: "Flytta till Paraguay",
    domain: "flyttatillparaguay.se",
    niche: "residency",
    market: "sweden",
    language: "sv",
    platforms: ["instagram"],
  });
  const a = await addIgCompetitor("residency", "rivalresidency");
  const b = await addIgCompetitor("flytta", "rivalresidency");
  assert.ok(a.ok && b.ok);
  const { fetch } = discoveryFetch({ rivalresidency: { body: RIVAL } });
  await syncIgCompetitors({ fetch, now: NOW });

  const one = await bestCompetitorPosts("residency", { now: NOW });
  const two = await bestCompetitorPosts("flytta", { now: NOW });
  assert.equal(one.length, 3);
  assert.deepEqual(
    two.map((p) => p.externalId),
    one.map((p) => p.externalId),
  );
  assert.ok(two.every((p) => p.competitorId === (b.ok ? b.competitor.id : -1)));

  await removeIgCompetitor(a.ok ? a.competitor.id : -1);
  assert.equal((await db.select().from(schema.competitorPosts)).length, 4);
  assert.equal((await bestCompetitorPosts("flytta", { now: NOW })).length, 3);
});
