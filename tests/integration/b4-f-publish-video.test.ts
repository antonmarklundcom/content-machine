import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approvedPublishFixture } from "./publish-approval";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as ytCallback } from "@/app/api/youtube/oauth/callback/route";
import { GET as ytStart } from "@/app/api/youtube/oauth/start/route";
import { GET as ttCallback } from "@/app/api/tiktok/oauth/callback/route";
import { GET as ttStart } from "@/app/api/tiktok/oauth/start/route";
import { decryptSecret, generateEncryptionKey } from "@/lib/crypto";
import { setGoogleFetch } from "@/lib/google/http";
import { saveYouTubeConnections } from "@/lib/google/integration";
import { acquireLease } from "@/lib/lease";
import { postLeaseName, publishDue, publishPost } from "@/lib/publish";
import { TEMPORARY_PREFIX } from "@/lib/publish/plan";
import { savePublishOptionsAction } from "@/lib/publish/video.actions";
import { setTikTokFetch } from "@/lib/tiktok/http";
import { saveTikTokConnection } from "@/lib/tiktok/integration";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Build 4 phase F: YouTube and TikTok publishing through the O13 publisher,
 * against recorded fixtures (tests/integration/fixtures/video/). Proves the
 * OAuth routes (state, encrypted tokens, auto-link), token refresh, the
 * resumable YouTube upload with Shorts tagging and the kids rule, the TikTok
 * inbox and direct flows with resume, plan routing and refusals, and that the
 * O13 lease guards cover the new platforms. No test reaches Google or TikTok.
 */

const RAW = (p: string) =>
  readFileSync(new URL(`./fixtures/video/${p}.json`, import.meta.url), "utf8");

const NOW = new Date("2026-10-07T12:00:00Z");
const PAST = new Date("2026-10-07T11:55:00Z");
const CHANNEL = "UCfakeCuentosPy0000000001";
const OPEN_ID = "-000FAKEopenIdCuentos01";
const SESSION =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=FAKE";
const FAST = { poll: { tries: 2, delayMs: 0 }, chunkBytes: 1000 };

type Call = {
  method: string;
  host: string;
  path: string;
  headers: Headers;
  body: string | Uint8Array | null;
};
type Answer = { status?: number; raw?: string; headers?: Record<string, string> } | "drop";

