import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { encryptionKeyProblem } from "@/lib/crypto";
import { requestOrigin } from "@/lib/meta/config";
import {
  TIKTOK_OAUTH_PATH,
  TIKTOK_STATE_COOKIE,
  tiktokConfig,
  tiktokRedirectUri,
} from "@/lib/tiktok/config";
import { tiktokAuthUrl } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

function back(request: Request, error: string): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  url.searchParams.set("tiktok_error", error);
  url.hash = "tiktok";
  return NextResponse.redirect(url);
}

/** Settings → "Connect TikTok": off to TikTok's authorize page (build 4 §3.F). */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSession();
  if (user?.role !== "owner") return back(request, "Only the owner can connect TikTok.");
  const config = tiktokConfig();
  if (!config) return back(request, "Save the TikTok client key and secret first.");
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return back(request, keyProblem);

  const origin = requestOrigin(request);
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(tiktokAuthUrl(config, tiktokRedirectUri(origin), state));
  res.cookies.set(TIKTOK_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: TIKTOK_OAUTH_PATH,
    maxAge: 600,
  });
  return res;
}
