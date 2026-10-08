import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approvedPublishFixture } from "./publish-approval";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mediaRoot } from "@/lib/storage/root";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as cronPublish } from "@/app/api/cron/publish/route";
import { generateEncryptionKey } from "@/lib/crypto";
import { acquireLease } from "@/lib/lease";
import { setGraphFetch, type GraphFetch } from "@/lib/meta/graph";
import { saveMetaConnection } from "@/lib/meta/integration";
import { postLeaseName, PUBLISH_LEASE, publishDue, publishPost } from "@/lib/publish";
import { publishNowAction } from "@/lib/publish/actions";
import { TEMPORARY_PREFIX } from "@/lib/publish/plan";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * O13 publishing against recorded Graph API fixtures (PLAN.md §5.O13): each
 * media type (IG image, carousel, reel; FB photo, album, video, text), the
 * failure paths (no public URL, rate limit + backoff, unconfirmed publish,
 * expired login, media Meta cannot process, unlinked account, unsupported
 * format, first comment), both leases, the interrupted-run guard, the cron
 * route and the owner's "Publish now". No test reaches Meta.
 */

const FIX = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/meta/${name}.json`, import.meta.url), "utf8"));

const NOW = new Date("2026-09-27T12:00:00Z");
const PAST = new Date("2026-09-27T11:55:00Z");
const IG_ID = "17841400000000001";
const PAGE_ID = "111000000000002";
const USER_TOKEN = "EAAFAKElongLivedUserToken0000000000000";
const PAGE_TOKEN = "EAAFAKEpageToken00000000000000000000";
const IG_MEDIA = "18000000000000901";
const FAST = { poll: { tries: 2, delayMs: 0 } };

type Answer = { status?: number; body: unknown };
type Call = { method: string; path: string; params: URLSearchParams };
type Override = (call: Call) => Answer | undefined;

function graph(override?: Override): {
  fetch: GraphFetch;
  calls: Call[];
  posts: (p?: string) => Call[];
} {
  const calls: Call[] = [];
  let container = 100;
  const route = ({ method, path, params }: Call): Answer => {
    if (method === "GET") {
      if (path === PAGE_ID && params.get("fields") === "access_token")
        return { body: FIX("page-token") };
      if (params.get("fields") === "status_code,status")
        return { body: FIX("publish/ig-container-finished") };
      if (path === IG_MEDIA) return { body: FIX("publish/ig-permalink") };
      if (path === "777000000000001") return { body: FIX("publish/fb-video-permalink") };
      if (path.startsWith(`${PAGE_ID}_`)) return { body: FIX("publish/fb-post-permalink") };
    } else {
      if (path === `${IG_ID}/media`) return { body: { id: `1790000000000${container++}` } };
      if (path === `${IG_ID}/media_publish`) return { body: FIX("publish/ig-media-publish") };
      if (path.endsWith("/comments")) return { body: FIX("publish/comment") };
      if (path === `${PAGE_ID}/photos`) {
        return {
          body: FIX(
            params.get("published") === "false"
              ? "publish/fb-photo-unpublished"
              : "publish/fb-photo",
          ),
        };
      }
      if (path === `${PAGE_ID}/feed`) return { body: FIX("publish/fb-feed") };
      if (path === `${PAGE_ID}/videos`) return { body: FIX("publish/fb-video") };
    }
    return {
      status: 404,
      body: { error: { message: `no fixture for ${method} ${path}`, code: 803 } },
    };
  };
  const fetchImpl: GraphFetch = async (raw, init) => {
    const url = new URL(raw);
    const method = init?.method ?? "GET";
    const params =
      method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
    const call = { method, path: url.pathname.replace(/^\/v\d+\.\d+\//, ""), params };
    calls.push(call);
    const answer = override?.(call) ?? route(call);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    fetch: fetchImpl,
    calls,
    posts: (p) => calls.filter((c) => c.method === "POST" && (!p || c.path === p)),
  };
}

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/posts/1", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let ig = 0;
let fb = 0;
let integrationId = 0;
let assetN = 0;
let fixtureOwnerId = 0;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  process.env.CRON_SECRET = "cron-secret-for-tests-000000000000";
  delete process.env.MEDIA_UPLOAD_URL;
  delete process.env.MEDIA_UPLOAD_TOKEN;
  delete process.env.MEDIA_PUBLIC_BASE;
  setGraphFetch(null);
  await resetTables();
  fixtureOwnerId = (
    await insertReturning(
      db,
      schema.users,
      { email: "publisher-fixture@example.invalid", role: "owner" },
      { id: schema.users.id },
    )
  )[0].id;
  assetN = 0;
  await db.insert(schema.brands).values({
    id: "residency",
    name: "Paraguay Residency",
    domain: "paraguayresidency.co.uk",
    niche: "residency",
    market: "global",
    language: "en",
    platforms: ["instagram", "facebook"],
  });
  const row = await saveMetaConnection({
    token: USER_TOKEN,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    userId: "10000000000001",
    userName: "Anton Marklund",
    scopes: ["instagram_content_publish", "pages_manage_posts"],
  });
  integrationId = row.id;
  const accounts = await insertReturning(db, schema.socialAccounts, [
    {
      brandId: "residency",
      platform: "instagram",
      handle: "paraguayresidency",
      status: "active",
      isProfessional: true,
      externalId: IG_ID,
      integrationId,
    },
    {
      brandId: "residency",
      platform: "facebook",
      handle: "flyttatillparaguay",
      status: "active",
      externalId: PAGE_ID,
      integrationId,
    },
  ]);
  ig = accounts[0].id;
  fb = accounts[1].id;
});

after(async () => {
  setGraphFetch(null);
  await teardown();
});

/** An asset with an unexpired public copy (what `publishCopy` reuses), or none. */
async function asset(
  kind: "image" | "video",
  opts: { publicUrl?: string | null; altText?: string } = {},
) {
  const n = ++assetN;
  const ext = kind === "image" ? "jpg" : "mp4";
  const rel = `residency/paraguayresidency/2026-09/1-post/0${n}-file.${ext}`;
  const data = Buffer.alloc(1000, n);
  if (kind === "image") Buffer.from([0xff, 0xd8, 0xff]).copy(data);
  else Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(data);
  mkdirSync(path.join(mediaRoot(), path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(mediaRoot(), rel), data);
  const [row] = await insertReturning(db, schema.assets, {
    brandId: "residency",
    kind,
    mime: kind === "image" ? "image/jpeg" : "video/mp4",
    bytes: 1000,
    sha256: createHash("sha256").update(data).digest("hex"),
    localPath: rel,
    publicUrl:
      opts.publicUrl === undefined
        ? `https://media.example.com/files/2026/09/${"a".repeat(31)}${n}.${ext}`
        : opts.publicUrl,
    publicExpiresAt: new Date("2026-12-31T00:00:00Z"),
    source: "higgsfield",
    status: "approved",
    altText: opts.altText ?? null,
  });
  return row;
}