/** One fake for Google and TikTok; `override` replaces an answer. */
function apis(override?: (c: Call) => Answer | undefined) {
  const calls: Call[] = [];
  let ytBytes = 0;
  let ytSize = 0;
  let ttPolls = 0;
  const route = (c: Call): Answer => {
    if (c.host === "oauth2.googleapis.com") return { raw: RAW("youtube/token-refresh") };
    if (c.host === "www.googleapis.com") {
      if (c.path === "/youtube/v3/channels") return { raw: RAW("youtube/channels") };
      if (c.path === "/upload/youtube/v3/thumbnails/set")
        return { raw: RAW("youtube/thumbnail-set") };
      if (c.path === "/upload/youtube/v3/videos" && c.method === "POST") {
        ytSize = Number(c.headers.get("x-upload-content-length"));
        ytBytes = 0;
        return { status: 200, raw: "", headers: { location: SESSION } };
      }
      if (c.method === "PUT") {
        const range = c.headers.get("content-range") ?? "";
        if (!range.startsWith("bytes */")) ytBytes += (c.body as Uint8Array).byteLength;
        if (ytBytes >= ytSize) return { raw: RAW("youtube/video-insert") };
        return { status: 308, raw: "", headers: { range: `bytes=0-${ytBytes - 1}` } };
      }
    }
    if (c.host === "open.tiktokapis.com") {
      if (c.path === "/v2/oauth/token/") return { raw: RAW("tiktok/token-refresh") };
      if (c.path === "/v2/user/info/") return { raw: RAW("tiktok/user-info") };
      if (c.path === "/v2/post/publish/creator_info/query/")
        return { raw: RAW("tiktok/creator-info") };
      if (c.path === "/v2/post/publish/inbox/video/init/") return { raw: RAW("tiktok/inbox-init") };
      if (c.path === "/v2/post/publish/video/init/") return { raw: RAW("tiktok/direct-init") };
      if (c.path === "/v2/post/publish/status/fetch/") {
        ttPolls++;
        const id = JSON.parse(c.body as string).publish_id as string;
        return {
          raw: RAW(id.startsWith("v_inbox") ? "tiktok/status-inbox" : "tiktok/status-complete"),
        };
      }
    }
    if (c.host === "open-upload.tiktokapis.com") return { status: 201, raw: "" };
    return {
      status: 404,
      raw: JSON.stringify({ error: { code: 404, message: `no fixture ${c.host}${c.path}` } }),
    };
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? new Uint8Array(init.body as Uint8Array)
          : null;
    const c: Call = {
      method: init?.method ?? "GET",
      host: u.host,
      path: u.pathname,
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(c);
    const a = override?.(c) ?? route(c);
    if (a === "drop") throw new TypeError("fetch failed");
    return new Response(a.raw ?? "", { status: a.status ?? 200, headers: a.headers });
  };
  return {
    fetch: fetchImpl,
    calls,
    polls: () => ttPolls,
    on: (host: string, p?: string) => calls.filter((c) => c.host === host && (!p || c.path === p)),
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

let media = "";
let yt = 0;
let tt = 0;
let ytIntegration = 0;
let ttIntegration = 0;
let assetN = 0;
let fixtureOwnerId = 0;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  process.env.GOOGLE_OAUTH_CLIENT_ID = "123-fake.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-FAKEsecret";
  process.env.TIKTOK_CLIENT_KEY = "awFAKEclientkey01";
  process.env.TIKTOK_CLIENT_SECRET = "FAKEsecret0000000000";
  if (media) rmSync(media, { recursive: true, force: true });
  media = mkdtempSync(path.join(tmpdir(), "b4f-media-"));
  process.env.MEDIA_ROOT = media;
  setGoogleFetch(null);
  setTikTokFetch(null);
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
  await db.insert(schema.brands).values([
    {
      id: "cuentos",
      name: "Cuentos PY",
      domain: "cuentos.com.py",
      niche: "picture books",
      market: "paraguay",
      language: "es",
      platforms: ["youtube", "tiktok"],
    },
    {
      id: "residency",
      name: "Paraguay Residency",
      domain: "paraguayresidency.co.uk",
      niche: "residency",
      market: "global",
      language: "en",
      platforms: ["youtube"],
    },
  ]);
  const [ytRow] = await saveYouTubeConnections(
    {
      accessToken: "ya29.FAKEstillValid",
      accessExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
      refreshToken: "1//FAKErefresh",
      scopes: [],
    },
    [{ id: CHANNEL, title: "Cuentos PY", customUrl: "@cuentospy", thumbnailUrl: null }],
  );
  ytIntegration = ytRow.id;
  const ttRow = await saveTikTokConnection(
    {
      openId: OPEN_ID,
      accessToken: "act.FAKEstillValid0000000000",
      accessExpiresAt: new Date(NOW.getTime() + 3600_000),
      refreshToken: "rft.FAKErefresh00000000000",
      refreshExpiresAt: new Date("2027-10-01T00:00:00Z"),
      scopes: ["video.upload", "video.publish"],
    },
    { openId: OPEN_ID, displayName: "Cuentos PY", avatarUrl: null },
  );
  ttIntegration = ttRow.id;
  const accounts = await insertReturning(db, schema.socialAccounts, [
    {
      brandId: "cuentos",
      platform: "youtube",
      handle: "cuentospy",
      status: "active",
      externalId: CHANNEL,
      integrationId: ytIntegration,
    },
    {
      brandId: "cuentos",
      platform: "tiktok",
      handle: "cuentospy",
      status: "active",
      externalId: OPEN_ID,
      integrationId: ttIntegration,
    },
  ]);
  yt = accounts[0].id;
  tt = accounts[1].id;
});

after(async () => {
  setGoogleFetch(null);
  setTikTokFetch(null);
  if (media) rmSync(media, { recursive: true, force: true });
  await teardown();
});

/** A file under MEDIA_ROOT and its asset row. */
async function asset(
  kind: "image" | "video",
  opts: {
    width?: number;
    height?: number;
    durationSec?: number;
    bytes?: number;
    write?: boolean;
  } = {},
) {
  const n = ++assetN;
  const ext = kind === "image" ? "jpg" : "mp4";
  const rel = `cuentos/cuentospy/2026-10/1-post/0${n}-file.${ext}`;
  const size = opts.bytes ?? (kind === "video" ? 2500 : 300);
  const data = Buffer.alloc(size, n);
  if (kind === "image") Buffer.from([0xff, 0xd8, 0xff]).copy(data);
  else Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(data);
  if (opts.write !== false) {
    mkdirSync(path.join(media, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(media, rel), data);
  }
  const [row] = await insertReturning(db, schema.assets, {
    brandId: "cuentos",
    kind,
    mime: kind === "image" ? "image/jpeg" : "video/mp4",
    bytes: size,
    sha256: createHash("sha256").update(data).digest("hex"),
    width: opts.width ?? (kind === "video" ? 1080 : 1280),
    height: opts.height ?? (kind === "video" ? 1920 : 720),
    durationSec: kind === "video" ? (opts.durationSec ?? 50) : null,
    localPath: rel,
    source: "upload",
    status: "approved",
  });
  return row;
}

async function post(
  values: Partial<typeof schema.posts.$inferInsert>,
  files: Array<{ id: number; role?: "slide" | "cover" | "clip" | "thumbnail" }> = [],
) {
  const [row] = await insertReturning(db, schema.posts, {
    accountId: yt,
    brandId: "cuentos",
    format: "reel",
    status: "scheduled",
    scheduledFor: PAST,
    title: "El yacaré y la luna",
    body: { version: 1 },
    caption: "Un cuento para dormir. #cuentos #paraguay",
    ...values,
  });
  if (files.length) {
    await db.insert(schema.postAssets).values(
      files.map((f, i) => ({
        postId: row.id,
        assetId: f.id,
        position: i + 1,
        role: f.role ?? "clip",
      })),
    );
  }
  return approvedPublishFixture(row, fixtureOwnerId, NOW);
}

async function load(id: number) {
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
  return row;
}

const initBody = (a: ReturnType<typeof apis>) =>
  JSON.parse(
    a.on("www.googleapis.com", "/upload/youtube/v3/videos").find((c) => c.method === "POST")!
      .body as string,
  ) as {
    snippet: {
      title: string;
      description: string;
      tags?: string[];
      categoryId: string;
      defaultLanguage?: string;
    };
    status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
  };

// ---------------------------------------------------------------------------

test("YouTube Short: the due run uploads in chunks, tags #Shorts, applies the kids rule, sets the thumbnail", async () => {
  const video = await asset("video");
  const thumb = await asset("image");
  const p = await post(
    {
      leadUrl: "https://cuentos.com.py/?utm_source=youtube",
      publishOptions: { youtube: { privacy: "public", madeForKids: false, categoryId: "1" } },
    },
    [{ id: video.id }, { id: thumb.id, role: "thumbnail" }],
  );
  const a = apis();
  const report = await publishDue({ now: NOW, fetch: a.fetch, ...FAST });
  assert.equal(report.outcomes[0]?.result, "published", JSON.stringify(report));

  const row = await load(p.id);
  assert.equal(row.status, "published");
  assert.equal(row.externalMediaId, "FAKEvid0001");
  assert.equal(row.permalink, "https://www.youtube.com/shorts/FAKEvid0001");
  assert.equal(row.externalContainerId, null);
  assert.match(row.publishError ?? "", /^Published, but made for kids was set on.*kids rule/);

  const meta = initBody(a);
  assert.equal(meta.snippet.title, "El yacaré y la luna #Shorts");
  assert.equal(
    meta.snippet.description,
    "Un cuento para dormir. #cuentos #paraguay\n\nhttps://cuentos.com.py/?utm_source=youtube\n\n#Shorts",
  );
  assert.deepEqual(meta.snippet.tags, ["cuentos", "paraguay"]);
  assert.equal(meta.snippet.categoryId, "1");
  assert.equal(meta.snippet.defaultLanguage, "es");
  assert.equal(meta.status.privacyStatus, "public");
  assert.equal(meta.status.selfDeclaredMadeForKids, true, "cuentos is a kids brand");

  const puts = a.calls.filter((c) => c.method === "PUT");
  assert.deepEqual(
    puts.map((c) => c.headers.get("content-range")),
    ["bytes 0-999/2500", "bytes 1000-1999/2500", "bytes 2000-2499/2500"],
  );
  assert.ok(puts.every((c) => c.headers.get("authorization") === "Bearer ya29.FAKEstillValid"));
  assert.equal(a.on("oauth2.googleapis.com").length, 0, "a valid access token is not refreshed");
  assert.equal(a.on("www.googleapis.com", "/upload/youtube/v3/thumbnails/set").length, 1);

  const used = await db.select().from(schema.assets);
  assert.ok(used.every((x) => x.status === "used"));
});

test("YouTube: private by default, a long video is not a Short, an expired access token is refreshed", async () => {
  // Make the stored access token stale: the publisher must refresh it first.
  await saveYouTubeConnections(
    {
      accessToken: "ya29.FAKEold",
      accessExpiresAt: new Date(NOW.getTime() - 60_000),
      refreshToken: "1//FAKErefresh",
      scopes: [],
    },
    [{ id: CHANNEL, title: "Cuentos PY", customUrl: "@cuentospy", thumbnailUrl: null }],
  );
  const [acct] = await insertReturning(db, schema.socialAccounts, {
    brandId: "residency",
    platform: "youtube",
    handle: "pyresidency",
    status: "active",
    externalId: CHANNEL,
    integrationId: ytIntegration,
  });
  const video = await asset("video", { width: 1920, height: 1080, durationSec: 600 });
  await db
    .update(schema.assets)
    .set({ brandId: "residency" })
    .where(eq(schema.assets.id, video.id));
  const p = await post({ accountId: acct.id, brandId: "residency", format: "video" }, [
    { id: video.id },
  ]);
  const a = apis();
  const out = await publishPost(p.id, { now: NOW, fetch: a.fetch, trigger: "due", ...FAST });
  assert.equal(out.result, "published", out.message);

  const meta = initBody(a);
  assert.equal(meta.status.privacyStatus, "private");
  assert.equal(meta.status.selfDeclaredMadeForKids, false);
  assert.equal(meta.snippet.title, "El yacaré y la luna");
  assert.equal(meta.snippet.defaultLanguage, "en", "the brand's language");
  const row = await load(p.id);
  assert.equal(row.permalink, "https://www.youtube.com/watch?v=FAKEvid0001");
  assert.match(row.publishError ?? "", /private on YouTube until you change it/);

  const refresh = a.on("oauth2.googleapis.com", "/token");
  assert.equal(refresh.length, 1);
  assert.equal(new URLSearchParams(refresh[0].body as string).get("grant_type"), "refresh_token");
  assert.equal(
    a.calls.find((c) => c.method === "PUT")!.headers.get("authorization"),
    "Bearer ya29.FAKErefreshedAccess00000000000",
  );
  const [integ] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, ytIntegration));
  const stored = JSON.parse(decryptSecret(integ.tokenCiphertext!)) as {
    accessToken: string;
    refreshToken: string;
  };
  assert.equal(
    stored.accessToken,
    "ya29.FAKErefreshedAccess00000000000",
    "the refreshed token is re-sealed",
  );
  assert.equal(stored.refreshToken, "1//FAKErefresh");
  assert.ok(!integ.tokenCiphertext!.includes("ya29"), "never stored in clear");
});

