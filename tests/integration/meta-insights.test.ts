import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as callback } from "@/app/api/meta/callback/route";
import { GET as connect } from "@/app/api/meta/connect/route";
import { POST as syncRoute } from "@/app/api/meta/sync/route";
import { POST as createPost } from "@/app/api/posts/route";
import { fakeGeminiClient } from "@/lib/ai-fake";
import {
  decryptSecret,
  DecryptError,
  encryptSecret,
  encryptionKeyProblem,
  generateEncryptionKey,
} from "@/lib/crypto";
import { GraphClient, MetaGraphError, setGraphFetch, type GraphFetch } from "@/lib/meta/graph";
import { expiryBanner, saveMetaConnection } from "@/lib/meta/integration";
import { mapIgMediaInsights, normalizePermalink } from "@/lib/meta/insights";
import { metaState } from "@/lib/meta/state";
import { syncMeta } from "@/lib/meta/sync";
import { whatWorked } from "@/lib/posts/what-worked";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * O12 against recorded Graph API fixtures (PLAN.md §5.O12): token encryption,
 * the Facebook Login callback, per-media-type insight mapping, matching by
 * media id and permalink, the account-day upsert, token expiry → `expired` +
 * banner, and "what worked" reaching the post prompt. No test reaches Meta.
 */

