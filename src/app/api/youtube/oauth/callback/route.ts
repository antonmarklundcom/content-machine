import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  googleConfig,
  YOUTUBE_OAUTH_PATH,
  YOUTUBE_STATE_COOKIE,
  youtubeRedirectUri,
} from "@/lib/google/config";
import { autoLinkYouTube, saveYouTubeConnections } from "@/lib/google/integration";
import { exchangeGoogleCode, listChannels } from "@/lib/google/oauth";
import { requestOrigin } from "@/lib/meta/config";
import { redactTokens } from "@/lib/publish/provider-error";

export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.hash = "youtube";
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: YOUTUBE_STATE_COOKIE, path: YOUTUBE_OAUTH_PATH });
  return res;
}

/**
 * Where Google sends the browser back (build 4 §3.F): check the state, trade
 * the code for tokens, store the refresh token encrypted per channel, and
 * link YouTube accounts whose handle matches the channel's @handle.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const user = await getSession();
  if (user?.role !== "owner") {
    return back(request, { youtube_error: "Only the owner can connect YouTube." });
  }
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back(request, { youtube_error: `Google said: ${denied}`.slice(0, 300) });

  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(YOUTUBE_STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) {
    return back(request, {
      youtube_error: "The login link expired or was opened in another browser. Try Connect again.",
    });
  }
  const code = url.searchParams.get("code");
  if (!code) return back(request, { youtube_error: "Google sent no code. Try Connect again." });
  const config = googleConfig();
  if (!config) {
    return back(request, { youtube_error: "The Google OAuth client ID and secret are not set." });
  }

  try {
    const tokens = await exchangeGoogleCode(
      config,
      code,
      youtubeRedirectUri(requestOrigin(request)),
    );
    const channels = await listChannels(tokens.accessToken);
    if (!channels.length) {
      return back(request, {
        youtube_error:
          "That Google account has no YouTube channel. Create one, then connect again.",
      });
    }
    const rows = await saveYouTubeConnections(tokens, channels);
    let linked = 0;
    try {
      linked = await autoLinkYouTube(rows, channels);
    } catch {
      // Linking is also offered by hand in Settings; a failure here is not a failed connect.
    }
    return back(request, { youtube: "connected", linked: String(linked) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return back(request, { youtube_error: redactTokens(msg).slice(0, 300) });
  }
}