test("YouTube: a revoked login marks the connection expired and says reconnect", async () => {
  await saveYouTubeConnections(
    {
      accessToken: "ya29.FAKEold",
      accessExpiresAt: new Date(NOW.getTime() - 60_000),
      refreshToken: "1//FAKErevoked",
      scopes: [],
    },
    [{ id: CHANNEL, title: "Cuentos PY", customUrl: "@cuentospy", thumbnailUrl: null }],
  );
  const video = await asset("video");
  const p = await post({}, [{ id: video.id }]);
  const a = apis((c) =>
    c.host === "oauth2.googleapis.com"
      ? { status: 400, raw: RAW("youtube/token-invalid-grant") }
      : undefined,
  );
  await publishDue({ now: NOW, fetch: a.fetch, ...FAST });
  const row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.match(
    row.publishError ?? "",
    /YouTube refused to renew the login.*Reconnect in Settings → YouTube/,
  );
  assert.ok(!row.publishError?.startsWith(TEMPORARY_PREFIX));
  const [integ] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, ytIntegration));
  assert.equal(integ.status, "expired");
  assert.equal(a.on("www.googleapis.com").length, 0, "nothing uploaded");
});

test("YouTube: an unconfirmed end of upload is never retried; a 503 at the start is", async () => {
  const video = await asset("video");
  const p = await post({}, [{ id: video.id }]);
  const end = apis((c) =>
    c.method === "PUT"
      ? c.headers.get("content-range")?.startsWith("bytes 2000") ||
        c.headers.get("content-range")?.startsWith("bytes */")
        ? "drop"
        : undefined
      : undefined,
  );
  await publishDue({ now: NOW, fetch: end.fetch, ...FAST });
  const row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.match(row.publishError ?? "", /may exist: check YouTube Studio/);
  assert.ok(!row.publishError?.startsWith(TEMPORARY_PREFIX));

  const q = await post({}, [{ id: video.id }]);
  const down = apis((c) =>
    c.method === "POST" && c.path === "/upload/youtube/v3/videos"
      ? { status: 503, raw: RAW("youtube/error-backend") }
      : undefined,
  );
  await publishPost(q.id, { now: NOW, fetch: down.fetch, trigger: "due", ...FAST });
  const r2 = await load(q.id);
  assert.equal(r2.status, "failed");
  assert.ok(r2.publishError?.startsWith(TEMPORARY_PREFIX), r2.publishError ?? "");
});