const FIX = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/meta/${name}.json`, import.meta.url), "utf8"));

const NOW = new Date("2026-09-27T12:00:00Z");
const IG_ID = "17841400000000001";
const PAGE_ID = "111000000000002";
const LONG_TOKEN = "EAAFAKElongLivedUserToken0000000000000";
const PAGE_TOKEN = "EAAFAKEpageToken00000000000000000000";

type Answer = { status?: number; body: unknown };
type Override = (path: string, url: URL) => Answer | undefined;

function fixtureFetch(override?: Override): { fetch: GraphFetch; calls: URL[] } {
  const calls: URL[] = [];
  const route = (path: string, url: URL): Answer => {
    const p = url.searchParams;
    switch (path) {
      case "oauth/access_token":
        return {
          body: FIX(p.get("grant_type") === "fb_exchange_token" ? "oauth-long" : "oauth-short"),
        };
      case "me":
        return { body: FIX("me") };
      case "me/permissions":
        return { body: FIX("me-permissions") };
      case "me/accounts":
        return { body: FIX("me-accounts") };
      case `${IG_ID}/media`:
        return { body: FIX(p.get("after") ? "ig-media-page2" : "ig-media-page1") };
      case "18000000000000001/insights":
        return { body: FIX("insights-reel") };
      case "18000000000000002/insights":
        return { body: FIX("insights-carousel") };
      case "18000000000000004/insights":
        return p.get("metric")?.includes("follows")
          ? { status: 400, body: FIX("error-metric") }
          : { body: FIX("insights-image-basic") };
      case IG_ID:
        return { body: FIX("ig-user") };
      case `${IG_ID}/insights`:
        return { body: FIX("ig-user-insights") };
      case PAGE_ID:
        return { body: FIX(p.get("fields") === "access_token" ? "page-token" : "page") };
      case `${PAGE_ID}/posts`:
        return { body: FIX("page-posts") };
      case `${PAGE_ID}_900000000000001/insights`:
        return { body: FIX("page-post-insights") };
      case `${PAGE_ID}/insights`:
        return { body: FIX("page-insights") };
      default:
        return { status: 404, body: { error: { message: `no fixture for ${path}`, code: 803 } } };
    }
  };
  const fetchImpl: GraphFetch = async (raw) => {
    const url = new URL(raw);
    calls.push(url);
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    const answer = override?.(path, url) ?? route(path, url);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

let owner: Record<string, string> = {};
let ig = 0;
let fb = 0;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = "0123456789abcdef0123456789abcdef";
  delete process.env.META_LOGIN_CONFIG_ID;
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  setGraphFetch(null);
  await resetTables();
  await db.insert(schema.brands).values({
    id: "residency",
    name: "Paraguay Residency",
    domain: "paraguayresidency.co.uk",
    niche: "residency",
    market: "global",
    language: "en",
    platforms: ["instagram", "facebook"],
  });
  const rows = await insertReturning(db, schema.socialAccounts, [
    {
      brandId: "residency",
      platform: "instagram",
      handle: "paraguayresidency",
      status: "active",
    },
    {
      brandId: "residency",
      platform: "facebook",
      handle: "flyttatillparaguay",
      status: "active",
    },
  ]);
  ig = rows[0].id;
  fb = rows[1].id;
  owner = { cookie: (await signIn("owner")).cookie };
});

after(async () => {
  setGraphFetch(null);
  await teardown();
});

/** A connected integration with IG + FB linked, as the callback + step 6 leave it. */
async function connected(expiresAt: Date | null = new Date(NOW.getTime() + 50 * 86_400_000)) {
  const row = await saveMetaConnection({
    token: LONG_TOKEN,
    expiresAt,
    userId: "10000000000001",
    userName: "Anton Marklund",
    scopes: ["instagram_basic"],
  });
  await db
    .update(schema.socialAccounts)
    .set({ externalId: IG_ID, integrationId: row.id, isProfessional: true })
    .where(eq(schema.socialAccounts.id, ig));
  await db
    .update(schema.socialAccounts)
    .set({ externalId: PAGE_ID, integrationId: row.id })
    .where(eq(schema.socialAccounts.id, fb));
  return row;
}

async function post(values: Partial<typeof schema.posts.$inferInsert> & { accountId: number }) {
  const [row] = await insertReturning(db, schema.posts, {
    brandId: "residency",
    format: "image_post",
    status: "published",
    ...values,
  });
  return row;
}

// ---------------------------------------------------------------------------

test("crypto: AES-256-GCM round trip, fresh IV, wrong key refused, missing key explained", () => {
  const a = encryptSecret("secret-token");
  const b = encryptSecret("secret-token");
  assert.notEqual(a, b, "a fresh IV per encryption");
  assert.ok(!a.includes("secret-token"));
  assert.equal(decryptSecret(a), "secret-token");
  const tampered = a.slice(0, -4) + (a.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.throws(() => decryptSecret(tampered), DecryptError);
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  assert.throws(() => decryptSecret(a), DecryptError);
  assert.match(encryptionKeyProblem("") ?? "", /not set/);
  assert.match(encryptionKeyProblem("abc") ?? "", /64 hex/);
});

test("connect: owner goes to the login dialog with the localhost redirect URI and a state cookie", async () => {
  const res = await callRoute(
    connect,
    new Request("http://localhost:3000/api/meta/connect", { headers: owner }),
  );
  assert.equal(res.status, 307);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.hostname, "www.facebook.com");
  assert.equal(to.searchParams.get("client_id"), "1234567890");
  assert.equal(to.searchParams.get("redirect_uri"), "http://localhost:3000/api/meta/callback");
  assert.match(to.searchParams.get("scope") ?? "", /instagram_manage_insights/);
  const state = to.searchParams.get("state");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`meta_oauth_state=${state}`));

  process.env.META_LOGIN_CONFIG_ID = "987654321";
  const withConfig = await callRoute(
    connect,
    new Request("http://localhost:3000/api/meta/connect", { headers: owner }),
  );
  const to2 = new URL(withConfig.headers.get("location")!);
  assert.equal(to2.searchParams.get("config_id"), "987654321");
  assert.equal(to2.searchParams.get("scope"), null);

  delete process.env.META_APP_SECRET;
  const noKeys = await callRoute(
    connect,
    new Request("http://localhost:3000/api/meta/connect", { headers: owner }),
  );
  assert.match(noKeys.headers.get("location") ?? "", /meta_error=.*step\+4/);
});

test("callback: stores the long-lived token encrypted, granted scopes only, links IG by handle", async () => {
  const { fetch, calls } = fixtureFetch();
  setGraphFetch(fetch);
  const url = "http://localhost:3000/api/meta/callback?code=AQFAKEcode&state=s1";

  const bad = await callRoute(
    callback,
    new Request(url, { headers: { ...owner, cookie: `${owner.cookie}; meta_oauth_state=other` } }),
  );
  assert.match(bad.headers.get("location") ?? "", /meta_error=/);
  assert.equal(
    (await db.select().from(schema.integrations)).length,
    0,
    "a state mismatch stores nothing",
  );

  const res = await callRoute(
    callback,
    new Request(url, { headers: { ...owner, cookie: `${owner.cookie}; meta_oauth_state=s1` } }),
  );
  const location = res.headers.get("location") ?? "";
  assert.match(location, /\/settings\?meta=connected&linked=1#meta$/);
  assert.ok(!location.includes("EAA"), "no token in the redirect");

  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.provider, "meta");
  assert.equal(row.accountRef, "10000000000001");
  assert.equal(row.label, "Meta — Anton Marklund");
  assert.equal(row.status, "ok");
  assert.ok(row.tokenCiphertext && !row.tokenCiphertext.includes(LONG_TOKEN));
  assert.equal(decryptSecret(row.tokenCiphertext!), LONG_TOKEN);
  assert.ok(row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now() + 59 * 86_400_000);
  assert.ok(!row.scopes.includes("pages_manage_posts"), "declined scopes are not recorded");
  assert.ok(row.scopes.includes("instagram_manage_insights"));

  const [account] = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, ig));
  assert.equal(account.externalId, IG_ID, "matched case-insensitively by handle");
  assert.equal(account.integrationId, row.id);
  assert.equal(account.isProfessional, true);

  const exchange = calls.find(
    (c) => c.pathname.endsWith("oauth/access_token") && c.searchParams.get("code"),
  );
  assert.equal(
    exchange?.searchParams.get("redirect_uri"),
    "http://localhost:3000/api/meta/callback",
  );

  // Reconnecting refreshes the same row.
  await callRoute(
    callback,
    new Request(url, { headers: { ...owner, cookie: `${owner.cookie}; meta_oauth_state=s1` } }),
  );
  assert.equal((await db.select().from(schema.integrations)).length, 1);
});

test("sync: per-type mapping, match by media id and permalink, raw kept, account day upserted", async () => {
  const integration = await connected();
  const reel = await post({ accountId: ig, format: "reel", externalMediaId: "18000000000000001" });
  const carousel = await post({
    accountId: ig,
    format: "carousel",
    permalink: "https://instagram.com/p/CarouXyz2",
  });
  const image = await post({ accountId: ig, permalink: "https://www.instagram.com/p/ImgFee4/" });
  const old = await post({ accountId: ig, permalink: "https://www.instagram.com/p/OldOne5/" });
  const fbPost = await post({
    accountId: fb,
    permalink: "https://www.facebook.com/111000000000002/posts/900000000000001",
  });
  const { fetch, calls } = fixtureFetch();

  const report = await syncMeta({ fetch, now: NOW });
  assert.deepEqual(report.errors, []);
  assert.equal(report.integrations, 1);
  assert.equal(report.accounts, 2);
  assert.equal(
    report.postsMatched,
    4,
    "reel, carousel, image (page 2) and the FB post; not the 150-day-old one",
  );
  assert.equal(report.snapshots, 4);
  assert.equal(report.accountRows, 2);

  const metrics = await db.select().from(schema.postMetrics);
  const of = (id: number) => metrics.find((m) => m.postId === id)!;
  assert.equal(metrics.filter((m) => m.postId === old.id).length, 0);

  const r = of(reel.id);
  assert.deepEqual(
    [r.reach, r.plays, r.impressions, r.likes, r.comments, r.saves, r.shares],
    [4000, 9100, null, 121, 15, 60, 25],
    "a reel's views are plays",
  );
  assert.equal(
    (r.raw as { insights: { name: string }[] }).insights.find(
      (i) => i.name === "ig_reels_avg_watch_time",
    ) !== undefined,
    true,
    "the whole response is kept in raw",
  );
  const c = of(carousel.id);
  assert.deepEqual(
    [c.reach, c.impressions, c.plays, c.saves, c.shares],
    [1000, 1800, null, 110, 31],
  );
  const i = of(image.id);
  assert.deepEqual(
    [i.reach, i.saves, i.follows],
    [500, 3, null],
    "fallback to the basic metric set",
  );
  const f = of(fbPost.id);
  assert.deepEqual([f.reach, f.impressions, f.likes, f.comments, f.shares], [800, 1200, 33, 6, 4]);

  const [updated] = await db.select().from(schema.posts).where(eq(schema.posts.id, carousel.id));
  assert.equal(
    updated.externalMediaId,
    "18000000000000002",
    "a permalink match records the media id",
  );

  const days = await db.select().from(schema.accountMetrics);
  const igDay = days.find((d) => d.accountId === ig)!;
  assert.deepEqual(
    [igDay.date, igDay.followers, igDay.reach, igDay.profileVisits],
    ["2026-09-26", 5230, 2100, 77],
  );
  const fbDay = days.find((d) => d.accountId === fb)!;
  assert.deepEqual([fbDay.followers, fbDay.reach], [910, 340]);

  const pagePosts = calls.find((u) => u.pathname.endsWith(`${PAGE_ID}/posts`));
  assert.equal(
    pagePosts?.searchParams.get("access_token"),
    PAGE_TOKEN,
    "Page calls use the Page token",
  );

  // Append-only snapshots; the account day is replaced, not duplicated.
  await syncMeta({ fetch, now: NOW });
  assert.equal((await db.select().from(schema.postMetrics)).length, 8);
  assert.equal((await db.select().from(schema.accountMetrics)).length, 2);
  const [still] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, integration.id));
  assert.equal(still.status, "ok");
});

test("token expiry: Meta's 190 marks the integration expired and Settings shows the banner", async () => {
  const integration = await connected();
  await post({ accountId: ig, externalMediaId: "18000000000000001" });
  const { fetch } = fixtureFetch((path) =>
    path.startsWith(IG_ID) || path.startsWith(PAGE_ID)
      ? { status: 400, body: FIX("error-token") }
      : undefined,
  );
  const report = await syncMeta({ fetch, now: NOW });
  assert.deepEqual(report.expired, [integration.id]);
  assert.equal(report.snapshots, 0);
  assert.ok(!JSON.stringify(report).includes("EAAFAKE"), "no token in the report");

  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.status, "expired");
  assert.match(row.lastError ?? "", /Session has expired/);
  assert.equal(expiryBanner(row, NOW)?.level, "expired");

  const state = await metaState(fetch, NOW);
  assert.equal(state.banner?.level, "expired");
  assert.equal(state.steps.find((s) => s.id === "connect")?.state, "todo");
});

test("token expiry by date: no call is made, row flips to expired; near expiry warns", async () => {
  await connected(new Date(NOW.getTime() - 1000));
  const { fetch, calls } = fixtureFetch();
  const report = await syncMeta({ fetch, now: NOW });
  assert.equal(calls.length, 0);
  assert.equal(report.expired.length, 1);
  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.status, "expired");

  const soon = {
    ...row,
    status: "ok" as const,
    tokenExpiresAt: new Date(NOW.getTime() + 3 * 86_400_000),
  };
  assert.equal(expiryBanner(soon, NOW)?.level, "soon");
  assert.equal(
    expiryBanner({ ...soon, tokenExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000) }, NOW),
    null,
  );
});

test("settings state: steps tick from Meta's list, and a missing key disables the connection", async () => {
  await connected();
  const { fetch } = fixtureFetch();
  const s = await metaState(fetch, NOW);
  const by = Object.fromEntries(s.steps.map((x) => [x.id, x.state]));
  assert.deepEqual(by, {
    professional: "done",
    pageLink: "done",
    app: "done",
    credentials: "done",
    connect: "done",
    mapping: "done",
  });
  assert.equal(s.targets?.length, 2);
  assert.ok(!("tokenCiphertext" in (s.integration ?? {})), "the ciphertext never reaches the page");

  delete process.env.ENCRYPTION_KEY;
  const off = await metaState(fetch, NOW);
  assert.equal(off.steps.find((x) => x.id === "credentials")?.state, "todo");
  assert.match(off.targetsError ?? "", /ENCRYPTION_KEY/);
});

test("graph errors never carry the token", async () => {
  const { fetch } = fixtureFetch(() => ({
    status: 500,
    body: { error: { message: `boom access_token=${LONG_TOKEN}`, code: 1 } },
  }));
  const err = await new GraphClient(LONG_TOKEN, fetch).get("me").catch((e: unknown) => e);
  assert.ok(err instanceof MetaGraphError);
  assert.ok(!err.message.includes(LONG_TOKEN));
  assert.equal(err.isTokenError, false);
});

test("mapping helpers: permalink normalisation keeps the case-sensitive shortcode", () => {
  assert.equal(
    normalizePermalink("https://www.instagram.com/p/AbC/?igsh=x"),
    "instagram.com/p/AbC",
  );
  assert.notEqual(
    normalizePermalink("https://instagram.com/p/abc/"),
    normalizePermalink("https://instagram.com/p/ABC/"),
  );
  const story = mapIgMediaInsights({ id: "1", media_product_type: "STORY", media_type: "IMAGE" }, [
    { name: "views", total_value: { value: 70 } },
    { name: "reach", values: [{ value: 50 }] },
  ]);
  assert.deepEqual([story.reach, story.impressions, story.plays], [50, 70, null]);
});

test("sync route: owner only", async () => {
  const employee = { cookie: (await signIn("employee")).cookie };
  const denied = await callRoute(syncRoute, jsonPost("/api/meta/sync", {}, employee));
  assert.equal(denied.status, 403);
  setGraphFetch(fixtureFetch().fetch);
  const ok = await callRoute(syncRoute, jsonPost("/api/meta/sync", {}, owner));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { integrations: number }).integrations, 0);
});

test("what worked: ranked by (saves+shares+comments)/reach over 90 days, and it reaches the post prompt", async () => {
  const mk = async (title: string, reach: number | null, saves: number, publishedAt: Date) => {
    const p = await post({
      accountId: ig,
      title,
      publishedAt,
      body: { hook: `HOOK-${title}` },
      caption: `Caption ${title}`,
    });
    await db
      .insert(schema.postMetrics)
      .values({ postId: p.id, reach, saves, shares: 0, comments: 0 });
    return p;
  };
  const recent = new Date(Date.now() - 5 * 86_400_000);
  await mk("low", 1000, 10, recent);
  await mk("high", 1000, 100, recent);
  await mk("noreach", null, 500, recent);
  await mk("old", 1000, 900, new Date(Date.now() - 120 * 86_400_000));

  const top = await whatWorked(ig);
  assert.deepEqual(
    top.map((t) => t.hook),
    ["HOOK-high", "HOOK-low"],
    "best first; no reach and older than 90 days are left out",
  );
  assert.equal(top[0].rate, 0.1);

  const res = await callRoute(
    createPost,
    jsonPost("/api/posts", { accountId: ig, topic: "Fees" }, owner),
  );
  assert.equal(res.status, 201);
  const [call] = fakeGeminiClient().callsOf("generateContent");
  const prompt = (call.params as { contents: string }).contents;
  assert.match(prompt, /WHAT WORKED on this account/);
  assert.match(prompt, /HOOK-high/);
  assert.ok(prompt.indexOf("HOOK-high") < prompt.indexOf("HOOK-low"));
});
