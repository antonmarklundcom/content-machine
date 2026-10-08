import type { HttpFetch } from "@/lib/publish/provider-error";

import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  YOUTUBE_API,
  YOUTUBE_SCOPES,
  type GoogleConfig,
} from "./config";
import { googleFetch, googleJson } from "./http";

/**
 * Google OAuth 2.0 web-server flow for YouTube (build 4 §3.F): the consent
 * URL (offline access, consent prompt so a refresh token always comes back),
 * code → tokens, refresh → a fresh access token, and the channel list.
 */

export function googleAuthUrl(config: GoogleConfig, redirect: string, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  // A refresh token is only issued with offline access, and only reliably
  // when the consent screen is shown again.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenAnswer = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type GoogleTokens = {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  scopes: string[];
};

const form = (params: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(params).toString(),
});

const expiry = (now: Date, seconds: number | undefined) =>
  new Date(now.getTime() + (seconds ?? 3600) * 1000);

export async function exchangeGoogleCode(
  config: GoogleConfig,
  code: string,
  redirect: string,
  fetchImpl: HttpFetch = googleFetch(),
  now = new Date(),
): Promise<GoogleTokens> {
  const t = await googleJson<TokenAnswer>(
    GOOGLE_TOKEN_URL,
    form({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
    fetchImpl,
  );
  if (!t.refresh_token) {
    throw new Error(
      "Google sent no refresh token. Remove content-engine at myaccount.google.com/permissions and connect again.",
    );
  }
  return {
    accessToken: t.access_token,
    accessExpiresAt: expiry(now, t.expires_in),
    refreshToken: t.refresh_token,
    scopes: (t.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

/** A fresh access token; Google may (rarely) rotate the refresh token too. */
export async function refreshGoogleToken(
  config: GoogleConfig,
  refreshToken: string,
  fetchImpl: HttpFetch = googleFetch(),
  now = new Date(),
): Promise<{ accessToken: string; accessExpiresAt: Date; refreshToken: string }> {
  const t = await googleJson<TokenAnswer>(
    GOOGLE_TOKEN_URL,
    form({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );
  return {
    accessToken: t.access_token,
    accessExpiresAt: expiry(now, t.expires_in),
    refreshToken: t.refresh_token ?? refreshToken,
  };
}

export type YouTubeChannel = {
  id: string;
  title: string;
  /** `@handle`, when the channel has one. */
  customUrl: string | null;
  thumbnailUrl: string | null;
};

type ChannelList = {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: { default?: { url?: string } };
    };
  }>;
};

/** `channels.list?mine=true`: the channel(s) the login acts for. */
export async function listChannels(
  accessToken: string,
  fetchImpl: HttpFetch = googleFetch(),
): Promise<YouTubeChannel[]> {
  const r = await googleJson<ChannelList>(
    `${YOUTUBE_API}/channels?part=snippet&mine=true&maxResults=50`,
    { headers: { authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  );
  return (r.items ?? []).map((c) => ({
    id: c.id,
    title: c.snippet?.title ?? c.id,
    customUrl: c.snippet?.customUrl ?? null,
    thumbnailUrl: c.snippet?.thumbnails?.default?.url ?? null,
  }));
}