test("TikTok inbox (default): uploads, lands in drafts, says to finish in the app", async () => {
  const video = await asset("video");
  const p = await post({ accountId: tt, status: "ready", scheduledFor: null }, [{ id: video.id }]);
  const a = apis();
  const out = await publishPost(p.id, { now: NOW, fetch: a.fetch, ...FAST });
  assert.equal(out.result, "published", out.message);
  const row = await load(p.id);
  assert.equal(row.externalMediaId, "v_inbox_file~v2.7301000000000000001");
  assert.equal(row.permalink, null);
  assert.match(row.publishError ?? "", /TikTok inbox \(drafts\)/);
  assert.equal(a.on("open.tiktokapis.com", "/v2/post/publish/inbox/video/init/").length, 1);
  assert.equal(a.on("open.tiktokapis.com", "/v2/post/publish/video/init/").length, 0);
  const uploads = a.on("open-upload.tiktokapis.com");
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].headers.get("content-range"), "bytes 0-999/2500");
  assert.equal(uploads[1].headers.get("content-range"), "bytes 1000-2499/2500");
  assert.equal(a.on("open.tiktokapis.com", "/v2/oauth/token/").length, 0);
});

test("TikTok direct: still processing is resumed by the next run from the publish_id, posted once", async () => {
  const video = await asset("video");
  const p = await post({ accountId: tt, publishOptions: { tiktok: { mode: "direct" } } }, [
    { id: video.id },
  ]);
  const first = apis((c) =>
    c.path === "/v2/post/publish/status/fetch/"
      ? { raw: RAW("tiktok/status-processing") }
      : undefined,
  );
  const r1 = await publishDue({ now: NOW, fetch: first.fetch, ...FAST });
  assert.equal(r1.outcomes[0].result, "pending");
  let row = await load(p.id);
  assert.equal(row.status, "publishing");
  assert.equal(row.externalContainerId, "v_pub_file~v2.7301000000000000002");
  const init = JSON.parse(
    first.on("open.tiktokapis.com", "/v2/post/publish/video/init/")[0].body as string,
  );
  assert.equal(init.post_info.privacy_level, "SELF_ONLY");
  assert.equal(init.post_info.title, "Un cuento para dormir. #cuentos #paraguay");

  const second = apis();
  const r2 = await publishDue({
    now: new Date(NOW.getTime() + 5 * 60_000),
    fetch: second.fetch,
    ...FAST,
  });
  assert.equal(r2.outcomes[0].result, "published");
  row = await load(p.id);
  assert.equal(row.status, "published");
  assert.equal(row.externalMediaId, "7301234567890123456");
  assert.equal(row.permalink, "https://www.tiktok.com/@cuentospy/video/7301234567890123456");
  assert.equal(row.publishAttempts, 1, "resuming is not a new attempt");
  assert.equal(
    second.on("open.tiktokapis.com", "/v2/post/publish/video/init/").length,
    0,
    "never posted twice",
  );
  assert.equal(second.on("open-upload.tiktokapis.com").length, 0);
});

