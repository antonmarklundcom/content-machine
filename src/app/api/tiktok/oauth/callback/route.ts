import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { requestOrigin } from "@/lib/meta/config";
import { redactTokens } from "@/lib/publish/provider-error";
import {
  TIKTOK_OAUTH_PATH,
  TIKTOK_STATE_COOKIE,
  tiktokConfig,
  tiktokRedirectUri,
} from "@/lib/tiktok/config";
import { saveTikTokConnection } from "@/lib/tiktok/integration";
import { exchangeTikTokCode, tiktokUserInfo } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.hash = "tiktok";
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: TIKTOK_STATE_COOKIE, path: TIKTOK_OAUTH_PATH });
  return res;
}

/**
 * Where TikTok sends the browser back (build 4 §3.F): check the state, trade
 * the code for tokens, read who the creator is, store the tokens encrypted.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const user = await getSession();
  if (user?.role !== "owner") {
    return back(request, { tiktok_error: "Only the owner can connect TikTok." });
  }
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back(request, { tiktok_error: `TikTok said: ${denied}`.slice(0, 300) });

  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(TIKTOK_STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) {
    return back(request, {
      tiktok_error: "The login link expired or was opened in another browser. Try Connect again.",
    });
  }
  const code = url.searchParams.get("code");
  if (!code) return back(request, { tiktok_error: "TikTok sent no code. Try Connect again." });
  const config = tiktokConfig();
  if (!config) {
    return back(request, { tiktok_error: "The TikTok client key and secret are not set." });
  }

  try {
    const tokens = await exchangeTikTokCode(
      config,
      code,
      tiktokRedirectUri(requestOrigin(request)),
    );
    const info = await tiktokUserInfo(tokens.accessToken).catch(() => ({
      openId: tokens.openId,
      displayName: tokens.openId,
      avatarUrl: null,
    }));
    await saveTikTokConnection(tokens, info);
    return back(request, { tiktok: "connected" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return back(request, { tiktok_error: redactTokens(msg).slice(0, 300) });
  }
}
