import "server-only";

import type { Integration } from "@/db/schema";
import { accessToken, listConnections, saveConnection } from "@/lib/publish/connections";
import type { HttpFetch } from "@/lib/publish/provider-error";

import { tiktokConfig } from "./config";
import { tiktokFetch } from "./http";
import { refreshTikTokToken, type TikTokTokens, type TikTokUser } from "./oauth";

/**
 * TikTok connections (build 4 §3.F): one `integrations` row per creator
 * (`provider = tiktok`, `account_ref` = open_id). `token_expires_at` is the
 * refresh token's end (a year); after that the creator connects again.
 */

export function saveTikTokConnection(tokens: TikTokTokens, user: TikTokUser) {
  return saveConnection({
    provider: "tiktok",
    accountRef: tokens.openId,
    label: `TikTok — ${user.displayName}`,
    tokens: {
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken,
    },
    scopes: tokens.scopes,
    loginExpiresAt: tokens.refreshExpiresAt,
  });
}

export const listTikTokConnections = () => listConnections("tiktok");

export function tiktokAccessToken(
  row: Integration,
  fetchImpl: HttpFetch = tiktokFetch(),
  now = new Date(),
) {
  return accessToken(
    row,
    async (refreshToken, at) => {
      const config = tiktokConfig();
      if (!config) throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set.");
      return refreshTikTokToken(config, refreshToken, fetchImpl, at);
    },
    now,
  );
}
