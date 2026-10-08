import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { PublishFailure } from "./meta";
import { DEFAULT_YOUTUBE_OPTIONS, type YouTubeOptions } from "./options";
import { ProviderApiError } from "./provider-error";
import { openMediaFile } from "./video-file";
import {
  buildYouTubeVideo,
  setYouTubeThumbnail,
  uploadYouTubeVideo,
  youtubePermalink,
  type YouTubeBuildInput,
  type YouTubeResource,
} from "./youtube";

const FIX = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../tests/integration/fixtures/video/youtube/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

const NOW = new Date("2026-10-07T12:00:00Z");

const input = (over: Partial<YouTubeBuildInput> = {}, opts: Partial<YouTubeOptions> = {}) =>
  ({
    title: "El yacaré y la luna",
    caption: "Un cuento para dormir.\n\n#cuentos #paraguay #Cuentos",
    leadUrl: null,
    options: { ...DEFAULT_YOUTUBE_OPTIONS, ...opts },
    kidsBrand: false,
    language: "es",
    short: false,
    now: NOW,
    ...over,
  }) satisfies YouTubeBuildInput;

function built(over: Partial<YouTubeBuildInput> = {}, opts: Partial<YouTubeOptions> = {}) {
  const r = buildYouTubeVideo(input(over, opts));
  if (!r.ok) throw new Error(r.error);
  return r;
}

test("youtube metadata: snippet from the post, private by default, tags from hashtags", () => {
  const { resource, notes } = built({ leadUrl: "https://cuentos.com.py/?utm_source=youtube" });
  assert.equal(resource.snippet.title, "El yacaré y la luna");
  assert.equal(
    resource.snippet.description,
    "Un cuento para dormir.\n\n#cuentos #paraguay #Cuentos\n\nhttps://cuentos.com.py/?utm_source=youtube",
  );
  assert.deepEqual(resource.snippet.tags, ["cuentos", "paraguay"], "deduplicated, without #");
  assert.equal(resource.snippet.categoryId, "22");
  assert.equal(resource.snippet.defaultLanguage, "es");
  assert.equal(resource.snippet.defaultAudioLanguage, "es");
  assert.equal(resource.status.privacyStatus, "private");
  assert.equal(resource.status.selfDeclaredMadeForKids, false);
  assert.equal(resource.status.publishAt, undefined);
  assert.deepEqual(notes, []);

  // No title: the caption's first line, hashtags removed; `<>` are stripped.
  assert.equal(
    built({ title: "", caption: "#tag Hola mundo\nmore" }).resource.snippet.title,
    "Hola mundo",
  );
  assert.equal(built({ title: "<b>Hi</b>" }).resource.snippet.title, "bHi/b");
  const long = built({ title: "x".repeat(150) }).resource.snippet.title;
  assert.equal([...long].length, 100);
  assert.ok(long.endsWith("…"));
  assert.match(
    (buildYouTubeVideo(input({ title: "", caption: "" })) as { error: string }).error,
    /needs a title/,
  );
});

test("youtube metadata: a Short gets #Shorts in title and description once", () => {
  const short = built({ short: true }).resource.snippet;
  assert.equal(short.title, "El yacaré y la luna #Shorts");
  assert.ok(short.description.endsWith("\n\n#Shorts"));
  assert.ok(!short.tags?.some((t) => t.toLowerCase() === "shorts"));

  const tagged = built({ short: true, title: "Ya #shorts", caption: "Hola #Shorts" }).resource
    .snippet;
  assert.equal(tagged.title, "Ya #shorts", "not added twice");
  assert.equal(tagged.description, "Hola #Shorts");

  const long = built({ short: true, title: "y".repeat(120) }).resource.snippet.title;
  assert.ok(long.endsWith(" #Shorts") && [...long].length <= 100, "the tag survives truncation");
  assert.equal(built({ short: false }).resource.snippet.title.includes("#Shorts"), false);
});

test("youtube metadata: made for kids, the kids rule, privacy and publishAt", () => {
  assert.equal(built({}, { madeForKids: true }).resource.status.selfDeclaredMadeForKids, true);
  assert.equal(built({ kidsBrand: true }).resource.status.selfDeclaredMadeForKids, true);
  const forced = built({ kidsBrand: true }, { madeForKids: false });
  assert.equal(forced.resource.status.selfDeclaredMadeForKids, true, "a kids brand always is");
  assert.match(forced.notes.join(), /kids rule/);

  assert.equal(built({}, { privacy: "public" }).resource.status.privacyStatus, "public");
  const scheduled = built({}, { privacy: "public", publishAt: "2026-10-08T15:00:00.000Z" });
  assert.equal(
    scheduled.resource.status.privacyStatus,
    "private",
    "YouTube schedules private videos",
  );
  assert.equal(scheduled.resource.status.publishAt, "2026-10-08T15:00:00.000Z");
  const past = built({}, { privacy: "unlisted", publishAt: "2026-10-01T00:00:00.000Z" });
  assert.equal(past.resource.status.privacyStatus, "unlisted");
  assert.equal(past.resource.status.publishAt, undefined);
  assert.match(past.notes.join(), /had passed/);

  assert.equal(built({ language: "es-PY" }).resource.snippet.defaultLanguage, "es-PY");
  assert.equal(built({ language: "castellano" }).resource.snippet.defaultLanguage, undefined);
});

