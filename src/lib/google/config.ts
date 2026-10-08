/**
 * Google OAuth for YouTube publishing (build 4 §3.F), read from the
 * environment at call time so Settings can change it without a restart.
 *
 *   GOOGLE_OAUTH_CLIENT_ID      a Google Cloud OAuth client, type "Web application"
 *   GOOGLE_OAUTH_CLIENT_SECRET  its secret (never shown back, never logged)
 *   ENCRYPTION_KEY              stores the refresh token encrypted (src/lib/crypto.ts)
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

/** Upload videos and thumbnails; read the channel list. Nothing else. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

/** The cookie that ties Google's callback to the browser that started it (CSRF). */
export const YOUTUBE_STATE_COOKIE = "youtube_oauth_state";
export const YOUTUBE_OAUTH_PATH = "/api/youtube/oauth";
export const YOUTUBE_CALLBACK_PATH = `${YOUTUBE_OAUTH_PATH}/callback`;

export type GoogleConfig = { clientId: string; clientSecret: string };

/** The OAuth client, or null when the id or secret is missing. */
export function googleConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function youtubeRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${YOUTUBE_CALLBACK_PATH}`;
}