test("TikTok: a privacy the creator does not allow is refused before anything is posted; a rate limit is retried", async () => {
  const video = await asset("video");
  const p = await post(
    {
      accountId: tt,
      publishOptions: { tiktok: { mode: "direct", privacy: "PUBLIC_TO_EVERYONE" } },
    },
    [{ id: video.id }],
  );
  const a = apis();
  await publishDue({ now: NOW, fetch: a.fetch, ...FAST });
  const row = await load(p.id);
  assert.equal(row.status, "failed");
  assert.match(row.publishError ?? "", /does not allow privacy PUBLIC_TO_EVERYONE.*SELF_ONLY/);
  assert.equal(a.on("open.tiktokapis.com", "/v2/post/publish/video/init/").length, 0);

  const q = await post({ accountId: tt }, [{ id: video.id }]);
  const limited = apis((c) =>
    c.path.endsWith("/init/") ? { status: 429, raw: RAW("tiktok/error-rate-limit") } : undefined,
  );
  await publishPost(q.id, { now: NOW, fetch: limited.fetch, trigger: "due", ...FAST });
  const r = await load(q.id);
  assert.ok(r.publishError?.startsWith(TEMPORARY_PREFIX), r.publishError ?? "");
  assert.equal(r.externalContainerId, null);
  const later = apis();
  const again = await publishDue({
    now: new Date(NOW.getTime() + 6 * 60_000),
    fetch: later.fetch,
    ...FAST,
  });
  assert.equal(again.outcomes.find((o) => o.postId === q.id)?.result, "published");
});