async function post(
  values: Partial<typeof schema.posts.$inferInsert> & { accountId?: number },
  files: Array<{ id: number; role?: "slide" | "cover" | "clip" }> = [],
) {
  const [row] = await insertReturning(db, schema.posts, {
    accountId: ig,
    brandId: "residency",
    format: "image_post",
    status: "scheduled",
    scheduledFor: PAST,
    body: { version: 1 },
    caption: "Residency in 30 days #paraguay",
    ...values,
  });
  if (files.length) {
    await db.insert(schema.postAssets).values(
      files.map((f, i) => ({
        postId: row.id,
        assetId: f.id,
        position: i + 1,
        role: f.role ?? "slide",
      })),
    );
  }
  return approvedPublishFixture(row, fixtureOwnerId, NOW);
}

async function load(id: number) {
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
  return row;
}

// ---------------------------------------------------------------------------

test("IG image: the due run publishes a scheduled post whose time has come, and nothing else", async () => {
  const img = await asset("image", { altText: "A passport on a map" });
  const due = await post({ firstComment: "More in the link in bio" }, [{ id: img.id }]);
  const future = await post({ scheduledFor: new Date("2026-09-28T09:00:00Z") }, [{ id: img.id }]);
  const ready = await post({ status: "ready", scheduledFor: null }, [{ id: img.id }]);
  const g = graph();

  const report = await publishDue({ now: NOW, fetch: g.fetch, ...FAST });
  assert.equal(report.outcomes.length, 1);
  assert.equal(report.outcomes[0].result, "published", report.outcomes[0].message);

  const [container] = g.posts(`${IG_ID}/media`);
  assert.equal(container.params.get("image_url"), img.publicUrl);
  assert.equal(container.params.get("caption"), "Residency in 30 days #paraguay");
  assert.equal(container.params.get("alt_text"), "A passport on a map");
  assert.equal(container.params.get("access_token"), USER_TOKEN);
  assert.equal(g.posts(`${IG_ID}/media_publish`)[0].params.get("creation_id"), "1790000000000100");
  assert.equal(g.posts(`${IG_MEDIA}/comments`)[0].params.get("message"), "More in the link in bio");
  assert.ok(
    g.calls.every((c) => !c.path.includes("access_token")),
    "the token never rides in a path",
  );

  const row = await load(due.id);
  assert.equal(row.status, "published");
  assert.equal(row.externalMediaId, IG_MEDIA);
  assert.equal(row.permalink, "https://www.instagram.com/p/DPublished1/");
  assert.equal(row.publishedAt?.toISOString(), NOW.toISOString());
  assert.equal(row.publishAttempts, 1);
  assert.equal(row.externalContainerId, null);
  assert.equal(row.publishError, null);
  const [used] = await db.select().from(schema.assets).where(eq(schema.assets.id, img.id));
  assert.equal(used.status, "used");
  assert.equal((await load(future.id)).status, "scheduled");
  assert.equal((await load(ready.id)).status, "ready");

  // Running again publishes nothing twice.
  const again = graph();
  assert.equal((await publishDue({ now: NOW, fetch: again.fetch, ...FAST })).outcomes.length, 0);
  assert.equal(again.calls.length, 0);
});

