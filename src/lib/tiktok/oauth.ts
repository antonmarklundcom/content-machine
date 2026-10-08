import { send, type HttpFetch } from "@/lib/publish/provider-error";

import {
  TIKTOK_API,
  TIKTOK_AUTH_URL,
  TIKTOK_SCOPES,
  TIKTOK_TOKEN_URL,
  type TikTokConfig,
} from "./config";
import { tiktokFetch, tiktokParse } from "./http";

/**
 * TikTok OAuth v2 (build 4 §3.F): the authorize URL, code → tokens (access
 * 24 h, refresh 365 days), refresh, and who the creator is.
 */

export function tiktokAuthUrl(config: TikTokConfig, redirect: string, state: string): string {
  const url = new URL(TIKTOK_AUTH_URL);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenAnswer = {
  access_token: string;
  expires_in?: number;
  open_id: string;
  refresh_token: string;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type TikTokTokens = {
  openId: string;
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date | null;
  scopes: string[];
};

async function tokenCall(params: Record<string, string>, fetchImpl: HttpFetch, now: Date) {
  const res = await send("tiktok", fetchImpl, TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: new URLSearchParams(params).toString(),
  });
  // The token endpoint answers flat (no `data` envelope) on success.
  const clone = res.clone();
  const flat = (await clone.json().catch(() => ({}))) as Partial<TokenAnswer>;
  const t: Partial<TokenAnswer> = flat.access_token ? flat : await tiktokParse<TokenAnswer>(res);
  if (!t.access_token || !t.refresh_token || !t.open_id) {
    throw new Error("TikTok answered without a token. Try Connect again.");
  }
  return {
    openId: t.open_id,
    accessToken: t.access_token,
    accessExpiresAt: new Date(now.getTime() + (t.expires_in ?? 86_400) * 1000),
    refreshToken: t.refresh_token,
    refreshExpiresAt: t.refresh_expires_in
      ? new Date(now.getTime() + t.refresh_expires_in * 1000)
      : null,
    scopes: (t.scope ?? "").split(/[,\s]+/).filter(Boolean),
  };
}

export function exchangeTikTokCode(
  config: TikTokConfig,
  code: string,
  redirect: string,
  fetchImpl: HttpFetch = tiktokFetch(),
  now = new Date(),
): Promise<TikTokTokens> {
  return tokenCall(
    {
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    },
    fetchImpl,
    now,
  );
}

export function refreshTikTokToken(
  config: TikTokConfig,
  refreshToken: string,
  fetchImpl: HttpFetch = tiktokFetch(),
  now = new Date(),
): Promise<TikTokTokens> {
  return tokenCall(
    {
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    fetchImpl,
    now,
  );
}

export type TikTokUser = { openId: string; displayName: string; avatarUrl: string | null };

export async function tiktokUserInfo(
  accessToken: string,
  fetchImpl: HttpFetch = tiktokFetch(),
): Promise<TikTokUser> {
  const res = await send(
    "tiktok",
    fetchImpl,
    `${TIKTOK_API}/v2/user/info/?fields=open_id,avatar_url,display_name`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const d = await tiktokParse<{
    user?: { open_id?: string; display_name?: string; avatar_url?: string };
  }>(res);
  const u = d.user ?? {};
  return {
    openId: u.open_id ?? "",
    displayName: u.display_name ?? u.open_id ?? "TikTok",
    avatarUrl: u.avatar_url ?? null,
  };
}
