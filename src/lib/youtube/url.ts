/**
 * Parse any YouTube URL (or bare ID) into a typed reference.
 *
 * Shared by the PR-01 caption probe and the PR-04 Data API client, so URL
 * handling has exactly one implementation.
 */

export type YouTubeRef =
  | { kind: "video"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  | { kind: "channel"; channelId: string }
  /** @handle or /c/Name or /user/Name — needs a Data API lookup to resolve to a channelId. */
  | { kind: "channel_handle"; handle: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^(?:PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{10,}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** Extract an 11-char video ID from a URL or return it unchanged if already an ID. */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;
  const ref = parseYouTubeUrl(trimmed);
  return ref?.kind === "video" ? ref.videoId : null;
}

export function parseYouTubeUrl(input: string): YouTubeRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare IDs — check the most specific patterns first, since a channel ID
  // and a playlist ID are both valid-looking opaque strings.
  if (CHANNEL_ID.test(raw)) return { kind: "channel", channelId: raw };
  if (PLAYLIST_ID.test(raw)) return { kind: "playlist", playlistId: raw };
  if (VIDEO_ID.test(raw)) return { kind: "video", videoId: raw };
  if (raw.startsWith("@")) return { kind: "channel_handle", handle: raw.slice(1) };

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  const segments = url.pathname.split("/").filter(Boolean);

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = segments[0];
    return id && VIDEO_ID.test(id) ? { kind: "video", videoId: id } : null;
  }

  // A ?list= on a /watch URL means the user pasted a playlist context. Prefer the
  // playlist only when there is no specific video, otherwise the single video wins.
  const listParam = url.searchParams.get("list");
  const vParam = url.searchParams.get("v");

  if (vParam && VIDEO_ID.test(vParam)) return { kind: "video", videoId: vParam };
  if (listParam && PLAYLIST_ID.test(listParam)) return { kind: "playlist", playlistId: listParam };

  const [first, second] = segments;
  if (!first) return null;

  switch (first) {
    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    case "embed":
    case "shorts":
    case "live":
    case "v":
      return second && VIDEO_ID.test(second) ? { kind: "video", videoId: second } : null;

    // /playlist?list=... handled by listParam above; bare /playlist/<id> is not a real form.
    case "playlist":
      return null;

    // /channel/UC...
    case "channel":
      return second && CHANNEL_ID.test(second) ? { kind: "channel", channelId: second } : null;

    // /c/Name and /user/Name are legacy vanity paths — resolve via the Data API.
    case "c":
    case "user":
      return second ? { kind: "channel_handle", handle: second } : null;

    default:
      // /@handle
      if (first.startsWith("@")) return { kind: "channel_handle", handle: first.slice(1) };
      return null;
  }
}

export function describeRef(ref: YouTubeRef): string {
  switch (ref.kind) {
    case "video":
      return `video ${ref.videoId}`;
    case "playlist":
      return `playlist ${ref.playlistId}`;
    case "channel":
      return `channel ${ref.channelId}`;
    case "channel_handle":
      return `channel handle @${ref.handle}`;
  }
}