test("IG carousel: child containers in slide order (videos polled), then one CAROUSEL container", async () => {
  const a = await asset("image");
  const b = await asset("video");
  const c = await asset("image");
  const p = await post({ format: "carousel" }, [
    { id: a.id },
    { id: b.id, role: "clip" },
    { id: c.id },
  ]);
  const g = graph();
  const out = await publishPost(p.id, { now: NOW, fetch: g.fetch, trigger: "due", ...FAST });
  assert.equal(out.result, "published", out.message);

  const media = g.posts(`${IG_ID}/media`);
  assert.equal(media.length, 4);
  assert.equal(media[0].params.get("image_url"), a.publicUrl);
  assert.equal(media[0].params.get("is_carousel_item"), "true");
  assert.equal(media[1].params.get("media_type"), "VIDEO");
  assert.equal(media[1].params.get("video_url"), b.publicUrl);
  assert.equal(media[2].params.get("image_url"), c.publicUrl);
  assert.equal(media[3].params.get("media_type"), "CAROUSEL");
  assert.equal(
    media[3].params.get("children"),
    "1790000000000100,1790000000000101,1790000000000102",
  );
  assert.equal(media[3].params.get("caption"), p.caption);
  assert.equal(g.posts(`${IG_ID}/media_publish`)[0].params.get("creation_id"), "1790000000000103");
  assert.ok(
    g.calls.some((x) => x.method === "GET" && x.path === "1790000000000101"),
    "video child polled",
  );
});