test("youtube metadata: an over-long description is refused, tags fit 500 characters", () => {
  const r = buildYouTubeVideo(input({ caption: "é".repeat(2600) }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /5200 bytes; YouTube allows 5000/);
  const many = Array.from({ length: 80 }, (_, i) => `#tag${String(i).padStart(4, "0")}`).join(" ");
  const tags = built({ caption: many }).resource.snippet.tags ?? [];
  assert.ok(tags.join(",").length <= 500);
  assert.equal(tags.length, 62);
});

test("youtube permalink: Shorts and long videos", () => {
  assert.equal(youtubePermalink("abc", true), "https://www.youtube.com/shorts/abc");
  assert.equal(youtubePermalink("abc", false), "https://www.youtube.com/watch?v=abc");
});

// --- the resumable upload against a fake session ----------------------------

const dir = mkdtempSync(path.join(tmpdir(), "yt-upload-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const BYTES = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));
writeFileSync(path.join(dir, "clip.mp4"), BYTES);
writeFileSync(path.join(dir, "thumb.jpg"), Buffer.from("fakejpeg"));

const SESSION =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=FAKE";

type Call = { method: string; url: string; headers: Headers; body: Uint8Array | null };

/**
 * A resumable session: keeps the bytes it accepted, answers 308 + Range,
 * then 200 with the video. `fail(n)` makes the n-th chunk PUT misbehave.
 */
function session(
  fail: (n: number, call: Call) => "drop" | "503" | "keep-but-drop" | null = () => null,
) {
  const calls: Call[] = [];
  const got: number[] = [];
  let puts = 0;
  const done = () =>
    new Response(JSON.stringify(FIX("video-insert")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const incomplete = () =>
    new Response(null, {
      status: 308,
      headers: got.length ? { range: `bytes=0-${got.length - 1}` } : {},
    });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string"
        ? new TextEncoder().encode(init.body)
        : init?.body
          ? new Uint8Array(init.body as Uint8Array)
          : null;
    const call = { method: init?.method ?? "GET", url, headers, body };
    calls.push(call);
    if (call.method === "POST") {
      return new Response(null, { status: 200, headers: { location: SESSION } });
    }
    const range = headers.get("content-range") ?? "";
    if (range.startsWith("bytes */")) return got.length === BYTES.length ? done() : incomplete();
    const m = range.match(/bytes (\d+)-(\d+)\/(\d+)/)!;
    const start = Number(m[1]);
    const what = fail(++puts, call);
    if (what === "drop") throw new TypeError("fetch failed: socket hang up");
    if (what === "503") return new Response(JSON.stringify(FIX("error-backend")), { status: 503 });
    if (start === got.length) got.push(...body!);
    if (what === "keep-but-drop") throw new TypeError("fetch failed: other side closed");
    return got.length === BYTES.length ? done() : incomplete();
  };
  return { fetchImpl, calls, got };
}

const RESOURCE = { snippet: { title: "t" }, status: {} } as unknown as YouTubeResource;

async function upload(s: ReturnType<typeof session>, retries = 3) {
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  try {
    return await uploadYouTubeVideo(
      { token: "ya29.FAKE", fetch: s.fetchImpl, chunkBytes: 1000, retries, retryDelayMs: 0 },
      RESOURCE,
      file,
      "video/mp4",
      { notifySubscribers: false },
    );
  } finally {
    await file.close();
  }
}

test("resumable upload: metadata first, then the bytes in chunks with Content-Range", async () => {
  const s = session();
  assert.equal(await upload(s), "FAKEvid0001");
  const [init, ...puts] = s.calls;
  assert.equal(init.method, "POST");
  const u = new URL(init.url);
  assert.equal(u.pathname, "/upload/youtube/v3/videos");
  assert.equal(u.searchParams.get("uploadType"), "resumable");
  assert.equal(u.searchParams.get("part"), "snippet,status");
  assert.equal(u.searchParams.get("notifySubscribers"), "false");
  assert.equal(init.headers.get("authorization"), "Bearer ya29.FAKE");
  assert.equal(init.headers.get("x-upload-content-length"), "2500");
  assert.equal(init.headers.get("x-upload-content-type"), "video/mp4");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body!)), RESOURCE);
  assert.deepEqual(
    puts.map((p) => p.headers.get("content-range")),
    ["bytes 0-999/2500", "bytes 1000-1999/2500", "bytes 2000-2499/2500"],
  );
  assert.ok(puts.every((p) => p.url === SESSION));
  assert.deepEqual(Buffer.from(s.got), BYTES);
});

test("resumable upload: a dropped chunk or a 503 asks the session where it got to and resumes", async () => {
  const s = session((n) => (n === 2 ? "drop" : n === 3 ? "503" : null));
  assert.equal(await upload(s), "FAKEvid0001");
  const ranges = s.calls.slice(1).map((c) => c.headers.get("content-range"));
  assert.deepEqual(ranges, [
    "bytes 0-999/2500",
    "bytes 1000-1999/2500", // dropped
    "bytes */2500", // → 308 Range bytes=0-999 → 503 on the next chunk
    "bytes 1000-1999/2500",
    "bytes */2500",
    "bytes 1000-1999/2500",
    "bytes 2000-2499/2500",
  ]);
  assert.deepEqual(Buffer.from(s.got), BYTES);
});

test("resumable upload: a chunk the session kept but never confirmed is not sent twice", async () => {
  const s = session((n) => (n === 1 ? "keep-but-drop" : null));
  assert.equal(await upload(s), "FAKEvid0001");
  const ranges = s.calls.slice(1).map((c) => c.headers.get("content-range"));
  assert.deepEqual(ranges, [
    "bytes 0-999/2500",
    "bytes */2500",
    "bytes 1000-1999/2500",
    "bytes 2000-2499/2500",
  ]);
});

test("resumable upload: giving up mid-file is temporary; an unconfirmed last chunk is not", async () => {
  const mid = session((n) => (n >= 2 ? "drop" : null));
  const midErr = await upload(mid, 2).catch((e: unknown) => e);
  assert.ok(midErr instanceof PublishFailure);
  assert.equal(midErr.temporary, true);
  assert.match(midErr.message, /broke off at 40%/);

  const end = session((n, call) =>
    call.headers.get("content-range")?.startsWith("bytes 2000") ? "drop" : null,
  );
  const endErr = await upload(end, 2).catch((e: unknown) => e);
  assert.ok(endErr instanceof PublishFailure);
  assert.equal(endErr.temporary, false, "the video may exist: never retried automatically");
  assert.match(endErr.message, /may exist: check YouTube Studio/);
});

test("resumable upload: an auth or quota error stops at once with Google's reason", async () => {
  const quota = async () => new Response(JSON.stringify(FIX("error-quota")), { status: 403 });
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  const err = await uploadYouTubeVideo(
    { token: "ya29.FAKE", fetch: quota, chunkBytes: 1000, retries: 3, retryDelayMs: 0 },
    RESOURCE,
    file,
    "video/mp4",
    { notifySubscribers: true },
  ).catch((e: unknown) => e);
  await file.close();
  assert.ok(err instanceof ProviderApiError);
  assert.equal(err.code, "quotaExceeded");
  assert.equal(err.isTransient, false);
  assert.equal(err.isAuthError, false);

  const auth = async () => new Response(JSON.stringify(FIX("error-auth")), { status: 401 });
  const file2 = await openMediaFile("clip.mp4", "clip.mp4", dir);
  const err2 = await uploadYouTubeVideo(
    { token: "ya29.FAKE", fetch: auth, chunkBytes: 1000, retries: 3, retryDelayMs: 0 },
    RESOURCE,
    file2,
    "video/mp4",
    { notifySubscribers: true },
  ).catch((e: unknown) => e);
  await file2.close();
  assert.ok(err2 instanceof ProviderApiError && err2.isAuthError);
});

test("thumbnail: thumbnails.set with the image bytes", async () => {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: new Uint8Array(init?.body as Uint8Array),
    });
    return new Response(JSON.stringify(FIX("thumbnail-set")), { status: 200 });
  };
  const file = await openMediaFile("thumb.jpg", "thumb.jpg", dir);
  await setYouTubeThumbnail(
    { token: "ya29.FAKE", fetch: f, chunkBytes: 1000, retries: 0, retryDelayMs: 0 },
    "FAKEvid0001",
    file,
    "image/jpeg",
  );
  await file.close();
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/upload/youtube/v3/thumbnails/set");
  assert.equal(u.searchParams.get("videoId"), "FAKEvid0001");
  assert.equal(calls[0].headers.get("content-type"), "image/jpeg");
  assert.equal(new TextDecoder().decode(calls[0].body!), "fakejpeg");
});

test("an endless 308 with no acknowledged progress is bounded", async () => {
  let puts = 0;
  const fetchImpl = async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(null, { status: 200, headers: { location: SESSION } })
      : (puts++, new Response(null, { status: 308 }));
  const file = await openMediaFile("clip.mp4", "clip.mp4", dir);
  try {
    await assert.rejects(
      uploadYouTubeVideo(
        { token: "synthetic", fetch: fetchImpl, chunkBytes: 1000, retries: 2, retryDelayMs: 0 },
        RESOURCE,
        file,
        "video/mp4",
        { notifySubscribers: false },
      ),
      /made no progress/,
    );
    assert.equal(puts, 3);
  } finally {
    await file.close();
  }
});
