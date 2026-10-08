import { configuredProxyUrl, proxiedFetch } from "./proxy";
import { CaptionError, type CaptionSegment, type CaptionTrack } from "./types";

/**
 * Strategy backed by the youtubei.js library.
 *
 * Kept behind a dynamic import for two reasons: the probe must still run and
 * report on the other strategies if this dependency is missing or broken on the
 * server, and the library is only loaded when it is actually reached. It gets a
 * dedicated module because it returns transcript text directly rather than a
 * timedtext URL, so it does not fit the listTracks/fetchTrack shape.
 */

type LooseRecord = Record<string, unknown>;

export async function listTracksViaLibrary(videoId: string): Promise<CaptionTrack[]> {
  const info = await getInfo(videoId);
  const raw = (info as LooseRecord)["captions"] as LooseRecord | undefined;
  const list = (raw?.["caption_tracks"] ?? []) as Array<LooseRecord>;

  const tracks: CaptionTrack[] = [];
  for (const t of list) {
    const baseUrl = t["base_url"] as string | undefined;
    const languageCode = t["language_code"] as string | undefined;
    if (!baseUrl || !languageCode) continue;
    const vssId = t["vss_id"] as string | undefined;
    const name = t["name"] as LooseRecord | string | undefined;
    tracks.push({
      baseUrl,
      languageCode,
      kind: t["kind"] === "asr" || vssId?.startsWith("a.") ? "asr" : "manual",
      name:
        typeof name === "string" ? name : ((name?.["text"] as string | undefined) ?? languageCode),
    });
  }

  if (tracks.length === 0) {
    throw new CaptionError("video has no caption tracks", "no_captions", "list");
  }
  return tracks;
}

/**
 * The library's own transcript endpoint. Used as a last resort because it can
 * return text when the timedtext URLs themselves are being refused.
 */
export async function fetchTranscriptViaLibrary(
  videoId: string,
): Promise<{ segments: CaptionSegment[]; languageCode: string }> {
  const info = await getInfo(videoId);
  const getTranscript = (info as LooseRecord)["getTranscript"];
  if (typeof getTranscript !== "function") {
    throw new CaptionError("youtubei.js exposed no getTranscript()", "parse", "fetch");
  }

  let transcript: LooseRecord;
  try {
    transcript = (await getTranscript.call(info)) as LooseRecord;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CaptionError(
      `getTranscript failed: ${msg}`,
      /transcript|not available|disabled/i.test(msg) ? "no_captions" : "network",
      "fetch",
    );
  }

  const content = dig(transcript, ["transcript", "content", "body", "initial_segments"]) as
    Array<LooseRecord> | undefined;
  if (!content || content.length === 0) {
    throw new CaptionError("transcript contained no segments", "no_captions", "fetch");
  }

  const segments: CaptionSegment[] = [];
  for (const seg of content) {
    const snippet = seg["snippet"] as LooseRecord | undefined;
    const text = ((snippet?.["text"] as string | undefined) ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const startMs = Number(seg["start_ms"] ?? 0) || 0;
    const endMs = Number(seg["end_ms"] ?? 0) || 0;
    segments.push({
      start: startMs / 1000,
      dur: Math.max(0, (endMs - startMs) / 1000),
      text,
    });
  }

  const languageCode =
    (dig(transcript, ["selectedLanguage"]) as string | undefined) ??
    (dig(info, ["captions", "caption_tracks", "0", "language_code"]) as string | undefined) ??
    "unknown";

  return { segments, languageCode };
}

async function getInfo(videoId: string): Promise<unknown> {
  let mod: LooseRecord;
  try {
    mod = (await import("youtubei.js")) as unknown as LooseRecord;
  } catch (err) {
    throw new CaptionError(
      `youtubei.js is not installed or failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "unavailable",
      "list",
    );
  }

  const Innertube = (mod["Innertube"] ?? (mod["default"] as LooseRecord)?.["Innertube"]) as
    { create: (opts: LooseRecord) => Promise<LooseRecord> } | undefined;
  if (!Innertube)
    throw new CaptionError("youtubei.js exported no Innertube", "unavailable", "list");

  try {
    // Only override the library's fetch when a proxy is actually configured —
    // otherwise leave it on its own default, which is what it was tested with.
    const yt = await Innertube.create({
      lang: "en",
      location: "US",
      retrieve_player: false,
      ...(configuredProxyUrl() ? { fetch: proxiedFetch } : {}),
    });
    const fn = yt["getInfo"] as ((id: string) => Promise<unknown>) | undefined;
    if (!fn) throw new Error("client exposed no getInfo()");
    return await fn.call(yt, videoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CaptionError(
      `getInfo failed: ${msg}`,
      /sign in|bot|429|403|consent/i.test(msg) ? "blocked" : "network",
      "list",
    );
  }
}

function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as LooseRecord)[key];
  }
  return cur;
}