test("IG reel: a container still processing is left for the next run, which publishes it once", async () => {
  const video = await asset("video");
  const cover = await asset("image");
  const p = await post({ format: "reel" }, [
    { id: video.id, role: "clip" },
    { id: cover.id, role: "cover" },
  ]);
  const processing = graph((c) =>
    c.params.get("fields") === "status_code,status"
      ? { body: FIX("publish/ig-container-in-progress") }
      : undefined,
  );
  const first = await publishDue({ now: NOW, fetch: processing.fetch, ...FAST });
  assert.equal(first.outcomes[0].result, "pending");
  const reel = processing.posts(`${IG_ID}/media`)[0];
  assert.equal(reel.params.get("media_type"), "REELS");
  assert.equal(reel.params.get("video_url"), video.publicUrl);
  assert.equal(reel.params.get("cover_url"), cover.publicUrl);
  assert.equal(reel.params.get("share_to_feed"), "true");
  assert.equal(processing.posts(`${IG_ID}/media_publish`).length, 0);
  let row = await load(p.id);
  assert.equal(row.status, "publishing");
  assert.equal(row.externalContainerId, "1790000000000100");

  const ready = graph();
  const second = await publishDue({
    now: new Date(NOW.getTime() + 5 * 60_000),
    fetch: ready.fetch,
    ...FAST,
  });
  assert.equal(second.outcomes[0].result, "published");
  assert.equal(ready.posts(`${IG_ID}/media`).length, 0, "no second container");
  assert.equal(
    ready.posts(`${IG_ID}/media_publish`)[0].params.get("creation_id"),
    "1790000000000100",
  );
  row = await load(p.id);
  assert.equal(row.status, "published");
  assert.equal(row.publishAttempts, 1, "resuming is not a new attempt");
  assert.equal(row.externalContainerId, null);
});

test("FB Page: photo, album, video and text posts with the Page's own token", async () => {
  const i1 = await asset("image");
  const i2 = await asset("image");
  const v = await asset("video");
  const photo = await post({ accountId: fb, firstComment: "Ask us anything" }, [{ id: i1.id }]);
  const album = await post({ accountId: fb, format: "carousel" }, [{ id: i1.id }, { id: i2.id }]);
  const video = await post({ accountId: fb, format: "video" }, [{ id: v.id, role: "clip" }]);
  const text = await post({ accountId: fb, format: "text", caption: "Office closed Monday" });
  const g = graph();
  const report = await publishDue({ now: NOW, fetch: g.fetch, ...FAST });
  assert.deepEqual(
    report.outcomes.map((o) => o.result),
    ["published", "published", "published", "published"],
    JSON.stringify(report.outcomes),
  );
  assert.ok(
    g.posts().every((c) => c.params.get("access_token") === PAGE_TOKEN),
    "Page token for every write",
  );

  const photos = g.posts(`${PAGE_ID}/photos`);
  assert.equal(photos[0].params.get("url"), i1.publicUrl);
  assert.equal(photos[0].params.get("caption"), photo.caption);
  let row = await load(photo.id);
  assert.equal(row.externalMediaId, "111000000000002_900000000000555");
  assert.equal(row.permalink, "https://www.facebook.com/111000000000002/posts/900000000000555");
  assert.equal(
    g.posts("111000000000002_900000000000555/comments")[0].params.get("message"),
    "Ask us anything",
  );

  assert.deepEqual(
    photos.slice(1).map((c) => c.params.get("published")),
    ["false", "false"],
  );
  const feeds = g.posts(`${PAGE_ID}/feed`);
  assert.equal(feeds[0].params.get("attached_media[0]"), '{"media_fbid":"555000000000011"}');
  assert.equal(feeds[0].params.get("attached_media[1]"), '{"media_fbid":"555000000000011"}');
  assert.equal((await load(album.id)).status, "published");

  assert.equal(g.posts(`${PAGE_ID}/videos`)[0].params.get("file_url"), v.publicUrl);
  row = await load(video.id);
  assert.equal(row.externalMediaId, "777000000000001");
  assert.equal(
    row.permalink,
    "https://www.facebook.com/flyttatillparaguay/videos/777000000000001/",
  );

  assert.equal(feeds[1].params.get("message"), "Office closed Monday");
  assert.equal(feeds[1].params.get("attached_media[0]"), null);
  assert.equal((await load(text.id)).status, "published");
});