test("plan routing: wrong formats, unlinked accounts, missing files and options are refused with a reason", async () => {
  const img = await asset("image");
  const video = await asset("video");
  const ghost = await asset("video", { write: false });
  const [unlinked] = await insertReturning(db, schema.socialAccounts, {
    brandId: "cuentos",
    platform: "youtube",
    handle: "cuentos.es",
    status: "active",
  });
  const wrongFormat = await post({ format: "image_post" }, [{ id: img.id, role: "slide" }]);
  const noLink = await post({ accountId: unlinked.id }, [{ id: video.id }]);
  const missing = await post({ accountId: tt }, [{ id: ghost.id }]);
  const badOpts = await post({ publishOptions: { youtube: { privacy: "friends" } } }, [
    { id: video.id },
  ]);
  const a = apis();
  const report = await publishDue({ now: NOW, fetch: a.fetch, ...FAST });
  assert.match(
    (await load(wrongFormat.id)).publishError ?? "",
    /YouTube takes video and reel posts/,
  );
  assert.match(
    report.outcomes.find((o) => o.postId === noLink.id)?.message ?? "",
    /@cuentos\.es is not linked to YouTube.*Settings → YouTube/,
  );
  assert.match((await load(missing.id)).publishError ?? "", /intact approved bytes/);
  assert.match((await load(badOpts.id)).publishError ?? "", /private, unlisted or public/);
  for (const id of [wrongFormat.id, missing.id, badOpts.id]) {
    assert.equal((await load(id)).status, "failed");
  }
  assert.equal(report.outcomes.find((o) => o.postId === noLink.id)?.result, "skipped");
  assert.equal((await load(noLink.id)).status, "scheduled");
  assert.equal(a.calls.filter((c) => c.method !== "GET").length, 0, "nothing was sent");
});

