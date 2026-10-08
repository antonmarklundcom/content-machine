import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { socialAccounts, type Integration, type SocialAccount } from "@/db/schema";
import { encryptionKeyProblem } from "@/lib/crypto";
import { googleConfig } from "@/lib/google/config";
import { tiktokConfig } from "@/lib/tiktok/config";

import { listConnections, withoutToken } from "./connections";
import type { VideoProvider } from "./provider-error";

/**
 * What Settings → YouTube / TikTok shows (build 4 §3.F). No API call per
 * render: the channel / creator name is in the row's label, and token
 * problems surface as the row's status.
 */

/** A login closer than this to its end gets a "reconnect soon" banner (TikTok: a year). */
export const LOGIN_WARNING_DAYS = 14;

export type VideoConnection = {
  row: Omit<Integration, "tokenCiphertext">;
  banner: { level: "expired" | "error" | "soon"; message: string } | null;
  linked: SocialAccount[];
};

export type VideoSettingsState = {
  provider: VideoProvider;
  /** The client id / key, shown back (not secret). */
  clientId: string | null;
  secretSet: boolean;
  keyProblem: string | null;
  connections: VideoConnection[];
  accounts: SocialAccount[];
};

export function connectionBanner(row: Integration, now = new Date()): VideoConnection["banner"] {
  const ended = row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime();
  if (row.status === "expired" || ended) {
    return { level: "expired", message: row.lastError ?? "The login expired. Reconnect." };
  }
  if (row.status === "error") return { level: "error", message: row.lastError ?? "Error." };
  if (row.tokenExpiresAt) {
    const days = (row.tokenExpiresAt.getTime() - now.getTime()) / 86_400_000;
    if (days < LOGIN_WARNING_DAYS) {
      return {
        level: "soon",
        message: `The login ends in ${Math.max(0, Math.ceil(days))} day(s). Reconnect to renew it.`,
      };
    }
  }
  return null;
}

export async function videoSettingsState(
  provider: VideoProvider,
  now = new Date(),
): Promise<VideoSettingsState> {
  const [rows, accounts] = await Promise.all([
    listConnections(provider),
    db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.platform, provider))
      .orderBy(asc(socialAccounts.handle)),
  ]);
  const env = process.env;
  const clientId =
    provider === "youtube"
      ? env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null
      : env.TIKTOK_CLIENT_KEY?.trim() || null;
  const secretSet =
    provider === "youtube"
      ? Boolean(env.GOOGLE_OAUTH_CLIENT_SECRET?.trim())
      : Boolean(env.TIKTOK_CLIENT_SECRET?.trim());
  return {
    provider,
    clientId,
    secretSet,
    keyProblem: encryptionKeyProblem(),
    connections: rows
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((row) => ({
        row: withoutToken(row),
        banner: connectionBanner(row, now),
        linked: accounts.filter((a) => a.integrationId === row.id),
      })),
    accounts,
  };
}

/** Both halves of the OAuth client are set. */
export function videoConfigured(provider: VideoProvider): boolean {
  return provider === "youtube" ? googleConfig() !== null : tiktokConfig() !== null;
}
