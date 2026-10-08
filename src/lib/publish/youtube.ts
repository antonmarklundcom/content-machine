import { YOUTUBE_UPLOAD_API } from "@/lib/google/config";
import { googleError } from "@/lib/google/http";

import { PublishFailure } from "./meta";
import type { YouTubeOptions } from "./options";
import { readJson, send, sleep, type HttpFetch } from "./provider-error";
import type { MediaFile } from "./video-file";

/**
 * YouTube uploads (build 4 §3.F): `videos.insert` as a resumable upload.
 *
 *   1. POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *      with the metadata → a session URI in `Location`.
 *   2. PUT the bytes to the session in chunks (`Content-Range`); YouTube
 *      answers 308 + `Range` until the last chunk, then 200 with the video.
 *   3. On a dropped connection or a 5xx, ask the session how much it has
 *      (`Content-Range: bytes * /total`) and carry on from there.
 *
 * The last chunk is what creates the video. If YouTube never confirms it,
 * the video may exist, so that failure is never retried automatically (the
 * same rule as Meta's publish call in O13). Live path UNVERIFIED (§1.12).
 */

/** Chunks must be multiples of 256 KiB; 8 MiB is Google's suggested size. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
export const YOUTUBE_TAGS_MAX_CHARS = 500;
export const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

export type YouTubeResource = {
  snippet: {
    title: string;
    description: string;
    tags?: string[];
    categoryId: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  status: {
    privacyStatus: "private" | "unlisted" | "public";
    selfDeclaredMadeForKids: boolean;
    publishAt?: string;
    embeddable: boolean;
  };
};

const SHORTS_TAG = "#Shorts";
const hasShortsTag = (s: string) => /(^|\s)#shorts\b/i.test(s);
/** YouTube rejects `<` and `>` in titles and descriptions. */
const clean = (s: string) => s.replace(/[<>]/g, "").trim();