test("leases: a held post lease stops a YouTube publish; a crashed upload is marked interrupted", async () => {
  const video = await asset("video");
  const p = await post({}, [{ id: video.id }]);
  assert.ok(await acquireLease(postLeaseName(p.id), 60_000));
  const a = apis();
  const out = await publishPost(p.id, { now: NOW, fetch: a.fetch, ...FAST });
  assert.equal(out.result, "skipped");
  assert.equal(a.calls.length, 0);
  await db.delete(schema.leases);

  const stuck = await post(
    { status: "publishing", lastPublishAttemptAt: new Date(NOW.getTime() - 20 * 60_000) },
    [{ id: video.id }],
  );
  const report = await publishDue({ now: NOW, fetch: apis().fetch, ...FAST });
  assert.deepEqual(report.interrupted, [stuck.id]);
  assert.match((await load(stuck.id)).publishError ?? "", /interrupted before YouTube confirmed/);
});

test("OAuth: YouTube start sets the state; the callback checks it, stores tokens encrypted, links by handle", async () => {
  await db.delete(schema.socialAccounts);
  await db.delete(schema.integrations);
  const [acct] = await insertReturning(db, schema.socialAccounts, {
    brandId: "cuentos",
    platform: "youtube",
    handle: "CuentosPY",
    status: "active",
  });
  const owner = (await signIn("owner")).cookie;
  const employee = (await signIn("employee", "e@example.com")).cookie;

  const start = await callRoute(
    ytStart,
    new Request("http://localhost:3000/api/youtube/oauth/start", { headers: { cookie: owner } }),
  );
  assert.equal(start.status, 307);
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.host, "accounts.google.com");
  assert.equal(
    to.searchParams.get("redirect_uri"),
    "http://localhost:3000/api/youtube/oauth/callback",
  );
  assert.equal(to.searchParams.get("access_type"), "offline");
  assert.equal(to.searchParams.get("prompt"), "consent");
  const state = to.searchParams.get("state")!;
  assert.match(
    start.headers.get("set-cookie") ?? "",
    new RegExp(`youtube_oauth_state=${state}.*Path=/api/youtube/oauth`, "i"),
  );

  const denied = await callRoute(
    ytStart,
    new Request("http://localhost:3000/api/youtube/oauth/start", { headers: { cookie: employee } }),
  );
  assert.match(denied.headers.get("location") ?? "", /youtube_error=Only\+the\+owner/);

  const a = apis((c) =>
    c.host === "oauth2.googleapis.com" ? { raw: RAW("youtube/token") } : undefined,
  );
  setGoogleFetch(a.fetch);
  const url = "http://localhost:3000/api/youtube/oauth/callback?code=4/FAKEcode&state=s1";
  const bad = await callRoute(
    ytCallback,
    new Request(url, { headers: { cookie: `${owner}; youtube_oauth_state=other` } }),
  );
  assert.match(bad.headers.get("location") ?? "", /youtube_error=/);
  assert.equal(
    (await db.select().from(schema.integrations)).length,
    0,
    "a state mismatch stores nothing",
  );

  const ok = await callRoute(
    ytCallback,
    new Request(url, { headers: { cookie: `${owner}; youtube_oauth_state=s1` } }),
  );
  const location = ok.headers.get("location") ?? "";
  assert.match(location, /\/settings\?youtube=connected&linked=1#youtube$/);
  assert.ok(!/ya29|1%2F%2F/.test(location));
  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.provider, "youtube");
  assert.equal(row.accountRef, CHANNEL);
  assert.equal(row.label, "YouTube — Cuentos PY (@cuentospy)");
  assert.equal(row.tokenExpiresAt, null);
  const sealed = JSON.parse(decryptSecret(row.tokenCiphertext!)) as { refreshToken: string };
  assert.equal(sealed.refreshToken, "1//FAKErefreshToken000000000000000");
  const [linked] = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, acct.id));
  assert.equal(linked.externalId, CHANNEL);
  assert.equal(linked.integrationId, row.id);
});