test("failure: a file without a public URL fails with a clear error before any Graph call", async () => {
  const img = await asset("image", { publicUrl: null });
  const p = await post({}, [{ id: img.id }]);
  const g = graph();
  const out = await publishPost(p.id, { now: NOW, fetch: g.fetch, trigger: "due", ...FAST });
  assert.equal(out.result, "failed");
  const row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.match(
    row.publishError ?? "",
    /01-file\.jpg \(asset \d+\) has no public URL: Public media endpoint not configured/,
  );
  assert.equal(g.posts().length, 0);
  // Not temporary: the due run leaves it alone.
  assert.equal(
    (await publishDue({ now: new Date("2026-09-28"), fetch: g.fetch, ...FAST })).outcomes.length,
    0,
  );
});

test("failure: a rate limit is retried with backoff, and given up after three attempts", async () => {
  const img = await asset("image");
  const p = await post({}, [{ id: img.id }]);
  const limited = graph((c) =>
    c.method === "POST" && c.path === `${IG_ID}/media`
      ? { status: 400, body: FIX("publish/error-rate-limit") }
      : undefined,
  );
  await publishDue({ now: NOW, fetch: limited.fetch, ...FAST });
  let row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.ok(row.publishError?.startsWith(TEMPORARY_PREFIX), row.publishError ?? "");
  assert.equal(row.publishAttempts, 1);

  // Inside the 5-minute backoff nothing is tried.
  const early = graph();
  await publishDue({ now: new Date(NOW.getTime() + 60_000), fetch: early.fetch, ...FAST });
  assert.equal(early.calls.length, 0);

  // After it, a second and a third attempt; the third gives up.
  await publishDue({ now: new Date(NOW.getTime() + 5 * 60_000), fetch: limited.fetch, ...FAST });
  assert.equal((await load(p.id)).publishAttempts, 2);
  await publishDue({ now: new Date(NOW.getTime() + 20 * 60_000), fetch: limited.fetch, ...FAST });
  row = await load(p.id);
  assert.equal(row.publishAttempts, 3);
  assert.equal(row.status, "failed");
  assert.match(row.publishError ?? "", /request limit reached.*Gave up after 3 attempt/);
  const later = graph();
  await publishDue({ now: new Date("2026-09-28"), fetch: later.fetch, ...FAST });
  assert.equal(later.calls.length, 0);

  // A retry that goes through publishes.
  const img2 = await asset("image");
  const q = await post({}, [{ id: img2.id }]);
  await publishDue({ now: NOW, fetch: limited.fetch, ...FAST });
  const ok = await publishDue({
    now: new Date(NOW.getTime() + 5 * 60_000),
    fetch: graph().fetch,
    ...FAST,
  });
  assert.equal(ok.outcomes.find((o) => o.postId === q.id)?.result, "published");
  assert.equal((await load(q.id)).publishAttempts, 2);
});

test("failure: an unconfirmed publish stays blocked for both automatic and manual sends", async () => {
  const img = await asset("image");
  const p = await post({}, [{ id: img.id }]);
  const flaky = graph((c) =>
    c.path === `${IG_ID}/media_publish`
      ? { status: 500, body: FIX("publish/error-unexpected") }
      : undefined,
  );
  await publishDue({ now: NOW, fetch: flaky.fetch, ...FAST });
  const row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.equal(row.publishState, "ambiguous");
  assert.match(row.publishError ?? "", /may be live: check @paraguayresidency/);
  assert.ok(!row.publishError?.startsWith(TEMPORARY_PREFIX));
  assert.equal(row.externalContainerId, "1790000000000100");

  const idle = graph();
  await publishDue({ now: new Date("2026-09-28"), fetch: idle.fetch, ...FAST });
  assert.equal(idle.calls.length, 0);

  const g = graph();
  const out = await publishPost(p.id, { now: NOW, fetch: g.fetch, ...FAST });
  assert.equal(out.result, "skipped");
  assert.match(out.message ?? "", /uncertain|verify|reconcile/i);
  assert.equal(g.calls.length, 0);
  assert.equal((await load(p.id)).publishState, "ambiguous");
});

