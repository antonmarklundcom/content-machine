/**
 * Meta app settings (PLAN.md §1.49, §5.O12), read from the environment at call
 * time so the Settings page can change them without a restart.
 *
 *   META_APP_ID           the developer app's App ID
 *   META_APP_SECRET       its App Secret (never shown back, never logged)
 *   META_LOGIN_CONFIG_ID  optional: a Facebook Login for Business configuration
 *                         id; without it the login dialog asks for SCOPES
 *   META_GRAPH_VERSION    optional, default DEFAULT_GRAPH_VERSION
 *   ENCRYPTION_KEY        stores the token encrypted (src/lib/crypto.ts)
 */

export const DEFAULT_GRAPH_VERSION = "v23.0";

/**
 * What the connection asks for. Insights need the first five; publishing
 * (O13) needs the last three, asked for now so O13 needs no reconnect.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_content_publish",
  "instagram_manage_comments",
  "pages_manage_posts",
] as const;

/** The cookie that ties Meta's callback to the browser that started it (CSRF). */
export const META_STATE_COOKIE = "meta_oauth_state";

/** The path Meta sends the browser back to after login. */
export const META_CALLBACK_PATH = "/api/meta/callback";

export type MetaConfig = {
  appId: string;
  appSecret: string;
  loginConfigId: string | null;
  graphVersion: string;
};

export function graphVersion(): string {
  const v = process.env.META_GRAPH_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

/** The app settings, or null when App ID or App Secret is missing. */
export function metaConfig(): MetaConfig | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    loginConfigId: process.env.META_LOGIN_CONFIG_ID?.trim() || null,
    graphVersion: graphVersion(),
  };
}

/** `origin` + the callback path; the origin is the one the browser used. */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${META_CALLBACK_PATH}`;
}

/**
 * The origin the browser used, so the redirect URI matches what Meta sees:
 * `http://localhost:3000` locally, the public host behind a proxy online.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}