function hashtags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1];
    const key = tag.toLowerCase();
    if (key === "shorts" || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Tags fit in 500 characters counting the commas between them. */
function fitTags(tags: string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of tags) {
    const cost = t.length + (out.length ? 1 : 0);
    if (used + cost > YOUTUBE_TAGS_MAX_CHARS) break;
    out.push(t);
    used += cost;
  }
  return out;
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max
    ? s
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

/** `es`, `en`, `sv`, `es-PY` … as YouTube's BCP-47 language; anything else is left out. */
function language(lang: string | null): string | undefined {
  return lang && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : undefined;
}

export type YouTubeBuildInput = {
  /** The post's title; empty falls back to the caption's first line. */
  title: string;
  caption: string;
  leadUrl: string | null;
  options: YouTubeOptions;
  /** The brand makes children's content: made for kids, always. */
  kidsBrand: boolean;
  language: string | null;
  short: boolean;
  now: Date;
};

/** The `snippet` and `status` sent with the upload. Pure. */
export function buildYouTubeVideo(
  input: YouTubeBuildInput,
): { ok: true; resource: YouTubeResource; notes: string[] } | { ok: false; error: string } {
  const notes: string[] = [];
  const caption = clean(input.caption);
  const firstLine =
    caption
      .split("\n")
      .map((l) => l.replace(/(^|\s)#[^\s#]+/g, " ").trim())
      .find(Boolean) ?? "";
  let title = clean(input.title) || firstLine;
  if (!title) return { ok: false, error: "A YouTube video needs a title; give the post one." };
  if (input.short && !hasShortsTag(title)) {
    title = `${truncate(title, YOUTUBE_TITLE_MAX - SHORTS_TAG.length - 1)} ${SHORTS_TAG}`;
  } else {
    title = truncate(title, YOUTUBE_TITLE_MAX);
  }

  const parts = [caption];
  if (input.leadUrl && !caption.includes(input.leadUrl)) parts.push(input.leadUrl);
  if (input.short && !hasShortsTag(caption)) parts.push(SHORTS_TAG);
  const description = parts.filter(Boolean).join("\n\n");
  const bytes = Buffer.byteLength(description, "utf8");
  if (bytes > YOUTUBE_DESCRIPTION_MAX_BYTES) {
    return {
      ok: false,
      error: `The YouTube description is ${bytes} bytes; YouTube allows ${YOUTUBE_DESCRIPTION_MAX_BYTES}. Shorten the caption.`,
    };
  }

  const kids = input.kidsBrand || input.options.madeForKids === true;
  if (input.kidsBrand && input.options.madeForKids === false) {
    notes.push("made for kids was set on: this brand makes children's content (the kids rule)");
  }

  const status: YouTubeResource["status"] = {
    privacyStatus: input.options.privacy,
    selfDeclaredMadeForKids: kids,
    embeddable: true,
  };
  if (input.options.publishAt) {
    const at = new Date(input.options.publishAt);
    if (at.getTime() > input.now.getTime()) {
      // YouTube only schedules private videos; it flips them public at publishAt.
      status.privacyStatus = "private";
      status.publishAt = at.toISOString();
    } else {
      notes.push("the YouTube publish time had passed, so it was uploaded without one");
    }
  }

  const tags = fitTags(hashtags(input.caption));
  const lang = language(input.language);
  return {
    ok: true,
    notes,
    resource: {
      snippet: {
        title,
        description,
        ...(tags.length ? { tags } : {}),
        categoryId: input.options.categoryId,
        ...(lang ? { defaultLanguage: lang, defaultAudioLanguage: lang } : {}),
      },
      status,
    },
  };
}

export function youtubePermalink(videoId: string, short: boolean): string {
  return short
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
}

// --- the upload ---------------------------------------------------------------

export type YouTubeUploader = {
  token: string;
  fetch: HttpFetch;
  chunkBytes: number;
  /** Status checks after a failed chunk before giving up. */
  retries: number;
  retryDelayMs: number;
};

type Step = { done: string } | { next: number } | { retry: true };

async function step(res: Response | null): Promise<Step> {
  if (!res) return { retry: true };
  if (res.status === 200 || res.status === 201) {
    const body = (await readJson("youtube", res)) as { id?: string };
    if (!body.id)
      throw new PublishFailure("YouTube finished the upload but sent no video id.", false, true);
    return { done: body.id };
  }
  if (res.status === 308) {
    await res.body?.cancel();
    const range = res.headers.get("range");
    const m = range?.match(/bytes=0-(\d+)/);
    return { next: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status >= 500) {
    await res.body?.cancel();
    return { retry: true };
  }
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel();
    throw new PublishFailure(
      "The YouTube upload session expired before the video was complete.",
      true,
    );
  }
  throw googleError(res.status, await readJson("youtube", res).catch(() => ({})));
}

async function put(up: YouTubeUploader, session: string, init: RequestInit) {
  try {
    return await send("youtube", up.fetch, session, { method: "PUT", ...init });
  } catch {
    return null;
  }
}

/** Upload one video; returns its id. */
export async function uploadYouTubeVideo(
  up: YouTubeUploader,
  resource: YouTubeResource,
  file: MediaFile,
  mime: string,
  opts: { notifySubscribers: boolean; beforeCommit?: () => Promise<void> },
): Promise<string> {
  const url = new URL(`${YOUTUBE_UPLOAD_API}/videos`);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");
  if (!opts.notifySubscribers) url.searchParams.set("notifySubscribers", "false");
  const init = await send("youtube", up.fetch, url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${up.token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(file.size),
      "x-upload-content-type": mime,
    },
    body: JSON.stringify(resource),
  });
  if (!init.ok) throw googleError(init.status, await readJson("youtube", init).catch(() => ({})));
  await init.body?.cancel();
  const session = init.headers.get("location");
  if (!session) throw new PublishFailure("YouTube started no upload session.", true);

  const size = file.size;
  let offset = 0;
  let failures = 0;
  let stalls = 0;
  for (;;) {
    const end = Math.min(offset + up.chunkBytes, size);
    if (end === size) await opts.beforeCommit?.();
    let outcome = await step(
      await put(up, session, {
        headers: {
          authorization: `Bearer ${up.token}`,
          "content-type": mime,
          "content-range": `bytes ${offset}-${end - 1}/${size}`,
        },
        body: await file.read(offset, end - offset),
      }),
    );
    while ("retry" in outcome) {
      failures++;
      if (failures > up.retries) {
        if (end === size) {
          throw new PublishFailure(
            "YouTube did not confirm the end of the upload. The video may exist: check YouTube " +
              "Studio before publishing again.",
            false,
            true,
          );
        }
        throw new PublishFailure(
          `The YouTube upload broke off at ${Math.round((offset / size) * 100)}%.`,
          true,
        );
      }
      await sleep(up.retryDelayMs * 2 ** (failures - 1));
      // Where did it get to? An empty PUT with `bytes */total` asks the session.
      outcome = await step(
        await put(up, session, {
          headers: { authorization: `Bearer ${up.token}`, "content-range": `bytes */${size}` },
        }),
      );
    }
    if ("done" in outcome) return outcome.done;
    if (outcome.next < 0 || outcome.next > size || outcome.next < offset) {
      throw new PublishFailure(
        "YouTube returned an invalid upload offset; verify the existing upload before trying again.",
        false,
        true,
      );
    }
    if (outcome.next > offset) failures = 0;
    stalls = outcome.next > offset ? 0 : stalls + 1;
    if (stalls > up.retries)
      throw new PublishFailure(
        "YouTube upload made no progress; verify the existing upload before trying again.",
        false,
        true,
      );
    offset = outcome.next;
  }
}

/** `thumbnails.set` from a `thumbnail` asset. Custom thumbnails need a verified channel. */
export async function setYouTubeThumbnail(
  up: YouTubeUploader,
  videoId: string,
  file: MediaFile,
  mime: string,
): Promise<void> {
  if (file.size > YOUTUBE_THUMBNAIL_MAX_BYTES) {
    throw new Error(`${file.name} is over 2 MB, YouTube's thumbnail limit`);
  }
  const url = `${YOUTUBE_UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`;
  const res = await send("youtube", up.fetch, url, {
    method: "POST",
    headers: { authorization: `Bearer ${up.token}`, "content-type": mime },
    body: await file.read(0, file.size),
  });
  if (!res.ok) throw googleError(res.status, await readJson("youtube", res).catch(() => ({})));
  await res.body?.cancel();
}
