import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { quoteLongIds } from "@/lib/tiktok/http";

import { PublishFailure } from "./meta";
import { DEFAULT_TIKTOK_OPTIONS, type TikTokOptions } from "./options";
import { ProviderApiError } from "./provider-error";
import {
  directPostInfo,
  finishTikTok,
  publishTikTok,
  resumeTikTok,
  type TikTokUpload,
  tiktokChunks,
  type CreatorInfo,
  type TikTokContext,
} from "./tiktok";
import { openMediaFile } from "./video-file";

const RAW = (name: string) =>
  readFileSync(
    new URL(`../../../tests/integration/fixtures/video/tiktok/${name}.json`, import.meta.url),
    "utf8",
  );
const FIX = (name: string): unknown => JSON.parse(RAW(name));

test("chunks: one chunk up to the chunk size, else floor(size/chunk) with the remainder last", () => {
  assert.deepEqual(tiktokChunks(3_000_000, 10_000_000), {
    chunkSize: 3_000_000,
    count: 1,
    ranges: [[0, 3_000_000]],
  });
  const MB = 1024 * 1024;
  const p = tiktokChunks(25 * MB, 10 * MB);
  assert.equal(p.count, 2);
  assert.equal(p.chunkSize, 10 * MB);
  assert.deepEqual(p.ranges, [
    [0, 10 * MB],
    [10 * MB, 25 * MB],
  ]);
  assert.equal(tiktokChunks(30 * MB, 10 * MB).count, 3);
});

test("direct post_info: privacy must be one the creator allows; duration is checked", () => {
  const creator = FIX("creator-info") as { data: CreatorInfo };
  const opts = (o: Partial<TikTokOptions>) => ({
    ...DEFAULT_TIKTOK_OPTIONS,
    mode: "direct" as const,
    ...o,
  });
  const ok = directPostInfo(opts({}), creator.data, "Hola #cuentos", 30);
  assert.deepEqual(ok, {
    ok: true,
    postInfo: {
      title: "Hola #cuentos",
      privacy_level: "SELF_ONLY",
      disable_comment: false,
      disable_duet: false,
      disable_stitch: true, // the creator has stitches off
      video_cover_timestamp_ms: 1000,
    },
  });
  const pub = directPostInfo(opts({ privacy: "PUBLIC_TO_EVERYONE" }), creator.data, "x", 30);
  assert.equal(pub.ok, false);
  assert.match((pub as { error: string }).error, /allowed: SELF_ONLY.*unaudited/);
  const long = directPostInfo(opts({}), creator.data, "x", 900);
  assert.match(
    (long as { error: string }).error,
    /900 s; this TikTok account may post up to 600 s/,
  );
  const aigc = directPostInfo(opts({ isAigc: true }), creator.data, "x", 30);
  assert.equal((aigc as { postInfo: Record<string, unknown> }).postInfo.is_aigc, true);
});

test("int64 post ids survive parsing", () => {
  const parsed = JSON.parse(quoteLongIds(RAW("status-complete"))) as {
    data: { publicaly_available_post_id: string[] };
  };
  assert.deepEqual(parsed.data.publicaly_available_post_id, ["7301234567890123456"]);
});

// --- the flows against fixtures ------------------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), "tt-upload-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const BYTES = Buffer.alloc(2500, 7);
writeFileSync(path.join(dir, "clip.mp4"), BYTES);

type Call = { method: string; path: string; headers: Headers; json: unknown; bytes: number };
type Answer = { status?: number; raw?: string; body?: unknown } | "drop";

function fake(statuses: string[], override?: (c: Call) => Answer | undefined) {
  const calls: Call[] = [];
  let polls = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    const isJson = typeof init?.body === "string";
    const call: Call = {
      method: init?.method ?? "GET",
      path: u.hostname === "open-upload.tiktokapis.com" ? "upload" : u.pathname,
      headers,
      json: isJson ? JSON.parse(init!.body as string) : null,
      bytes: !isJson && init?.body ? (init.body as Uint8Array).byteLength : 0,
    };
    calls.push(call);
    const forced = override?.(call);
    if (forced === "drop") throw new TypeError("fetch failed");
    const answer: Answer =
      forced ??
      (call.path === "upload"
        ? {
            status: headers.get("content-range")?.endsWith(`-${BYTES.length - 1}/${BYTES.length}`)
              ? 201
              : 206,
            raw: "",
          }
        : call.path === "/v2/post/publish/creator_info/query/"
          ? { raw: RAW("creator-info") }
          : call.path === "/v2/post/publish/inbox/video/init/"
            ? { raw: RAW("inbox-init") }
            : call.path === "/v2/post/publish/video/init/"
              ? { raw: RAW("direct-init") }
              : call.path === "/v2/post/publish/status/fetch/"
                ? { raw: RAW(statuses[Math.min(polls++, statuses.length - 1)]) }
                : { status: 404, body: { error: { code: "not_found", message: call.path } } });
    return new Response(answer.raw ?? JSON.stringify(answer.body), {
      status: answer.status ?? 200,
    });
  };
  return { fetchImpl, calls };
}