test("failure: an expired login marks the integration expired; Meta's refusals are kept", async () => {
  const img = await asset("image");
  const p = await post({}, [{ id: img.id }]);
  const revoked = graph((c) =>
    c.method === "POST" ? { status: 400, body: FIX("error-token") } : undefined,
  );
  await publishDue({ now: NOW, fetch: revoked.fetch, ...FAST });
  assert.match((await load(p.id)).publishError ?? "", /Meta rejected the login.*Reconnect/);
  const [integration] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, integrationId));
  assert.equal(integration.status, "expired");
  // The next post fails before any Graph call, with the reason.
  const q = await post({}, [{ id: img.id }]);
  const g = graph();
  await publishPost(q.id, { now: NOW, fetch: g.fetch, ...FAST });
  assert.match((await load(q.id)).publishError ?? "", /expired/i);
  assert.equal(g.calls.length, 0);
});

test("failure: media Meta cannot fetch or process, unlinked accounts and unsupported formats", async () => {
  const img = await asset("image");
  const fetchFail = await post({}, [{ id: img.id }]);
  await publishPost(fetchFail.id, {
    now: NOW,
    fetch: graph((c) =>
      c.method === "POST" ? { status: 400, body: FIX("publish/error-fetch") } : undefined,
    ).fetch,
    ...FAST,
  });
  assert.match(
    (await load(fetchFail.id)).publishError ?? "",
    /^Meta refused: The media could not be fetched/,
  );

  const vid = await asset("video");
  const broken = await post({ format: "reel" }, [{ id: vid.id, role: "clip" }]);
  await publishPost(broken.id, {
    now: NOW,
    fetch: graph((c) =>
      c.params.get("fields") === "status_code,status"
        ? { body: FIX("publish/ig-container-error") }
        : undefined,
    ).fetch,
    ...FAST,
  });
  const row = await load(broken.id);
  assert.equal(row.status, "failed");
  assert.match(
    row.publishError ?? "",
    /Instagram could not process the media: Error: Media upload has failed/,
  );
  assert.equal(row.externalContainerId, null);

  const [tiktok] = await insertReturning(db, schema.socialAccounts, {
    brandId: "residency",
    platform: "threads",
    handle: "pyres",
    status: "active",
    externalId: "synthetic-threads",
    integrationId,
  });
  const [unlinked] = await insertReturning(db, schema.socialAccounts, {
    brandId: "residency",
    platform: "instagram",
    handle: "pyres.es",
    status: "active",
  });
  const story = await post({ format: "story" }, [{ id: img.id }]);
  const tt = await post({ accountId: tiktok.id, format: "reel" }, [{ id: vid.id, role: "clip" }]);
  const nl = await post({ accountId: unlinked.id }, [{ id: img.id }]);
  const g = graph();
  const report = await publishDue({ now: NOW, fetch: g.fetch, ...FAST });
  assert.match(
    (await load(story.id)).publishError ?? "",
    /Stories are not published automatically/,
  );
  assert.match((await load(tt.id)).publishError ?? "", /threads is not built/);
  assert.match(
    report.outcomes.find((o) => o.postId === nl.id)?.message ?? "",
    /@pyres\.es is not linked to Meta.*Settings → Meta/,
  );
  assert.equal(report.outcomes.find((o) => o.postId === nl.id)?.result, "skipped");
  assert.equal((await load(nl.id)).status, "scheduled");
  assert.equal(g.posts().length, 0);
});

test("a failed first comment or permalink read never unpublishes the post", async () => {
  const img = await asset("image");
  const p = await post({ firstComment: "Link in bio" }, [{ id: img.id }]);
  const g = graph((c) =>
    c.path.endsWith("/comments") || (c.method === "GET" && c.path === IG_MEDIA)
      ? { status: 500, body: FIX("publish/error-unexpected") }
      : undefined,
  );
  const out = await publishPost(p.id, { now: NOW, fetch: g.fetch, trigger: "due", ...FAST });
  assert.equal(out.result, "published");
  const row = await load(p.id);
  assert.equal(row.status, "published");
  assert.equal(row.externalMediaId, IG_MEDIA);
  assert.match(
    row.publishError ?? "",
    /^Published, but the permalink could not be read.*the first comment failed/,
  );
});

