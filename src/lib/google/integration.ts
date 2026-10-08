import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { socialAccounts, type Integration } from "@/db/schema";
import {
  accessToken,
  linkVideoAccount,
  listConnections,
  saveConnection,
} from "@/lib/publish/connections";
import type { HttpFetch } from "@/lib/publish/provider-error";

import { googleConfig } from "./config";
import { googleFetch } from "./http";
import { refreshGoogleToken, type GoogleTokens, type YouTubeChannel } from "./oauth";

/**
 * YouTube connections (build 4 §3.F): one `integrations` row per channel
 * (`provider = youtube`, `account_ref` = channel id). A Google login acts for
 * the channel picked on Google's account chooser, so a second channel (a
 * brand account) is a second Connect.
 */

export async function saveYouTubeConnections(
  tokens: GoogleTokens,
  channels: YouTubeChannel[],
): Promise<Integration[]> {
  const rows: Integration[] = [];
  for (const c of channels) {
    rows.push(
      await saveConnection({
        provider: "youtube",
        accountRef: c.id,
        label: `YouTube — ${c.title}${c.customUrl ? ` (${c.customUrl})` : ""}`,
        tokens: {
          accessToken: tokens.accessToken,
          accessExpiresAt: tokens.accessExpiresAt,
          refreshToken: tokens.refreshToken,
        },
        scopes: tokens.scopes,
        // Google refresh tokens last until revoked (7 days while the OAuth app is in "Testing").
        loginExpiresAt: null,
      }),
    );
  }
  return rows;
}

export const listYouTubeConnections = () => listConnections("youtube");

/** A usable access token for a YouTube row, renewed with the refresh token when needed. */
export function youtubeAccessToken(
  row: Integration,
  fetchImpl: HttpFetch = googleFetch(),
  now = new Date(),
) {
  return accessToken(
    row,
    async (refreshToken, at) => {
      const config = googleConfig();
      if (!config) {
        throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set.");
      }
      return refreshGoogleToken(config, refreshToken, fetchImpl, at);
    },
    now,
  );
}

const bare = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/**
 * Link each unlinked YouTube account whose handle is a connected channel's
 * `@handle`. Returns how many were linked.
 */
export async function autoLinkYouTube(rows: Integration[], channels: YouTubeChannel[]) {
  const byHandle = new Map<string, { channelId: string; integrationId: number }>();
  for (const c of channels) {
    const row = rows.find((r) => r.accountRef === c.id);
    if (row && c.customUrl)
      byHandle.set(bare(c.customUrl), { channelId: c.id, integrationId: row.id });
  }
  if (!byHandle.size) return 0;
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.platform, "youtube"));
  let linked = 0;
  for (const a of accounts) {
    const hit = byHandle.get(bare(a.handle));
    if (!hit || a.externalId) continue;
    await linkVideoAccount(a.id, "youtube", {
      externalId: hit.channelId,
      integrationId: hit.integrationId,
    });
    linked++;
  }
  return linked;
}