function ctx(f: ReturnType<typeof fake>, saved: Array<string | null>): TikTokContext {
  return {
    token: "act.FAKE",
    fetch: f.fetchImpl,
    handle: "cuentospy",
    caption: "El yacaré y la luna #cuentos",
    chunkBytes: 1000,
    poll: { tries: 3, delayMs: 0 },
    saveContainer: async (id) => {
      saved.push(id);
    },
  };
}

async function run(
  f: ReturnType<typeof fake>,
  options: Partial<TikTokOptions>,
  saved: Array<string | null> = [],
) {
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  try {
    return await publishTikTok(
      ctx(f, saved),
      { ...DEFAULT_TIKTOK_OPTIONS, ...options },
      file,
      "video/mp4",
      30,
    );
  } finally {
    await file.close();
  }
}

test("inbox (default): init FILE_UPLOAD, chunked PUT, status until it reaches the inbox", async () => {
  const f = fake(["status-processing", "status-inbox"]);
  const saved: Array<string | null> = [];
  const done = await run(f, {}, saved);
  assert.deepEqual(done, {
    status: "published",
    mediaId: "v_inbox_file~v2.7301000000000000001",
    permalink: null,
    inbox: true,
  });
  assert.deepEqual(
    saved,
    ["v_inbox_file~v2.7301000000000000001"],
    "publish_id saved before upload",
  );
  const [init, ...rest] = f.calls;
  assert.equal(init.path, "/v2/post/publish/inbox/video/init/");
  assert.equal(init.headers.get("authorization"), "Bearer act.FAKE");
  assert.deepEqual(init.json, {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: 2500,
      chunk_size: 1000,
      total_chunk_count: 2,
    },
  });
  const uploads = rest.filter((c) => c.path === "upload");
  assert.deepEqual(
    uploads.map((c) => [c.headers.get("content-range"), c.bytes]),
    [
      ["bytes 0-999/2500", 1000],
      ["bytes 1000-2499/2500", 1500],
    ],
  );
  assert.equal(uploads[0].headers.get("content-type"), "video/mp4");
  const polls = rest.filter((c) => c.path === "/v2/post/publish/status/fetch/");
  assert.equal(polls.length, 2);
  assert.deepEqual(polls[0].json, { publish_id: "v_inbox_file~v2.7301000000000000001" });
  assert.ok(!f.calls.some((c) => c.path.includes("creator_info")), "inbox needs no creator info");
});

test("direct: creator info first, post_info with the allowed privacy, the int64 post id", async () => {
  const f = fake(["status-complete"]);
  const done = await run(f, { mode: "direct" });
  assert.deepEqual(done, {
    status: "published",
    mediaId: "7301234567890123456",
    permalink: "https://www.tiktok.com/@cuentospy/video/7301234567890123456",
    inbox: false,
  });
  assert.deepEqual(
    f.calls.slice(0, 2).map((c) => c.path),
    ["/v2/post/publish/creator_info/query/", "/v2/post/publish/video/init/"],
  );
  const init = f.calls[1].json as { post_info: Record<string, unknown> };
  assert.equal(init.post_info.privacy_level, "SELF_ONLY");
  assert.equal(init.post_info.title, "El yacaré y la luna #cuentos");

  const refused = fake(["status-complete"]);
  const err = await run(refused, { mode: "direct", privacy: "PUBLIC_TO_EVERYONE" }).catch(
    (e: unknown) => e,
  );
  assert.ok(err instanceof PublishFailure && !err.temporary);
  assert.ok(
    !refused.calls.some((c) => c.path === "/v2/post/publish/video/init/"),
    "nothing posted",
  );
});

test("still processing after the poll budget is pending; the next run finishes it", async () => {
  const f = fake(["status-processing"]);
  const done = await run(f, {});
  assert.deepEqual(done, { status: "pending", containerId: "v_inbox_file~v2.7301000000000000001" });
  const later = fake(["status-inbox"]);
  const finished = await finishTikTok(ctx(later, []), "v_inbox_file~v2.7301000000000000001");
  assert.equal(finished.status, "published");
  assert.deepEqual(
    later.calls.map((c) => c.path),
    ["/v2/post/publish/status/fetch/"],
  );
});