test("leases: a held post lease or run lease stops a second publisher; concurrent runs publish once", async () => {
  const img = await asset("image");
  const p = await post({}, [{ id: img.id }]);

  const held = await acquireLease(postLeaseName(p.id), 60_000);
  assert.ok(held);
  const g = graph();
  const out = await publishPost(p.id, { now: NOW, fetch: g.fetch, ...FAST });
  assert.equal(out.result, "skipped");
  assert.match(out.message ?? "", /already being published/);
  assert.equal(g.calls.length, 0);
  await db.delete(schema.leases);

  const run = await acquireLease(PUBLISH_LEASE, 60_000);
  assert.ok(run);
  assert.equal((await publishDue({ now: NOW, fetch: g.fetch, ...FAST })).busy, true);
  await db.delete(schema.leases);

  const both = graph();
  const [a, b] = await Promise.all([
    publishDue({ now: NOW, fetch: both.fetch, ...FAST }),
    publishDue({ now: NOW, fetch: both.fetch, ...FAST }),
  ]);
  // Either the second run found the lease held, or it started after the first
  // had finished; in both cases the post went out exactly once.
  const published = [a, b].flatMap((r) => r.outcomes).filter((o) => o.result === "published");
  assert.equal(published.length, 1);
  assert.equal(both.posts(`${IG_ID}/media_publish`).length, 1);
  assert.equal((await load(p.id)).status, "published");
});

test("a run that died mid-publish is marked failed, never published again", async () => {
  const img = await asset("image");
  const stuck = await post(
    { status: "publishing", lastPublishAttemptAt: new Date(NOW.getTime() - 20 * 60_000) },
    [{ id: img.id }],
  );
  const fresh = await post(
    { status: "publishing", lastPublishAttemptAt: new Date(NOW.getTime() - 60_000) },
    [{ id: img.id }],
  );
  const g = graph();
  const report = await publishDue({ now: NOW, fetch: g.fetch, ...FAST });
  assert.deepEqual(report.interrupted, [stuck.id]);
  assert.equal(g.calls.length, 0);
  const row = await load(stuck.id);
  assert.equal(row.status, "failed");
  assert.match(row.publishError ?? "", /interrupted before Meta confirmed/);
  assert.equal((await load(fresh.id)).status, "publishing");
});

test("cron route and Publish now: secret required; owner only; only ready/scheduled/failed posts", async () => {
  const g = graph();
  setGraphFetch(g.fetch);
  const img = await asset("image");
  const due = await post({ scheduledFor: new Date(Date.now() - 60_000) }, [{ id: img.id }]);

  let res = await callRoute(cronPublish, new Request("http://localhost/api/cron/publish"));
  assert.equal(res.status, 401);
  res = await callRoute(
    cronPublish,
    new Request("http://localhost/api/cron/publish", {
      headers: { "x-cron-secret": process.env.CRON_SECRET! },
    }),
  );
  const body = (await res.json()) as { ok: boolean; summary: string };
  assert.equal(res.status, 200);
  assert.match(body.summary, /^1 published/);
  assert.equal((await load(due.id)).status, "published");

  const owner = (await signIn("owner")).cookie;
  const employee = (await signIn("employee")).cookie;
  const ready = await post({ status: "ready", scheduledFor: null }, [{ id: img.id }]);
  const draft = await post({ status: "drafting", scheduledFor: null }, [{ id: img.id }]);

  const refused = await as(employee, () => publishNowAction(ready.id));
  assert.deepEqual(refused, { ok: false, error: "Only the owner can publish." });
  assert.equal((await load(ready.id)).status, "ready");

  const skipped = await as(owner, () => publishNowAction(draft.id));
  assert.ok(skipped.ok && skipped.outcome.result === "skipped");
  assert.equal((await load(draft.id)).status, "drafting");

  const done = await as(owner, () => publishNowAction(ready.id));
  assert.ok(done.ok && done.outcome.result === "published", JSON.stringify(done));
  assert.equal((await load(ready.id)).status, "published");
  setGraphFetch(null);
});
