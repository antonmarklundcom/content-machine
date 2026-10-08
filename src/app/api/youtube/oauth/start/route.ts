import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { encryptionKeyProblem } from "@/lib/crypto";
import {
  googleConfig,
  YOUTUBE_OAUTH_PATH,
  YOUTUBE_STATE_COOKIE,
  youtubeRedirectUri,
} from "@/lib/google/config";
import { googleAuthUrl } from "@/lib/google/oauth";
import { requestOrigin } from "@/lib/meta/config";

export const dynamic = "force-dynamic";

function back(request: Request, error: string): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  url.searchParams.set("youtube_error", error);
  url.hash = "youtube";
  return NextResponse.redirect(url);
}

/** Settings → "Connect YouTube": off to Google's consent screen (build 4 §3.F). */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSession();
  if (user?.role !== "owner") return back(request, "Only the owner can connect YouTube.");
  const config = googleConfig();
  if (!config) return back(request, "Save the Google OAuth client ID and secret first.");
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return back(request, keyProblem);

  const origin = requestOrigin(request);
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(config, youtubeRedirectUri(origin), state));
  res.cookies.set(YOUTUBE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: YOUTUBE_OAUTH_PATH,
    maxAge: 600,
  });
  return res;
}
