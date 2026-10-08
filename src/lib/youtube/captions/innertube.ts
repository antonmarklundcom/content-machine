import { assertOkResponse, fetchWithTimeout } from "./http";
import {
  CaptionError,
  type CaptionTrack,
  type ListTracksOptions,
  type StrategyName,
} from "./types";

/**
 * Talk to YouTube's internal player API directly.
 *
 * This is the primary strategy because it is a plain JSON POST — it never
 * touches the HTML watch page, so it sidesteps consent interstitials and the
 * cookie/bot walls that hit datacenter IPs first. Several client identities are
 * tried because YouTube gates them independently: when WEB starts demanding a
 * proof-of-origin token, ANDROID and the TV client typically still answer.
 */

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const PLAYER_URL = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;

type ClientProfile = {
  strategy: StrategyName;
  clientName: string;
  clientVersion: string;
  /** X-YouTube-Client-Name header value. */
  clientNameId: number;
  userAgent: string;
  extraClient?: Record<string, unknown>;
};

export const INNERTUBE_CLIENTS: Record<string, ClientProfile> = {
  android: {
    strategy: "innertube-android",
    clientName: "ANDROID",
    clientVersion: "19.09.37",
    clientNameId: 3,
    userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
    extraClient: { androidSdkVersion: 30, osName: "Android", osVersion: "11", platform: "MOBILE" },
  },
  ios: {
    strategy: "innertube-ios",
    clientName: "IOS",
    clientVersion: "19.09.3",
    clientNameId: 5,
    userAgent: "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
    extraClient: {
      deviceMake: "Apple",
      deviceModel: "iPhone14,3",
      osName: "iPhone",
      osVersion: "15.6.0.19G71",
      platform: "MOBILE",
    },
  },
  tv: {
    strategy: "innertube-tv",
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    clientNameId: 85,
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version (unlike Gecko) v8/8.8.278.8-jit gles Starboard/13",
    extraClient: { platform: "TV" },
  },
  web: {
    strategy: "innertube-web",
    clientName: "WEB",
    clientVersion: "2.20241211.01.00",
    clientNameId: 1,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraClient: { platform: "DESKTOP" },
  },
};

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        name?: { simpleText?: string; runs?: Array<{ text?: string }> };
        vssId?: string;
      }>;
    };
  };
};

export async function listTracksViaInnertube(
  videoId: string,
  client: ClientProfile,
  opts: ListTracksOptions = {},
): Promise<CaptionTrack[]> {
  const res = await fetchWithTimeout(
    PLAYER_URL,
    {
      method: "POST",
      timeoutMs: opts.timeoutMs,
      headers: {
        "content-type": "application/json",
        "user-agent": client.userAgent,
        "accept-language": "en-US,en;q=0.9",
        "x-youtube-client-name": String(client.clientNameId),
        "x-youtube-client-version": client.clientVersion,
        origin: "https://www.youtube.com",
      },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
            ...client.extraClient,
          },
          user: { lockedSafetyMode: false },
        },
      }),
    },
    "list",
  );
  assertOkResponse(res, "list");

  let data: PlayerResponse;
  try {
    data = (await res.json()) as PlayerResponse;
  } catch {
    throw new CaptionError("player response was not valid JSON", "parse", "list");
  }

  return extractTracks(data);
}

/**
 * Shared by the innertube and watch-page strategies — both end up holding the
 * same playerResponse shape.
 */
export function extractTracks(data: PlayerResponse): CaptionTrack[] {
  const status = data.playabilityStatus?.status;
  if (status && status !== "OK") {
    const reason = data.playabilityStatus?.reason ?? "";
    // "Sign in to confirm you're not a bot" is the datacenter-IP block that
    // PR-01 exists to detect; keep it distinguishable from a private video.
    const isBotWall = /sign in to confirm|not a bot|confirm you.?re/i.test(reason);
    throw new CaptionError(
      `playabilityStatus=${status}${reason ? ` (${reason})` : ""}`,
      isBotWall || status === "LOGIN_REQUIRED"
        ? "blocked"
        : status === "UNPLAYABLE" || status === "ERROR"
          ? "unavailable"
          : "unplayable",
      "list",
    );
  }

  const raw = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!raw || raw.length === 0) {
    throw new CaptionError("video has no caption tracks", "no_captions", "list");
  }

  const tracks: CaptionTrack[] = [];
  for (const t of raw) {
    if (!t.baseUrl || !t.languageCode) continue;
    tracks.push({
      baseUrl: t.baseUrl.startsWith("//") ? `https:${t.baseUrl}` : t.baseUrl,
      languageCode: t.languageCode,
      // YouTube marks auto-generated tracks with kind="asr"; vssId starting "a."
      // is the older signal and still appears on some responses.
      kind: t.kind === "asr" || t.vssId?.startsWith("a.") ? "asr" : "manual",
      name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text ?? "").join("") ?? t.languageCode,
    });
  }

  if (tracks.length === 0) {
    throw new CaptionError("caption tracks present but none had a usable URL", "parse", "list");
  }
  return tracks;
}