test("OAuth: TikTok start and callback store the creator's tokens encrypted with the login's end", async () => {
  await db.delete(schema.integrations);
  const owner = (await signIn("owner")).cookie;
  const start = await callRoute(
    ttStart,
    new Request("https://ce.example.com/api/tiktok/oauth/start", { headers: { cookie: owner } }),
  );
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.host, "www.tiktok.com");
  assert.equal(to.searchParams.get("client_key"), "awFAKEclientkey01");
  assert.equal(to.searchParams.get("scope"), "user.info.basic,video.upload,video.publish");
  assert.equal(
    to.searchParams.get("redirect_uri"),
    "https://ce.example.com/api/tiktok/oauth/callback",
  );
  assert.match(start.headers.get("set-cookie") ?? "", /tiktok_oauth_state=.*Secure/i);

  const a = apis((c) => (c.path === "/v2/oauth/token/" ? { raw: RAW("tiktok/token") } : undefined));
  setTikTokFetch(a.fetch);
  const url = "https://ce.example.com/api/tiktok/oauth/callback?code=FAKEcode&state=s2";
  const res = await callRoute(
    ttCallback,
    new Request(url, { headers: { cookie: `${owner}; tiktok_oauth_state=s2` } }),
  );
  assert.match(res.headers.get("location") ?? "", /\/settings\?tiktok=connected#tiktok$/);
  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.provider, "tiktok");
  assert.equal(row.accountRef, OPEN_ID);
  assert.equal(row.label, "TikTok — Cuentos PY");
  assert.ok(row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now() + 360 * 86_400_000);
  assert.ok(!row.tokenCiphertext!.includes("act."));
  const form = new URLSearchParams(
    a.on("open.tiktokapis.com", "/v2/oauth/token/")[0].body as string,
  );
  assert.equal(form.get("redirect_uri"), "https://ce.example.com/api/tiktok/oauth/callback");
});

test("publish options: the owner saves one platform's options; wrong values and employees are refused", async () => {
  const video = await asset("video");
  const p = await post(
    { status: "ready", scheduledFor: null, publishOptions: { tiktok: { mode: "direct" } } },
    [{ id: video.id }],
  );
  const owner = (await signIn("owner")).cookie;
  const employee = (await signIn("employee", "e2@example.com")).cookie;
  const value = {
    privacy: "unlisted",
    madeForKids: true,
    categoryId: "27",
    publishAt: null,
    notifySubscribers: false,
  } as const;
  assert.equal(
    (await as(employee, () => savePublishOptionsAction(p.id, "youtube", value))).ok,
    false,
  );
  const ok = await as(owner, () => savePublishOptionsAction(p.id, "youtube", value));
  assert.deepEqual(ok, { ok: true, message: "Saved." });
  assert.deepEqual((await load(p.id)).publishOptions, {
    tiktok: { mode: "direct" },
    youtube: value,
  });
  const bad = await as(owner, () =>
    savePublishOptionsAction(p.id, "tiktok", { mode: "draft" } as unknown as Parameters<
      typeof savePublishOptionsAction
    >[2]),
  );
  assert.equal(bad.ok, false);
});