test("FAILED processing, a refused init, a dropped upload", async () => {
  const saved: Array<string | null> = [];
  const failed = await run(fake(["status-failed"]), {}, saved).catch((e: unknown) => e);
  assert.ok(failed instanceof PublishFailure);
  assert.match(failed.message, /file_format_check_failed/);
  assert.deepEqual(saved.at(-1), null, "the publish_id is dropped");

  const limited = fake([], (c) =>
    c.path.endsWith("/init/") ? { status: 429, raw: RAW("error-rate-limit") } : undefined,
  );
  const rate = await run(limited, {}).catch((e: unknown) => e);
  assert.ok(rate instanceof ProviderApiError && rate.isTransient && !rate.isAuthError);

  const token = fake([], (c) =>
    c.path.endsWith("/init/") ? { status: 401, raw: RAW("error-token") } : undefined,
  );
  const auth = await run(token, {}).catch((e: unknown) => e);
  assert.ok(auth instanceof ProviderApiError && auth.isAuthError);
  assert.match(auth.message, /access_token_invalid/);

  const midSaved: Array<string | null> = [];
  const mid = await run(
    fake([], (c) =>
      c.path === "upload" && c.headers.get("content-range")?.startsWith("bytes 0-")
        ? "drop"
        : undefined,
    ),
    {},
    midSaved,
  ).catch((e: unknown) => e);
  assert.ok(mid instanceof PublishFailure && mid.temporary && mid.keepContainer);
  assert.deepEqual(midSaved, ["v_inbox_file~v2.7301000000000000001"]);

  const end = await run(
    fake([], (c) =>
      c.path === "upload" && c.headers.get("content-range")?.startsWith("bytes 1000-")
        ? "drop"
        : undefined,
    ),
    {},
  ).catch((e: unknown) => e);
  assert.ok(end instanceof PublishFailure && end.temporary && end.keepContainer);
  assert.match(end.message, /saved upload will be checked/);
});

test("BUG-08: upload session and offsets are durable before and after chunk sends", async () => {
  const states: TikTokUpload[] = [];
  const f = fake(["status-inbox"], (c) => {
    if (c.path === "upload") assert.ok(states.length > 0, "saved before bytes are sent");
    return undefined;
  });
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  try {
    const context = {
      ...ctx(f, []),
      sourceKey: "asset:sha",
      saveUpload: async (state: TikTokUpload | null) => {
        if (state) states.push({ ...state });
      },
    };
    await publishTikTok(context, DEFAULT_TIKTOK_OPTIONS, file, "video/mp4", 30);
    assert.deepEqual(
      states.map((s) => s.uploadedBytes),
      [0, 1000, 2500],
    );
    assert.equal(states[0].sourceKey, "asset:sha");
  } finally {
    await file.close();
  }
});

test("BUG-08: restart resumes acknowledged bytes using the same publish_id, without init", async () => {
  let statusCalls = 0;
  const f = fake(["status-inbox"], (c) =>
    c.path.endsWith("status/fetch/") && statusCalls++ === 0
      ? {
          body: {
            data: { status: "PROCESSING_UPLOAD", uploaded_bytes: 1000 },
            error: { code: "ok" },
          },
        }
      : undefined,
  );
  const session: TikTokUpload = {
    publishId: "saved-id",
    uploadUrl: "https://open-upload.tiktokapis.com/saved",
    size: 2500,
    chunkBytes: 1000,
    uploadedBytes: 0,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    sourceKey: "asset:sha",
  };
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  try {
    const done = await resumeTikTok(
      { ...ctx(f, []), sourceKey: "asset:sha", saveUpload: async () => {} },
      session,
      file,
      "video/mp4",
    );
    assert.equal(done.status, "published");
    assert.ok(!f.calls.some((c) => c.path.endsWith("/init/")));
    assert.deepEqual(
      f.calls.filter((c) => c.path === "upload").map((c) => c.headers.get("content-range")),
      ["bytes 1000-2499/2500"],
    );
  } finally {
    await file.close();
  }
});

test("BUG-08: legacy upload waiting for bytes stops with a retained provider ID", async () => {
  await assert.rejects(
    finishTikTok(ctx(fake(["status-processing"]), []), "legacy-id"),
    (err: unknown) => err instanceof PublishFailure && !err.temporary && err.keepContainer,
  );
});
