/**
 * TikTok Login Kit + Content Posting API settings (build 4 §3.F), read from
 * the environment at call time.
 *
 *   TIKTOK_CLIENT_KEY     the developer app's client key
 *   TIKTOK_CLIENT_SECRET  its client secret (never shown back, never logged)
 *   ENCRYPTION_KEY        stores the tokens encrypted (src/lib/crypto.ts)
 */

export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API = "https://open.tiktokapis.com";
export const TIKTOK_TOKEN_URL = `${TIKTOK_API}/v2/oauth/token/`;

/** Who the creator is; upload to their drafts (inbox); post directly. */
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"] as const;

export const TIKTOK_STATE_COOKIE = "tiktok_oauth_state";
export const TIKTOK_OAUTH_PATH = "/api/tiktok/oauth";
export const TIKTOK_CALLBACK_PATH = `${TIKTOK_OAUTH_PATH}/callback`;

export type TikTokConfig = { clientKey: string; clientSecret: string };

export function tiktokConfig(
  env: Record<string, string | undefined> = process.env,
): TikTokConfig | null {
  const clientKey = env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret };
}

export function tiktokRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${TIKTOK_CALLBACK_PATH}`;
}
